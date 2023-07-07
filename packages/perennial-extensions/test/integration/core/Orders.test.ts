import { BigNumber, BigNumberish, utils, Signer } from 'ethers'
import { InstanceVars, deployProtocol, createMarket, DSU } from '../helpers/setupHelpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

import 'hardhat'

import * as invoke from '../../helpers/invoke'
import * as helpers from '../../helpers/types'
import { PositionStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { expect } from 'chai'
// import { Market } from '@equilibria/perennial-v2/types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { formatEther } from 'ethers/lib/utils'
import { Market } from '../../../types/generated'

describe('Orders', () => {
  let instanceVars: InstanceVars
  let dsuCollateral: BigNumberish
  let collateral: BigNumberish
  let position: BigNumber
  let userPosition: BigNumber
  let defaultOrder: invoke.OrderStruct
  let defaultPosition: PositionStruct
  let maxFee: BigNumber
  let market: Market

  beforeEach(async () => {
    instanceVars = await deployProtocol()
    const { user, factory, userB, dsu, multiInvoker, chainlink } = instanceVars

    dsuCollateral = await instanceVars.dsu.balanceOf(instanceVars.user.address)
    collateral = parse6decimal('10000')
    position = parse6decimal('.0001')
    userPosition = parse6decimal('.00001')
    maxFee = collateral

    defaultOrder = {
      isLimit: true,
      isLong: true,
      maxFee: maxFee, // 5% fee
      execPrice: (await multiInvoker.ethPrice()).div(2), // trigger order at 50% drawdown
      size: userPosition,
    }

    defaultPosition = helpers.openPosition({
      maker: '0',
      long: defaultOrder.size,
      short: '0',
      collateral: collateral,
    })

    market = await createMarket(instanceVars)

    // deposit maker up to maker limit (UFixed6)
    await dsu.connect(userB).approve(market.address, dsuCollateral)
    await market.connect(userB).update(userB.address, position, 0, 0, collateral)

    await chainlink.next()
    await market.settle(userB.address)

    //await dsu.connect(multiInvoker.address).approve(market, parse6decimal('200000'))
    await factory.connect(user).updateOperator(multiInvoker.address, true)

    await multiInvoker.connect(user).approve(market.address)

    // await dsu.connect(multiInvoker.address).approve(market.address, dsuCollateral)
  })

  it('opens a limit order', async () => {
    const { user, dsu, usdc, multiInvoker } = instanceVars

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    const openOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      collateral: collateral,
    })

    await multiInvoker.connect(user).invoke(openOrder)
    await market.settle(user.address)

    const userLocals = await market.locals(user.address)
    const userPosition = await market.positions(user.address)

    // // long limit not triggered yet
    expect(userPosition.long.eq(0)).to.be.true

    // // // default collateral if not specified is the size of the position
    // expect(userLocals.collateral.toString()).to.eq(collateral.toString())

    // @todo assert order state was placed
  })

  it('executes a limit order', async () => {
    const { user, userB, dsu, multiInvoker, chainlink } = instanceVars

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    const openOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      collateral: collateral,
    })

    await multiInvoker.connect(user).invoke(openOrder)
    await market.settle(user.address)

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.div(3))

    const execBalanceBefore = await dsu.balanceOf(userB.address)

    const execOrder = invoke.buildExecOrder({
      user: user.address,
      market: market.address,
      orderId: 1,
    })

    const receipt = await multiInvoker.connect(userB).invoke(execOrder)

    const execBalanceAfter = await dsu.balanceOf(userB.address)
    const feeCharged = execBalanceAfter.sub(execBalanceBefore).div(1e12)

    const keeperPremium = await multiInvoker.keeperPremium()
    const ethPrice = await multiInvoker.ethPrice()

    await expect(receipt)
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, ethPrice, defaultOrder.execPrice)
      .to.emit(multiInvoker, 'KeeperFeeCharged')
      .withArgs(user.address, market.address, userB.address, feeCharged)

    const gasUsed = (await receipt.wait()).gasUsed

    // fee charged > new executor balance * keeper premium
    console.log('fee charged: ', execBalanceAfter.sub(execBalanceBefore).div(1e12).toString())
    console.log('tx gas used ($): ', gasUsed.add(gasUsed.mul(keeperPremium).div(100)).mul(ethPrice.div(1e6)).toString())

    expect(execBalanceAfter.sub(execBalanceBefore).div(1e12)).is.gt(
      gasUsed.add(gasUsed.mul(keeperPremium).div(100)).mul(ethPrice.div(1e6)),
    )
  })

  it('executes a short limit order', async () => {
    const { dsu, user, userB, multiInvoker, chainlink } = instanceVars
    const ethPrice = await multiInvoker.ethPrice()

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    // short limit order: limit = true && mkt price (1150) >= exec price (|-|)
    defaultOrder.execPrice = BigNumber.from(defaultOrder.execPrice!).div(-3)
    const placeOrder = invoke.buildPlaceOrder({ market: market.address, order: defaultOrder })
    await multiInvoker.connect(user).invoke(placeOrder)

    // pre exec
    await chainlink.nextWithPriceModification(price => price.mul(3))
    const execBalanceBefore = await dsu.balanceOf(userB.address)

    // execute order tx
    const execOrder = invoke.buildExecOrder({ user: user.address, market: market.address, orderId: 2 })
    const receipt = await multiInvoker.connect(userB).invoke(execOrder)

    // fee charged diff
    const execBalanceAfter = await dsu.balanceOf(userB.address)
    const feeCharged = execBalanceAfter.sub(execBalanceBefore).div(1e12)

    // exec tx finalized
    await expect(receipt)
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, ethPrice, defaultOrder.execPrice)
      .to.emit(multiInvoker, 'KeeperFeeCharged')
      .withArgs(user.address, market.address, userB.address, feeCharged)
  })

  it('executes a long tp', async () => {
    const { dsu, user, userB, multiInvoker, chainlink } = instanceVars

    const ethPrice = await multiInvoker.ethPrice()
    const marketPrice = (await chainlink.oracle.latest()).price

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    // long tp: limit = false && mkt price (1150) >= exec price (|-1100|)
    defaultOrder.isLimit = false
    defaultOrder.execPrice = marketPrice.mul('105').div('100').mul(-1) // trigger 5% above market price

    // place initial long order
    const placeOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      long: defaultOrder.size,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder))
      .to.emit(market, 'Updated')
      .withArgs(user.address, anyValue, anyValue, userPosition, anyValue, collateral)

    // exec fails pre price change
    const execOrder = invoke.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execOrder)).to.be.revertedWithCustomError(
      multiInvoker,
      'KeeperManagerBadCloseError',
    )

    // price crosss trigger
    const newMarketPrice = marketPrice.mul(106).div(100) // 1% above long tp
    await chainlink.nextWithPriceModification(price => newMarketPrice)
    await market.settle(user.address)

    // execute order tx
    const execBalanceBefore = await dsu.balanceOf(userB.address)
    const receipt = await multiInvoker.connect(userB).invoke(execOrder)

    // fee charged diff
    const execBalanceAfter = await dsu.balanceOf(userB.address)
    const feeCharged = execBalanceAfter.sub(execBalanceBefore).div(1e12)

    // exec tx finalized
    await expect(receipt)
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue, defaultOrder.execPrice)
      .to.emit(multiInvoker, 'KeeperFeeCharged')
      .withArgs(user.address, market.address, userB.address, feeCharged)

    await chainlink.nextWithPriceModification(price => price)
    await market.settle(user.address)

    expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(0)
  })

  it('executes a short sl', async () => {
    const { dsu, user, userB, multiInvoker, chainlink } = instanceVars

    const ethPrice = await multiInvoker.ethPrice()
    const marketPrice = (await chainlink.oracle.latest()).price

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    // short sl: limit = false && mkt price >= |-exec price|
    defaultOrder.isLimit = false
    defaultOrder.isLong = false
    defaultOrder.execPrice = marketPrice.mul('105').div('100').mul(-1) // trigger 5% above market price

    // place initial short order
    const placeOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      long: defaultOrder.size,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder))
      .to.emit(market, 'Updated')
      .withArgs(user.address, anyValue, anyValue, userPosition, anyValue, collateral)

    // exec fails pre price change
    const execOrder = invoke.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execOrder)).to.be.revertedWithCustomError(
      multiInvoker,
      'KeeperManagerBadCloseError',
    )

    // price crosss trigger
    const newMarketPrice = marketPrice.mul(106).div(100) // 1% above short sl
    await chainlink.nextWithPriceModification(price => newMarketPrice)
    await market.settle(user.address)

    // execute order tx
    const execBalanceBefore = await dsu.balanceOf(userB.address)
    const receipt = await multiInvoker.connect(userB).invoke(execOrder)

    // fee charged diff
    const execBalanceAfter = await dsu.balanceOf(userB.address)
    const feeCharged = execBalanceAfter.sub(execBalanceBefore).div(1e12)

    // exec tx finalized
    await expect(receipt)
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue, defaultOrder.execPrice)
      .to.emit(multiInvoker, 'KeeperFeeCharged')
      .withArgs(user.address, market.address, userB.address, feeCharged)

    await chainlink.nextWithPriceModification(price => price)
    await market.settle(user.address)

    expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(0)
  })

  it('executes a long sl', async () => {
    const { dsu, user, userB, multiInvoker, chainlink } = instanceVars

    const ethPrice = await multiInvoker.ethPrice()
    const marketPrice = (await chainlink.oracle.latest()).price

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    // long sl: limit = false && mkt price <= exec price
    defaultOrder.isLimit = false
    defaultOrder.execPrice = marketPrice.mul('95').div('100') // trigger 5% below market price

    // place initial long order
    const placeOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      long: defaultOrder.size,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder))
      .to.emit(market, 'Updated')
      .withArgs(user.address, anyValue, anyValue, userPosition, anyValue, collateral)

    // exec fails pre price change
    const execOrder = invoke.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execOrder)).to.be.revertedWithCustomError(
      multiInvoker,
      'KeeperManagerBadCloseError',
    )

    // price crosss trigger
    const newMarketPrice = marketPrice.mul(94).div(100) // 1% below long sl
    await chainlink.nextWithPriceModification(price => newMarketPrice)
    await market.settle(user.address)

    // execute order tx
    const execBalanceBefore = await dsu.balanceOf(userB.address)
    const receipt = await multiInvoker.connect(userB).invoke(execOrder)

    // fee charged diff
    const execBalanceAfter = await dsu.balanceOf(userB.address)
    const feeCharged = execBalanceAfter.sub(execBalanceBefore).div(1e12)

    // exec tx finalized
    await expect(receipt)
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue, defaultOrder.execPrice)
      .to.emit(multiInvoker, 'KeeperFeeCharged')
      .withArgs(user.address, market.address, userB.address, feeCharged)

    await chainlink.nextWithPriceModification(price => price)
    await market.settle(user.address)

    expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(0)
  })

  it('executesa a short tp', async () => {
    const { dsu, user, userB, multiInvoker, chainlink } = instanceVars

    const ethPrice = await multiInvoker.ethPrice()
    const marketPrice = (await chainlink.oracle.latest()).price

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    // short sl: limit = false && mkt price <= exec price
    defaultOrder.isLimit = false
    defaultOrder.isLong = false
    defaultOrder.execPrice = marketPrice.mul('95').div('100') // trigger 5% below market price

    // place initial long order
    const placeOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      long: defaultOrder.size,
      collateral: collateral,
    })

    await expect(multiInvoker.connect(user).invoke(placeOrder))
      .to.emit(market, 'Updated')
      .withArgs(user.address, anyValue, anyValue, userPosition, anyValue, collateral)

    // exec fails pre price change
    const execOrder = invoke.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
    await expect(multiInvoker.connect(userB).invoke(execOrder)).to.be.revertedWithCustomError(
      multiInvoker,
      'KeeperManagerBadCloseError',
    )

    // price crosss trigger
    const newMarketPrice = marketPrice.mul(94).div(100) // 1% below long sl
    await chainlink.nextWithPriceModification(price => newMarketPrice)
    await market.settle(user.address)

    // execute order tx
    const execBalanceBefore = await dsu.balanceOf(userB.address)
    const receipt = await multiInvoker.connect(userB).invoke(execOrder)

    // fee charged diff
    const execBalanceAfter = await dsu.balanceOf(userB.address)
    const feeCharged = execBalanceAfter.sub(execBalanceBefore).div(1e12)

    // exec tx finalized
    await expect(receipt)
      .to.emit(multiInvoker, 'OrderExecuted')
      .withArgs(user.address, market.address, 1, anyValue, defaultOrder.execPrice)
      .to.emit(multiInvoker, 'KeeperFeeCharged')
      .withArgs(user.address, market.address, userB.address, feeCharged)

    await chainlink.nextWithPriceModification(price => price)
    await market.settle(user.address)

    expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(0)
  })

  it('cancels and order', async () => {
    const { user, userB, dsu, multiInvoker, chainlink } = instanceVars

    await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

    const openOrder = invoke.buildPlaceOrder({
      market: market.address,
      order: defaultOrder,
      collateral: collateral,
    })

    await multiInvoker.connect(user).invoke(openOrder)

    const cancelOrder = invoke.buildCancelOrder({
      market: market.address,
      orderId: 1,
    })

    await expect(multiInvoker.connect(user).invoke(cancelOrder))
      .to.emit(multiInvoker, 'OrderCancelled')
      .withArgs(user.address, market.address, 1)
  })

  // it('executes and order', async () => {

  // })
})

const squeethPayoff = (startPrice: BigNumber, endPrice: BigNumber) => {
  return endPrice.mul(endPrice).sub(startPrice)
}
