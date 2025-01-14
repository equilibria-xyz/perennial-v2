import { BigNumber, utils, constants, PayableOverrides } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import 'hardhat'

import { expect } from 'chai'
import { parse6decimal, DEFAULT_ORDER, DEFAULT_GUARANTEE } from '../../../../../common/testutil/types'
import { IMultiInvoker, Market, MultiInvoker } from '../../../../types/generated'
import { Compare, Dir, openTriggerOrder } from '../../../helpers/MultiInvoker/types'
import {
  MAX_INT64,
  MAX_UINT48,
  MAX_UINT64,
  MIN_INT64,
  buildCancelOrder,
  buildExecOrder,
  buildPlaceOrder,
} from '../../../helpers/MultiInvoker/invoke'

import { TriggerOrderStruct } from '../../../../types/generated/contracts/MultiInvoker/MultiInvoker'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { createMarket } from '../../../helpers/marketHelpers'
import { InstanceVars, settle } from './setupHelpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

const ethers = { HRE }

export const PRICE = utils.parseEther('3374.655169')

function payoff(number: BigNumber): BigNumber {
  return number.mul(number).div(utils.parseEther('1')).div(100000)
}

// TODO: only needed for Arbitrum, but works with mainnet too
const TX_OVERRIDES = { gasLimit: 3_000_000 }

