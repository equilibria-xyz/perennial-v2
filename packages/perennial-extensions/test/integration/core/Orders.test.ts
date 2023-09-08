import { BigNumber, BigNumberish, utils } from 'ethers'
import { InstanceVars, deployProtocol, createMarket, createInvoker, settle, createVault } from '../helpers/setupHelpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

import 'hardhat'

import { expect } from 'chai'
import { parse6decimal } from '../../../../common/testutil/types'
import { Market, MultiInvoker } from '../../../types/generated'
import { openTriggerOrder } from '../../helpers/types'
import { _buildPlaceOrder, buildCancelOrder, buildExecOrder, buildPlaceOrder } from '../../helpers/invoke'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerOrderStruct } from '../../../types/generated/contracts/MultiInvoker'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers } from 'hardhat'

const MAX_UINT64 = BigNumber.from('18446744073709551615')
const MIN_MAX_UINT64 = BigNumber.from('9223372036854775807')

describe('Orders', () => {
  let instanceVars: InstanceVars
  let dsuCollateral: BigNumberish
  let collateral: BigNumberish
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
  })

  it('places a limit order', async () => {
    const { user, dsu } = instanceVars

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
    const { user, userB } = instanceVars

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
    const { user, chainlink } = instanceVars

    const trigger = openTriggerOrder({ size: userPosition, price: payoff(marketPrice.sub(10)), feePct: 50 })
    const placeOrder = buildPlaceOrder({
      market: market.address,
      order: trigger,
      collateral: collateral,
      triggerType: 'LM',
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted
    expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a short limit order', async () => {
    const { user, chainlink } = instanceVars

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

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  it('executes a long tp order', async () => {
    const { user, chainlink } = instanceVars

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

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
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

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
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

    await chainlink.nextWithPriceModification(() => marketPrice.sub(11))
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

    await chainlink.nextWithPriceModification(() => marketPrice.add(11))
    await settle(market, user)

    const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(user).invoke(execute))
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue)
      .to.emit(multiInvoker, 'KeeperCall')
  })

  describe('Sad path :(', () => {
    it('fails to execute an order that does not exist', async () => {
      const { user, userB } = instanceVars

      await expect(
        multiInvoker.connect(userB).invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 0 })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerCantExecuteError')

      const trigger = openTriggerOrder({ size: position, price: 0 })
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
        size: userPosition,
        price: payoff(marketPrice.add(10)),
        feePct: 0,
        trigger: 'TP',
      })

      const placeOrder = buildPlaceOrder({
        market: market.address,
        order: trigger,
        collateral: collateral,
        triggerType: 'TP',
      })

      await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
        multiInvoker,
        'MultiInvokerInvalidOrderError',
      )
    })

    it('fails to place order with comparison == 0 || > |1|', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({ size: userPosition, price: marketPrice, side: 'L' })

      trigger.comparison = 0
      await expect(
        multiInvoker.connect(user).invoke(_buildPlaceOrder({ market: market.address, t: trigger })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

      trigger.comparison = 2
      await expect(
        multiInvoker.connect(user).invoke(_buildPlaceOrder({ market: market.address, t: trigger })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

      trigger.comparison = -2
      await expect(
        multiInvoker.connect(user).invoke(_buildPlaceOrder({ market: market.address, t: trigger })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
    })

    it('fails to place order with side != 1 | 2', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({ size: userPosition, price: marketPrice, side: 'L' })

      trigger.comparison = -1
      trigger.side = 0
      await expect(
        multiInvoker.connect(user).invoke(_buildPlaceOrder({ market: market.address, t: trigger })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

      trigger.side = 3
      await expect(
        multiInvoker.connect(user).invoke(_buildPlaceOrder({ market: market.address, t: trigger })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
    })

    it('exceeds max trigger fee on execution', async () => {
      const { user, chainlink } = instanceVars

      const trigger = openTriggerOrder({
        size: userPosition,
        price: payoff(marketPrice.add(10)),
        feePct: BigNumber.from('10'),
        trigger: 'TP',
      })
      const placeOrder = buildPlaceOrder({
        market: market.address,
        order: trigger,
        collateral: collateral,
        triggerType: 'TP',
        feeAsPositionPercentOverride: true,
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

      const defaultOrder = openTriggerOrder({ size: parse6decimal('10000'), price: BigNumber.from(1000e6) })
      defaultOrder.comparison = 1

      let testOrder = { ...defaultOrder }

      testOrder.fee = MAX_UINT64.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.price = MIN_MAX_UINT64.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      // why is -int inclusive of last digit?
      testOrder.price = MIN_MAX_UINT64.add(2).mul(-1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.delta = MIN_MAX_UINT64.add(1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
      testOrder = { ...defaultOrder }

      testOrder.delta = MIN_MAX_UINT64.add(2).mul(-1)
      await assertStoreFail(testOrder, multiInvoker, market, user)
    })
  })
})

async function assertStoreFail(
  testOrder: TriggerOrderStruct,
  multiInvoker: MultiInvoker,
  market: Market,
  user: SignerWithAddress,
) {
  await expect(
    multiInvoker.connect(user).invoke(_buildPlaceOrder({ market: market.address, t: testOrder })),
  ).to.be.revertedWithCustomError(multiInvoker, 'TriggerOrderStorageInvalidError')
}
const payoff = (price: BigNumber) => {
  return price.mul(price).div(1e6)
}
