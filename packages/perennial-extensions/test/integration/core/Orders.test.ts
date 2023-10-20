import { BigNumber, utils } from 'ethers'
import { InstanceVars, deployProtocol, createMarket, createInvoker, settle } from '../helpers/setupHelpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

import 'hardhat'

import { expect } from 'chai'
import { parse6decimal } from '../../../../common/testutil/types'
import { IMultiInvoker, Market, MultiInvoker } from '../../../types/generated'
import { Compare, Dir, openTriggerOrder } from '../../helpers/types'
import { buildCancelOrder, buildExecOrder, buildPlaceOrder, buildUpdateMarket } from '../../helpers/invoke'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InterfaceFeeStruct, TriggerOrderStruct } from '../../../types/generated/contracts/MultiInvoker'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers } from 'hardhat'

const MAX_UINT48 = BigNumber.from('281474976710655')
const MAX_UINT64 = BigNumber.from('18446744073709551615')
const MIN_MAX_UINT64 = BigNumber.from('9223372036854775807')

describe('Orders', () => {
  let instanceVars: InstanceVars
  let dsuCollateral: BigNumber
  let collateral: BigNumber
  let position: BigNumber
  let userPosition: BigNumber
  let market: Market
  let marketPrice: BigNumber
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
    await dsu.connect(userB).approve(multiInvoker.address, dsuCollateral)
  })

  it('places a limit order', async () => {
    const { user, dsu } = instanceVars

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
    const triggerOrder = openTriggerOrder({
      delta: userPosition,
      side: Dir.L,
      comparison: Compare.ABOVE_MARKET,
      price: BigNumber.from(1000e6),
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
    const { user, userB } = instanceVars

    const triggerOrder = openTriggerOrder({
      delta: userPosition,
      price: BigNumber.from(1000e6),
      side: Dir.L,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      long: position,
      order: triggerOrder,
      collateral: collateral,
    })

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
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition,
      price: payoff(marketPrice.sub(10)),
      side: Dir.L,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short limit order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition,
      price: payoff(marketPrice.add(10)),
      side: Dir.S,
      comparison: Compare.BELOW_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a long tp order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition.mul(-1),
      price: payoff(marketPrice.add(10)),
      side: Dir.L,
      comparison: Compare.BELOW_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      long: position,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short tp order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition.mul(-1),
      price: payoff(marketPrice.sub(11)),
      side: Dir.S,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      short: position,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a long sl order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition.mul(-1),
      price: payoff(marketPrice.sub(10)),
      side: Dir.L,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      long: position,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short sl order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition.mul(-1),
      price: payoff(marketPrice.add(10)),
      side: Dir.S,
      comparison: Compare.BELOW_MARKET,
    })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      short: position,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a maker limit order', async () => {
    const { userB, chainlink } = instanceVars
    const trigger = openTriggerOrder({
      delta: userPosition,
      price: payoff(marketPrice.add(10)),
      side: Dir.M,
      comparison: Compare.BELOW_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(userB).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, userB)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(userB.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a maker above market price order', async () => {
    const { userB, chainlink } = instanceVars
    const trigger = openTriggerOrder({
      delta: userPosition.mul(-1),
      price: payoff(marketPrice.sub(10)),
      side: Dir.M,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      maker: (await market.positions(userB.address)).maker,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(userB).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, userB)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(userB.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a maker below price order', async () => {
    const { userB, chainlink } = instanceVars
    const trigger = openTriggerOrder({
      delta: userPosition.mul(-1),
      price: payoff(marketPrice.add(10)),
      side: Dir.M,
      comparison: Compare.BELOW_MARKET,
      fee: userPosition,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      maker: (await market.positions(userB.address)).maker,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(userB).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, userB)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(userB.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes an order with interface fee', async () => {
    const { user, userB, chainlink, dsu } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition,
      price: payoff(marketPrice.sub(10)),
      side: Dir.L,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      interfaceFee: { amount: 50e6, receiver: userB.address, unwrap: false },
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    const balanceBefore = await dsu.balanceOf(userB.address)
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
      .to.emit(market, 'Updated')
      .withArgs(multiInvoker.address, user.address, anyValue, anyValue, anyValue, anyValue, -50e6, false)
      .to.emit(multiInvoker, 'InterfaceFeeCharged')
      .withArgs(user.address, market.address, { receiver: userB.address, amount: 50e6, unwrap: false })

    expect(await dsu.balanceOf(userB.address)).to.eq(balanceBefore.add(ethers.utils.parseEther('50')))
  })

  it('executes an order with interface fee (unwrap)', async () => {
    const { user, userB, chainlink, usdc } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition,
      price: payoff(marketPrice.sub(10)),
      side: Dir.L,
      comparison: Compare.ABOVE_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      interfaceFee: { amount: 50e6, receiver: userB.address, unwrap: true },
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    const balanceBefore = await usdc.balanceOf(userB.address)
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
      .to.emit(market, 'Updated')
      .withArgs(multiInvoker.address, user.address, anyValue, anyValue, anyValue, anyValue, -50e6, false)
      .to.emit(multiInvoker, 'InterfaceFeeCharged')
      .withArgs(user.address, market.address, { receiver: userB.address, amount: 50e6, unwrap: true })

    expect(await usdc.balanceOf(userB.address)).to.eq(balanceBefore.add(50e6))
  })

  it('executes a withdrawal order', async () => {
    const { userB, chainlink } = instanceVars
    const trigger = openTriggerOrder({
      delta: collateral.div(-4),
      price: payoff(marketPrice.add(10)),
      side: Dir.C,
      comparison: Compare.BELOW_MARKET,
      fee: userPosition,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      maker: (await market.positions(userB.address)).maker,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(userB).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, userB)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(userB.address, market.address, 1)
      .to.emit(multiInvoker, 'KeeperCall')
      .to.emit(market, 'Updated')
      .withArgs(multiInvoker.address, userB.address, anyValue, anyValue, anyValue, anyValue, collateral.div(-4), false)
  })

  it('executes a maker, long, and short magic close all order', async () => {
    const { user, chainlink } = instanceVars

    // ------------------- Maker close all ------------------------- //

    const trigger = openTriggerOrder({
      delta: 0,
      price: payoff(marketPrice.add(10)),
      side: Dir.M,
      comparison: Compare.BELOW_MARKET,
      fee: userPosition,
    })

    let placeOrder = buildPlaceOrder({
      market: market.address,
      maker: userPosition,
      order: trigger,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    expect((await market.positions(user.address)).maker).to.be.eq(userPosition)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    let execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1, revertOnFailure: true })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1)

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    expect((await market.positions(user.address)).maker).to.be.eq(0)

    // ------------------- Long close all ------------------------- //
    trigger.side = Dir.L
    trigger.comparison = Compare.BELOW_MARKET

    placeOrder = buildPlaceOrder({ market: market.address, long: userPosition, order: trigger, collateral: 0 })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    expect((await market.positions(user.address)).long).to.be.eq(userPosition)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    execute = buildExecOrder({ user: user.address, market: market.address, orderId: 2, revertOnFailure: true })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 2)

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    expect((await market.positions(user.address)).long).to.be.eq(0)

    // ------------------- Short close all ------------------------- //
    trigger.side = Dir.S
    trigger.comparison = Compare.BELOW_MARKET

    placeOrder = buildPlaceOrder({ market: market.address, short: userPosition, order: trigger, collateral: 0 })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 3)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    expect((await market.positions(user.address)).short).to.be.eq(userPosition)

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    execute = buildExecOrder({ user: user.address, market: market.address, orderId: 3, revertOnFailure: true })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 3)

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    expect((await market.positions(user.address)).short).to.be.eq(0)
  })

  it('soft reverts on failed execute order', async () => {
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({
      delta: userPosition,
      price: payoff(marketPrice.add(10)),
      fee: 50,
      side: Dir.S,
      comparison: Compare.BELOW_MARKET,
    })

    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
    })

    await multiInvoker.connect(user).invoke(placeOrder)
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    // make collateral insufficient to update market on order execution
    await multiInvoker
      .connect(user)
      .invoke(
        buildUpdateMarket({ market: market.address, collateral: BigNumber.from(collateral).mul(99).div(100).mul(-1) }),
      )

    await expect(
      multiInvoker
        .connect(user)
        .invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 1, revertOnFailure: true })),
    ).to.be.reverted

    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    await expect(
      multiInvoker
        .connect(user)
        .invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 1, revertOnFailure: false })),
    ).to.not.be.reverted

    // add collateral back
    await multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))

    // soft-reverted order with collateral added back was not deleted, can be executed
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    await expect(
      multiInvoker
        .connect(user)
        .invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 1, revertOnFailure: true })),
    ).to.not.be.reverted
  })

  describe('Sad path :(', () => {
    it('fails to execute an order that does not exist', async () => {
      const { user, userB } = instanceVars

      await expect(
        multiInvoker.connect(userB).invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 0 })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerCantExecuteError')

      const trigger = openTriggerOrder({
        delta: position,
        price: 0,
        side: Dir.L,
        comparison: Compare.ABOVE_MARKET,
      })
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger })),
      ).to.not.be.reverted

      await expect(multiInvoker.connect(user).invoke(buildCancelOrder({ market: market.address, orderId: 1 }))).to.emit(
        multiInvoker,
        'OrderCancelled',
      )

      await expect(
        multiInvoker.connect(userB).invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 1 })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerCantExecuteError')
    })

    it('fails to place order with 0 fee', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({
        delta: userPosition,
        price: payoff(marketPrice.add(10)),
        side: Dir.L,
        comparison: Compare.ABOVE_MARKET,
        fee: 0,
      })

      const placeOrder = buildPlaceOrder({
        market: market.address,
        order: trigger,
        collateral: collateral,
      })

      await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
        multiInvoker,
        'MultiInvokerInvalidOrderError',
      )
    })

    it('fails to place order with comparison == 0 || > |1|', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({
        delta: userPosition,
        side: Dir.L,
        comparison: Compare.ABOVE_MARKET,
        price: marketPrice,
      })

      trigger.comparison = 0
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

      trigger.comparison = 2
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

      trigger.comparison = -2
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
    })

    it('fails to place order with side > 3', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({
        delta: userPosition,
        side: 4,
        comparison: Compare.ABOVE_MARKET,
        price: marketPrice,
      })

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
    })

    it('fails to place order with side = 3, delta >= 0', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({
        delta: collateral,
        side: 3,
        comparison: Compare.ABOVE_MARKET,
        price: marketPrice,
      })

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
    })

    it('exceeds max trigger fee on execution', async () => {
      const { user, chainlink } = instanceVars

      const trigger = openTriggerOrder({
        delta: userPosition,
        price: payoff(marketPrice.add(10)),
        side: Dir.L,
        comparison: Compare.BELOW_MARKET,
        fee: 10,
      })

      const placeOrder = buildPlaceOrder({
        market: market.address,
        order: trigger,
        collateral: collateral,
      })

      await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      await chainlink.nextWithPriceModification(() => marketPrice.add(11))
      await settle(market, user)

      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000000'])
      const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
      await expect(multiInvoker.connect(user).invoke(execute)).to.be.revertedWithCustomError(
        multiInvoker,
        'MultiInvokerMaxFeeExceededError',
      )
    })

    it('Fails to store TRIGGER values out of slot bounds', async () => {
      const { user } = instanceVars

      const defaultOrder = openTriggerOrder({
        delta: parse6decimal('10000'),
        side: Dir.L,
        comparison: Compare.ABOVE_MARKET,
        price: BigNumber.from(1000e6),
      })

      defaultOrder.comparison = 1

      let testOrder = { ...defaultOrder }

      testOrder.fee = MAX_UINT64.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.price = MIN_MAX_UINT64.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.price = MIN_MAX_UINT64.add(2).mul(-1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.delta = MIN_MAX_UINT64.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.delta = MIN_MAX_UINT64.add(2).mul(-1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.interfaceFee.amount = MAX_UINT48.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }
    })
  })
})

async function assertStoreFail(
  testOrder: TriggerOrderStruct,
  multiInvoker: MultiInvoker,
  market: Market,
  user: SignerWithAddress,
  interfaceFee?: InterfaceFeeStruct,
) {
  await expect(
    multiInvoker
      .connect(user)
      .invoke(buildPlaceOrder({ market: market.address, order: testOrder, collateral: 0, interfaceFee })),
  ).to.be.revertedWithCustomError(multiInvoker, 'TriggerOrderStorageInvalidError')
}
const payoff = (price: BigNumber) => {
  return price.mul(price).div(1e6)
}