export function RunOrderTests(
  getFixture: () => Promise<InstanceVars>,
  createInvoker: (instanceVars: InstanceVars) => Promise<MultiInvoker>,
  advanceToPrice: (price?: BigNumber) => Promise<void>,
  validateOrderCreatedEvents: boolean,
): void {
  describe('Orders', () => {
    let instanceVars: InstanceVars
    let dsuCollateral: BigNumber
    let collateral: BigNumber
    let position: BigNumber
    let userPosition: BigNumber
    let market: Market
    let multiInvoker: MultiInvoker

    const fixture = async () => {
      instanceVars = await getFixture()
      const { owner, user, userB, dsu, oracle } = instanceVars

      const riskParamOverrides = {
        makerLimit: parse6decimal('2000'),
      }
      market = await createMarket(owner, instanceVars.marketFactory, dsu, oracle, riskParamOverrides)
      await oracle.register(market.address)
      multiInvoker = await createInvoker(instanceVars)

      dsuCollateral = await instanceVars.dsu.balanceOf(instanceVars.user.address)
      collateral = parse6decimal('100000')
      position = parse6decimal('1000')
      userPosition = parse6decimal('100')

      // deposit maker up to maker limit (UFixed6)
      await dsu.connect(userB).approve(market.address, dsuCollateral)

      await advanceToPrice(PRICE)

      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, position, 0, 0, collateral, false)

      await multiInvoker
        .connect(userB)
        ['invoke((uint8,bytes)[])']([{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }])

      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await dsu.connect(userB).approve(multiInvoker.address, dsuCollateral)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
      // TODO: move this settlement into the fixture
      await advanceToPrice(PRICE)
      await settle(market, instanceVars.userB)
    })

    after(async () => {
      await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    })

    const testCases = [
      {
        context: 'From user',
        setup: async () => true,
        invoke: async (
          args: IMultiInvoker.InvocationStruct[],
          forUser?: SignerWithAddress,
          overrides: PayableOverrides = TX_OVERRIDES,
        ) => {
          const { user } = instanceVars
          return multiInvoker.connect(forUser ?? user)['invoke((uint8,bytes)[])'](args, overrides)
        },
      },
      {
        context: 'From delegate',
        setup: async () => {
          const { user, userB, userD } = instanceVars
          await multiInvoker.connect(user).updateOperator(userD.address, true)
          await multiInvoker.connect(userB).updateOperator(userD.address, true)
        },
        invoke: async (
          args: IMultiInvoker.InvocationStruct[],
          forUser?: SignerWithAddress,
          overrides: PayableOverrides = {},
        ) => {
          const { user, userD } = instanceVars
          return multiInvoker
            .connect(userD)
            ['invoke(address,(uint8,bytes)[])']((forUser ?? user).address, args, overrides)
        },
      },
    ]

    testCases.forEach(({ context: contextStr, setup, invoke }) => {
      context(contextStr, async () => {
        beforeEach(async () => {
          await setup()
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

          await invoke(placeOrder)
          await settle(market, user)

          const userMarketPosition = await market.positions(user.address)

          // long limit not triggered yet
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

          await invoke(placeOrder)
          expect(await multiInvoker.latestNonce()).to.eq(1)

          const cancel = buildCancelOrder({ market: market.address, orderId: 1 })

          expect(await multiInvoker.connect(userB)['invoke((uint8,bytes)[])'](cancel)).to.be.reverted
          expect((await multiInvoker.orders(user.address, market.address, 1)).delta.abs()).to.eq(userPosition)

          await expect(invoke(cancel)).to.emit(multiInvoker, 'OrderCancelled').withArgs(user.address, market.address, 1)

          expect(await multiInvoker.latestNonce()).to.eq(1)
        })

        it('executes a long limit order', async () => {
          const { user, userC } = instanceVars

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition,
            price: triggerPrice,
            side: Dir.L,
            comparison: Compare.ABOVE_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a short limit order', async () => {
          const { user, userC } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition,
            price: triggerPrice,
            side: Dir.S,
            comparison: Compare.BELOW_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a long tp order', async () => {
          const { user, userC } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition.mul(-1),
            price: triggerPrice,
            side: Dir.L,
            comparison: Compare.BELOW_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            long: position,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a short tp order', async () => {
          const { user, userC } = instanceVars

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.0011'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition.mul(-1),
            price: triggerPrice,
            side: Dir.S,
            comparison: Compare.ABOVE_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            short: position,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a long sl order', async () => {
          const { user, userC } = instanceVars

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition.mul(-1),
            price: triggerPrice,
            side: Dir.L,
            comparison: Compare.ABOVE_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            long: position,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a short sl order', async () => {
          const { user, userC } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition.mul(-1),
            price: triggerPrice,
            side: Dir.S,
            comparison: Compare.BELOW_MARKET,
          })
          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            short: position,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a maker limit order', async () => {
          const { userB, userC } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition,
            price: triggerPrice,
            side: Dir.M,
            comparison: Compare.BELOW_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            collateral: collateral,
          })

          await expect(multiInvoker.connect(userB)['invoke((uint8,bytes)[])'](placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, userB)

          const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(userB.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a maker above market price order', async () => {
          const { userB, userC } = instanceVars

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition.mul(-1),
            price: triggerPrice,
            side: Dir.M,
            comparison: Compare.ABOVE_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            maker: (await market.positions(userB.address)).maker,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder, userB)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, userB)

          const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(userB.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes a maker below price order', async () => {
          const { userB, userC } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition.mul(-1),
            price: triggerPrice,
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

          await expect(invoke(placeOrder, userB)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, userB)

          const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(userB.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
        })

        it('executes an order with interface fee', async () => {
          const { marketFactory, user, userB, userC, dsu, oracle } = instanceVars
          await marketFactory.updateParameter({
            ...(await marketFactory.parameter()),
            referralFee: parse6decimal('0.05'),
          })

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition,
            price: triggerPrice,
            side: Dir.L,
            comparison: Compare.ABOVE_MARKET,
            interfaceFee1: { amount: 50e6, receiver: userB.address },
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          const balanceBefore = await dsu.balanceOf(userB.address)
          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          const currentTimestamp = await oracle.current()
          const expectedReferralFee = parse6decimal('5')

          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
            // FIXME: can't match OrderCreated events on Arbitrum due to timestamp discrepancy.
            // Suspect issue has something to do with KeeperFactory.current() effectiveGranularity.
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              validateOrderCreatedEvents
                ? { ...DEFAULT_ORDER, timestamp: currentTimestamp, collateral: -50e6 }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              userB.address,
              constants.AddressZero,
            )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              validateOrderCreatedEvents
                ? {
                    ...DEFAULT_ORDER,
                    timestamp: currentTimestamp,
                    orders: 1,
                    longPos: userPosition,
                    takerReferral: expectedReferralFee,
                    invalidation: 1,
                  }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              userB.address,
              constants.AddressZero,
            )
            .to.emit(multiInvoker, 'InterfaceFeeCharged')
            .withArgs(user.address, market.address, { receiver: userB.address, amount: 50e6 })

          await expect(multiInvoker.connect(userB).claim(userB.address, false)).to.not.be.reverted
          expect(await dsu.balanceOf(userB.address)).to.eq(balanceBefore.add(utils.parseEther('50')))
          expect(await market.orderReferrers(user.address, (await market.locals(user.address)).currentId)).to.eq(
            userB.address,
          )
        })

        it('executes an order with interface fee (unwrap)', async () => {
          const { marketFactory, user, userB, userC, usdc, oracle } = instanceVars
          await marketFactory.updateParameter({
            ...(await marketFactory.parameter()),
            referralFee: parse6decimal('0.05'),
          })

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition,
            price: triggerPrice,
            side: Dir.L,
            comparison: Compare.ABOVE_MARKET,
            interfaceFee1: { amount: 50e6, receiver: userB.address },
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          const balanceBefore = await usdc.balanceOf(userB.address)
          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          const currentTimestamp = await oracle.current()
          const expectedReferralFee = parse6decimal('5')

          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              validateOrderCreatedEvents
                ? { ...DEFAULT_ORDER, timestamp: currentTimestamp, collateral: -50e6 }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              userB.address,
              constants.AddressZero,
            )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              validateOrderCreatedEvents
                ? {
                    ...DEFAULT_ORDER,
                    timestamp: currentTimestamp,
                    orders: 1,
                    longPos: userPosition,
                    takerReferral: expectedReferralFee,
                    invalidation: 1,
                  }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              userB.address,
              constants.AddressZero,
            )
            .to.emit(multiInvoker, 'InterfaceFeeCharged')
            .withArgs(user.address, market.address, { receiver: userB.address, amount: 50e6 })

          await expect(multiInvoker.connect(userB).claim(userB.address, true)).to.not.be.reverted
          expect(await usdc.balanceOf(userB.address)).to.eq(balanceBefore.add(50e6))
          expect(await market.orderReferrers(user.address, (await market.locals(user.address)).currentId)).to.eq(
            userB.address,
          )
        })

        it('executes an order with multiple interface fees', async () => {
          const { marketFactory, user, userB, userC, userD, dsu, usdc, oracle } = instanceVars
          await marketFactory.updateParameter({
            ...(await marketFactory.parameter()),
            referralFee: parse6decimal('0.05'),
          })

          const triggerPrice = payoff(PRICE.sub(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: userPosition,
            price: triggerPrice,
            side: Dir.L,
            comparison: Compare.ABOVE_MARKET,
            interfaceFee1: { amount: 50e6, receiver: userB.address },
            interfaceFee2: { amount: 100e6, receiver: userD.address },
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          const balanceBefore = await usdc.balanceOf(userB.address)
          const balanceBefore2 = await dsu.balanceOf(userD.address)
          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          const currentTimestamp = await oracle.current()
          const expectedReferralFee = parse6decimal('5')

          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              validateOrderCreatedEvents
                ? { ...DEFAULT_ORDER, timestamp: currentTimestamp, collateral: -50e6 }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              userB.address,
              constants.AddressZero,
            )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              validateOrderCreatedEvents
                ? {
                    ...DEFAULT_ORDER,
                    timestamp: currentTimestamp,
                    orders: 1,
                    longPos: userPosition,
                    takerReferral: expectedReferralFee,
                    invalidation: 1,
                  }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              userB.address,
              constants.AddressZero,
            )
            .to.emit(multiInvoker, 'InterfaceFeeCharged')
            .withArgs(user.address, market.address, { receiver: userB.address, amount: 50e6 })
            .to.emit(multiInvoker, 'InterfaceFeeCharged')
            .withArgs(user.address, market.address, { receiver: userD.address, amount: 100e6 })

          await expect(multiInvoker.connect(userB).claim(userB.address, true)).to.not.be.reverted
          expect(await usdc.balanceOf(userB.address)).to.eq(balanceBefore.add(50e6))
          await expect(multiInvoker.connect(userD).claim(userD.address, false)).to.not.be.reverted
          expect(await dsu.balanceOf(userD.address)).to.eq(balanceBefore2.add(utils.parseEther('100')))
          expect(await market.orderReferrers(user.address, (await market.locals(user.address)).currentId)).to.eq(
            userB.address,
          )
        })

        it('executes a withdrawal order', async () => {
          const { user, userB, userC, usdc, oracle } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: collateral.div(-4),
            price: triggerPrice,
            side: Dir.C,
            comparison: Compare.BELOW_MARKET,
            fee: userPosition,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            maker: (await market.positions(user.address)).maker,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder, userB)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(userB.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, userB)

          const balanceBefore = await usdc.balanceOf(userB.address)
          const execute = buildExecOrder({ user: userB.address, market: market.address, orderId: 1 })
          const currentTimestamp = await oracle.current()
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(userB.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
            .to.emit(market, 'OrderCreated')
            .withArgs(
              userB.address,
              validateOrderCreatedEvents
                ? { ...DEFAULT_ORDER, timestamp: currentTimestamp, collateral: collateral.div(-4) }
                : anyValue,
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expect(await usdc.balanceOf(userB.address)).to.eq(balanceBefore.add(collateral.div(4)))
        })

        it('executes a max withdrawal order with order fee', async () => {
          const { user, userC, dsu, usdc } = instanceVars

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: MIN_INT64,
            price: triggerPrice,
            side: Dir.C,
            comparison: Compare.BELOW_MARKET,
          })

          const placeOrder = buildPlaceOrder({
            market: market.address,
            maker: 0,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          const executorBalanceBefore = await dsu.balanceOf(userC.address)
          const balanceBefore = await usdc.balanceOf(user.address)
          const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)
            .to.emit(multiInvoker, 'KeeperCall')
            .to.emit(market, 'OrderCreated')

          const executorDSUNet = (await dsu.balanceOf(userC.address)).sub(executorBalanceBefore)
          const feeCharged = executorDSUNet.div(BigNumber.from(10).pow(12))
          expect(await usdc.balanceOf(user.address)).to.be.within(
            balanceBefore.add(collateral.sub(feeCharged.add(1))),
            balanceBefore.add(collateral.sub(feeCharged)),
          )
        })

        it('executes a maker, long, and short magic close all order', async () => {
          const { user, userC } = instanceVars

          // ------------------- Maker close all ------------------------- //

          const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

          const trigger = openTriggerOrder({
            delta: 0,
            price: triggerPrice,
            side: Dir.M,
            comparison: Compare.BELOW_MARKET,
          })

          let placeOrder = buildPlaceOrder({
            market: market.address,
            maker: userPosition,
            order: trigger,
            collateral: collateral,
          })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          expect((await market.positions(user.address)).maker).to.be.eq(userPosition)

          let execute = buildExecOrder({
            user: user.address,
            market: market.address,
            orderId: 1,
            revertOnFailure: true,
          })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 1)

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          expect((await market.positions(user.address)).maker).to.be.eq(0)

          // ------------------- Long close all ------------------------- //
          trigger.side = Dir.L
          trigger.comparison = Compare.BELOW_MARKET

          placeOrder = buildPlaceOrder({ market: market.address, long: userPosition, order: trigger, collateral: 0 })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          expect((await market.positions(user.address)).long).to.be.eq(userPosition)

          execute = buildExecOrder({ user: user.address, market: market.address, orderId: 2, revertOnFailure: true })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 2)

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          expect((await market.positions(user.address)).long).to.be.eq(0)

          // ------------------- Short close all ------------------------- //
          trigger.side = Dir.S
          trigger.comparison = Compare.BELOW_MARKET

          placeOrder = buildPlaceOrder({ market: market.address, short: userPosition, order: trigger, collateral: 0 })

          await expect(invoke(placeOrder)).to.not.be.reverted
          expect(await multiInvoker.canExecuteOrder(user.address, market.address, 3)).to.be.false

          await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
          await settle(market, user)

          expect((await market.positions(user.address)).short).to.be.eq(userPosition)

          execute = buildExecOrder({ user: user.address, market: market.address, orderId: 3, revertOnFailure: true })
          await expect(multiInvoker.connect(userC)['invoke((uint8,bytes)[])'](execute))
            .to.emit(multiInvoker, 'OrderExecuted')
            .withArgs(user.address, market.address, 3)

          await advanceToPrice(PRICE.sub(utils.parseEther('0.0011')))
          await settle(market, user)

          expect((await market.positions(user.address)).short).to.be.eq(0)
        })

        describe('Sad path :(', () => {
          it('fails to execute an order that does not exist', async () => {
            const { user, userB } = instanceVars

            await expect(
              invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 0 }), userB),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerCantExecuteError')

            const trigger = openTriggerOrder({
              delta: position,
              price: 0,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
            })
            await expect(invoke(buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger }))).to
              .not.be.reverted

            await expect(invoke(buildCancelOrder({ market: market.address, orderId: 1 }))).to.emit(
              multiInvoker,
              'OrderCancelled',
            )

            await expect(
              invoke(buildExecOrder({ user: user.address, market: market.address, orderId: 1 }), userB),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerCantExecuteError')
          })

          it('fails to place order with 0 fee', async () => {
            const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

            const trigger = openTriggerOrder({
              delta: userPosition,
              price: triggerPrice,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
              fee: 0,
            })

            const placeOrder = buildPlaceOrder({
              market: market.address,
              order: trigger,
              collateral: collateral,
            })

            await expect(invoke(placeOrder)).to.be.revertedWithCustomError(
              multiInvoker,
              'MultiInvokerInvalidOrderError',
            )
          })

          it('fails to place order with comparison == 0 || > |1|', async () => {
            const triggerPrice = payoff(PRICE).div(1e12)

            const trigger = openTriggerOrder({
              delta: userPosition,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
              price: triggerPrice,
            })

            trigger.comparison = 0
            await expect(
              invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

            trigger.comparison = 2
            await expect(
              invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')

            trigger.comparison = -2
            await expect(
              invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
          })

          it('fails to place order with side > 3', async () => {
            const triggerPrice = payoff(PRICE).div(1e12)

            const trigger = openTriggerOrder({
              delta: userPosition,
              side: 4,
              comparison: Compare.ABOVE_MARKET,
              price: triggerPrice,
            })

            await expect(
              invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
          })

          it('fails to place order with side = 3, delta >= 0', async () => {
            const triggerPrice = payoff(PRICE).div(1e12)

            const trigger = openTriggerOrder({
              delta: collateral,
              side: 3,
              comparison: Compare.ABOVE_MARKET,
              price: triggerPrice,
            })

            await expect(
              invoke(buildPlaceOrder({ market: market.address, order: trigger, collateral: collateral })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidOrderError')
          })

          it('exceeds max trigger fee on execution', async () => {
            const { user, oracle } = instanceVars

            const triggerPrice = payoff(PRICE.add(utils.parseEther('0.001'))).div(1e12)

            const trigger = openTriggerOrder({
              delta: userPosition,
              price: triggerPrice,
              side: Dir.L,
              comparison: Compare.BELOW_MARKET,
              fee: 10,
            })

            const placeOrder = buildPlaceOrder({
              market: market.address,
              order: trigger,
              collateral: collateral,
            })

            await expect(invoke(placeOrder)).to.not.be.reverted
            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

            await advanceToPrice(PRICE.add(utils.parseEther('0.0011')))
            await settle(market, user)

            await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000000'])
            const execute = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
            const currentTimestamp = await oracle.current()
            await expect(invoke(execute, undefined, { maxFeePerGas: 16777216 }))
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                validateOrderCreatedEvents
                  ? { ...DEFAULT_ORDER, timestamp: currentTimestamp, orders: 1, longPos: userPosition, invalidation: 1 }
                  : anyValue,
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )
          })

          it('Fails to store TRIGGER values out of slot bounds', async () => {
            const { user } = instanceVars

            const defaultOrder = () =>
              openTriggerOrder({
                delta: parse6decimal('10000'),
                side: Dir.L,
                comparison: Compare.BELOW_MARKET,
                price: BigNumber.from(1000e6),
              })

            let testOrder = defaultOrder()

            testOrder.fee = MAX_UINT64.add(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()

            testOrder.price = MAX_INT64.add(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()

            testOrder.price = MIN_INT64.sub(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()

            testOrder.delta = MAX_INT64.add(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()

            testOrder.delta = MIN_INT64.sub(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()

            testOrder.interfaceFee1.amount = MAX_UINT48.add(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()

            testOrder.interfaceFee2.amount = MAX_UINT48.add(1)
            await assertStoreFail(testOrder, multiInvoker, market, user)
            testOrder = defaultOrder()
          })
        })
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
      multiInvoker
        .connect(user)
        ['invoke((uint8,bytes)[])'](buildPlaceOrder({ market: market.address, order: testOrder, collateral: 0 })),
    ).to.be.revertedWithCustomError(multiInvoker, 'TriggerOrderStorageInvalidError')
  }
}
