import { BigNumber, BigNumberish, utils } from 'ethers'
import { InstanceVars, deployProtocol, createMarket, createInvoker, settle } from '../helpers/setupHelpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

import 'hardhat'

import { expect } from 'chai'
import { parse6decimal } from '../../../../common/testutil/types'
import { Market, MultiInvoker } from '../../../types/generated'
import { openTriggerOrder } from '../../helpers/types'
import { buildCancelOrder, buildExecOrder, buildPlaceOrder } from '../../helpers/invoke'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('Orders', () => {
  let instanceVars: InstanceVars
  let dsuCollateral: BigNumberish
  let collateral: BigNumberish
  let position: BigNumber
  let userPosition: BigNumber
  let maxFee: BigNumber
  let market: Market
  let marketPrice: BigNumber
  let ethPrice: BigNumber
  let multiInvoker: MultiInvoker

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()

    const { user, userB, dsu, chainlink } = instanceVars

    market = await createMarket(instanceVars)
    multiInvoker = await createInvoker(instanceVars)

    dsuCollateral = await instanceVars.dsu.balanceOf(instanceVars.user.address)
    collateral = parse6decimal('100000')
    position = parse6decimal('.01')
    userPosition = parse6decimal('.001')
    maxFee = collateral
    ethPrice = BigNumber.from(1150e6)

    // deposit maker up to maker limit (UFixed6)
    await dsu.connect(userB).approve(market.address, dsuCollateral)

    await market.connect(userB).update(userB.address, position, 0, 0, collateral, false)
    await chainlink.next()
    settle(market, userB)

    await multiInvoker
      .connect(userB)
      .invoke([{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }])

    marketPrice = (await chainlink.oracle.latest()).price

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
  })

  it('places a limit order', async () => {
    const { user, dsu, usdc } = instanceVars

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
    const triggerOrder = openTriggerOrder({
      size: userPosition,
      price: BigNumber.from(1000e6),
      trigger: 'LM',
      feePct: 50,
    })
    const placeOrder = buildPlaceOrder({ market: market.address, order: triggerOrder, collateral: collateral })

    await multiInvoker.connect(user).invoke(placeOrder)
    await settle(market, user)

    const userMarketPosition = await market.positions(user.address)

    // // long limit not triggered yet
    expect(userMarketPosition.long.eq(0)).to.be.true
    expect(await multiInvoker.latestNonce()).to.eq(1)
  })

  it('cancels an order', async () => {
    const { user, userB, dsu } = instanceVars

    const triggerOrder = openTriggerOrder({
      size: userPosition,
      price: BigNumber.from(1000e6),
      trigger: 'LM',
      feePct: 50,
    })
    const placeOrder = buildPlaceOrder({ market: market.address, order: triggerOrder, collateral: collateral })

    await multiInvoker.connect(user).invoke(placeOrder)
    expect(await multiInvoker.latestNonce()).to.eq(1)

    const cancel = buildCancelOrder({ market: market.address, orderId: 1 })

    await multiInvoker.connect(userB).invoke(cancel)
    expect((await multiInvoker.orders(user.address, market.address, 1)).delta.abs()).to.eq(userPosition)

    await expect(multiInvoker.connect(user).invoke(cancel))
      .to.emit(multiInvoker, 'OrderCancelled')
      .withArgs(user.address, market.address, 1)

    expect(await multiInvoker.latestNonce()).to.eq(1)
  })

  it('executes a long limit order', async () => {
    const { user, userB, dsu, chainlink } = instanceVars

    const trigger = openTriggerOrder({ size: userPosition, price: payoff(marketPrice.sub(10)), feePct: 50 })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'LM',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(marketPrice2 => marketPrice.sub(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short limit order', async () => {
    const { user, userB, dsu, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      size: userPosition,
      price: payoff(marketPrice.add(10)),
      feePct: 50,
      side: 'S',
      trigger: 'LM',
    })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'LM',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(marketPrice2 => marketPrice.add(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a long tp order', async () => {
    const { user, userB, dsu, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      size: userPosition,
      price: payoff(marketPrice.add(10)),
      feePct: 50,
      trigger: 'TP',
    })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'TP',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(marketPrice2 => marketPrice.add(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short tp order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      size: userPosition,
      price: payoff(marketPrice.sub(11)),
      feePct: 50,
      trigger: 'TP',
      side: 'S',
    })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'TP',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(marketPrice2 => marketPrice.sub(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a long sl order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      size: userPosition,
      price: payoff(marketPrice.sub(11)),
      feePct: 50,
      trigger: 'SL',
      side: 'L',
    })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'SL',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(marketPrice2 => marketPrice.sub(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short sl order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      size: userPosition,
      price: payoff(marketPrice.add(10)),
      feePct: 50,
      trigger: 'SL',
      side: 'S',
    })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'SL',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(marketPrice2 => marketPrice.add(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })
})

const payoff = (price: BigNumber) => {
  return price.mul(price).div(1e6)
}
