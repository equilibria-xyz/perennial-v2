import { BigNumber, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parse6decimal } from '../../../../common/testutil/types'
import { expect } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import HRE from 'hardhat'

import { IMarket, IOracleProvider, TriggerOrderTester, TriggerOrderTester__factory } from '../../../types/generated'
import {
  Compare,
  compareOrders,
  DEFAULT_TRIGGER_ORDER,
  MAGIC_VALUE_CLOSE_POSITION,
  Side,
} from '../../helpers/TriggerOrders/order'
import {
  OracleVersionStruct,
  TriggerOrderStruct,
} from '../../../types/generated/contracts/TriggerOrders/test/TriggerOrderTester'

const { ethers } = HRE

const ORDER_MAKER: TriggerOrderStruct = {
  ...DEFAULT_TRIGGER_ORDER,
  delta: parse6decimal('10'),
}

// go long 300 if price drops below 1999.88
const ORDER_LONG: TriggerOrderStruct = {
  ...DEFAULT_TRIGGER_ORDER,
  side: Side.LONG,
  comparison: Compare.LTE,
  price: parse6decimal('1999.88'),
  delta: parse6decimal('300'),
  maxFee: parse6decimal('0.66'),
}

// short 400 if price exceeds 2444.55
const ORDER_SHORT: TriggerOrderStruct = {
  ...DEFAULT_TRIGGER_ORDER,
  side: Side.SHORT,
  comparison: Compare.GTE,
  price: parse6decimal('2444.55'),
  delta: parse6decimal('400'),
  maxFee: parse6decimal('0.66'),
}

function now(): BigNumber {
  return BigNumber.from(Math.floor(Date.now() / 1000))
}

describe('TriggerOrder', () => {
  let owner: SignerWithAddress
  let orderTester: TriggerOrderTester

  before(async () => {
    ;[owner] = await ethers.getSigners()
    orderTester = await new TriggerOrderTester__factory(owner).deploy()
  })

  function createOracleVersion(price: BigNumber, valid = true): OracleVersionStruct {
    return {
      timestamp: now(),
      price: price,
      valid: valid,
    }
  }

  describe('#logic', () => {
    it('handles invalid oracle version', async () => {
      const invalidVersion = createOracleVersion(parse6decimal('2444.66'), false)
      expect(await orderTester.canExecute(ORDER_SHORT, invalidVersion)).to.be.false
    })

    it('compares greater than', async () => {
      // ORDER_SHORT price is 2444.55
      expect(await orderTester.canExecute(ORDER_SHORT, createOracleVersion(parse6decimal('3000')))).to.be.true
      expect(await orderTester.canExecute(ORDER_SHORT, createOracleVersion(parse6decimal('2000')))).to.be.false
    })

    it('compares less than', async () => {
      // ORDER_LONG price is 1999.88
      expect(await orderTester.canExecute(ORDER_LONG, createOracleVersion(parse6decimal('1800')))).to.be.true
      expect(await orderTester.canExecute(ORDER_LONG, createOracleVersion(parse6decimal('2000')))).to.be.false
    })

    it('handles invalid comparison', async () => {
      const badOrder = { ...ORDER_SHORT }
      badOrder.comparison = 0
      expect(await orderTester.canExecute(badOrder, createOracleVersion(parse6decimal('1800')))).to.be.false
      expect(await orderTester.canExecute(badOrder, createOracleVersion(parse6decimal('2000')))).to.be.false
    })

    it('allows execution greater than 0 trigger price', async () => {
      const zeroPriceOrder = {
        ...DEFAULT_TRIGGER_ORDER,
        side: Side.MAKER,
        comparison: Compare.GTE,
        price: 0,
        delta: parse6decimal('200'),
        maxFee: parse6decimal('0.55'),
      }
      expect(await orderTester.canExecute(zeroPriceOrder, createOracleVersion(parse6decimal('1')))).to.be.true
    })
  })

  describe('#notional', () => {
    let market: FakeContract<IMarket>
    let marketOracle: FakeContract<IOracleProvider>
    let user: SignerWithAddress
    let recipient: SignerWithAddress

    before(async () => {
      ;[user, recipient] = await ethers.getSigners()
      market = await smock.fake<IMarket>('IMarket')
      marketOracle = await smock.fake<IOracleProvider>('IOracleProvider')
      market.oracle.returns(marketOracle.address)
    })

    function mockPrice(price: BigNumber) {
      marketOracle.latest.returns({
        timestamp: Math.floor(Date.now() / 1000),
        price: price,
        valid: true,
      })
    }

    function mockPosition(side: Side, current: BigNumber, pending: BigNumber) {
      market.positions.returns({
        timestamp: now().sub(33),
        maker: side === Side.MAKER ? current : constants.Zero,
        long: side === Side.LONG ? current : constants.Zero,
        short: side === Side.SHORT ? current : constants.Zero,
      })
      market.pendings.returns({
        timestamp: now(),
        orders: constants.One,
        collateral: constants.Zero,
        makerPos: side === Side.MAKER && pending.gt(0) ? pending : constants.Zero,
        makerNeg: side === Side.MAKER && pending.lt(0) ? pending.mul(-1) : constants.Zero,
        longPos: side === Side.LONG && pending.gt(0) ? pending : constants.Zero,
        longNeg: side === Side.LONG && pending.lt(0) ? pending.mul(-1) : constants.Zero,
        shortPos: side === Side.SHORT && pending.gt(0) ? pending : constants.Zero,
        shortNeg: side === Side.SHORT && pending.lt(0) ? pending.mul(-1) : constants.Zero,
        protection: constants.Zero,
        invalidation: pending.isZero() ? 0 : 1,
        makerReferral: constants.Zero,
        takerReferral: constants.Zero,
      })
    }

    it('calculates notional for maker order', async () => {
      mockPrice(parse6decimal('62.38'))
      const expectedNotional = parse6decimal('623.8') // price * delta
      expect(await orderTester.notionalValue(ORDER_MAKER, market.address, user.address)).to.equal(expectedNotional)
    })

    it('calculates notional for long order with small price', async () => {
      mockPrice(parse6decimal('0.008052'))
      const order = {
        ...ORDER_LONG,
        delta: parse6decimal('370001.000436'),
      }
      const expectedNotional = parse6decimal('2979.248055') // price * delta
      expect(await orderTester.notionalValue(order, market.address, user.address)).to.equal(expectedNotional)
    })

    it('calculates notional for short order with large price', async () => {
      mockPrice(parse6decimal('987000.654321'))
      const order = {
        ...ORDER_SHORT,
        delta: parse6decimal('0.003039'),
      }
      const expectedNotional = parse6decimal('2999.494988') // price * delta
      expect(await orderTester.notionalValue(order, market.address, user.address)).to.equal(expectedNotional)
    })

    it('calculates notional to close position', async () => {
      mockPrice(parse6decimal('2000'))
      mockPosition(Side.MAKER, parse6decimal('12.2'), constants.Zero)
      const order = {
        ...ORDER_MAKER,
        delta: MAGIC_VALUE_CLOSE_POSITION,
        interfaceFee: {
          amount: parse6decimal('0.0111'),
          receiver: recipient.address,
          fixedFee: false,
          unwrap: true,
        },
      }
      const expectedNotional = parse6decimal('24400') // price * position

      expect(await orderTester.notionalValue(order, market.address, user.address)).to.equal(expectedNotional)
    })

    it('calculates notional to close position with pending open', async () => {
      mockPrice(parse6decimal('2000'))
      mockPosition(Side.MAKER, parse6decimal('12.2'), parse6decimal('0.3'))
      const order = {
        ...ORDER_MAKER,
        delta: MAGIC_VALUE_CLOSE_POSITION,
        interfaceFee: {
          amount: parse6decimal('0.0111'),
          receiver: recipient.address,
          fixedFee: false,
          unwrap: true,
        },
      }
      const expectedNotional = parse6decimal('25000') // price * position
      expect(await orderTester.notionalValue(order, market.address, user.address)).to.equal(expectedNotional)
    })

    it('calculates national to close position with pending close', async () => {
      mockPrice(parse6decimal('2000'))
      mockPosition(Side.MAKER, parse6decimal('12.2'), parse6decimal('-0.2'))
      const order = {
        ...ORDER_MAKER,
        delta: MAGIC_VALUE_CLOSE_POSITION,
        interfaceFee: {
          amount: parse6decimal('0.0111'),
          receiver: recipient.address,
          fixedFee: false,
          unwrap: true,
        },
      }
      const expectedNotional = parse6decimal('24000') // price * position
      expect(await orderTester.notionalValue(order, market.address, user.address)).to.equal(expectedNotional)
    })

    it('reverts calculating notional for an invalid side', async () => {
      mockPrice(parse6decimal('1000'))
      mockPosition(Side.MAKER, parse6decimal('3'), constants.Zero)
      const order = {
        ...DEFAULT_TRIGGER_ORDER,
        side: 3,
        delta: MAGIC_VALUE_CLOSE_POSITION,
        interfaceFee: {
          amount: parse6decimal('0.004747'),
          receiver: recipient.address,
          fixedFee: false,
          unwrap: false,
        },
      }
      await expect(orderTester.notionalValue(order, market.address, user.address)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderInvalidError',
      )
    })
  })

  describe('#storage', () => {
    it('stores and loads an order without fees', async () => {
      await expect(orderTester.connect(owner).store(ORDER_LONG)).to.not.be.reverted

      const readOrder = await orderTester.read()
      compareOrders(readOrder, ORDER_LONG)
    })

    it('stores and loads an order with flat fee', async () => {
      const [userA, userB] = await ethers.getSigners()
      const writeOrder = {
        ...ORDER_LONG,
        referrer: userA.address,
        interfaceFee: {
          amount: parse6decimal('0.44'),
          receiver: userB.address,
          fixedFee: true,
          unwrap: false,
        },
      }
      await expect(orderTester.connect(owner).store(writeOrder)).to.not.be.reverted

      const readOrder = await orderTester.read()
      compareOrders(readOrder, writeOrder)
    })

    it('stores and loads an order with unwrap', async () => {
      const [userA, userB] = await ethers.getSigners()
      const writeOrder = {
        ...ORDER_LONG,
        referrer: userB.address,
        interfaceFee: {
          amount: parse6decimal('0.005555'),
          receiver: userA.address,
          fixedFee: false,
          unwrap: true,
        },
      }
      await expect(orderTester.connect(owner).store(writeOrder)).to.not.be.reverted

      const readOrder = await orderTester.read()
      compareOrders(readOrder, writeOrder)
    })

    it('reverts storing order with invalid side', async () => {
      const badOrder = { ...ORDER_SHORT }
      const badSides = [0, 1, 2, 3, 7]
      for (const badSide of badSides) {
        badOrder.side = badSide
        await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
          orderTester,
          'TriggerOrderInvalidError',
        )
      }
    })

    it('reverts storing order with invalid comparison', async () => {
      const badOrder = { ...ORDER_SHORT }
      badOrder.comparison = 4
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderInvalidError',
      )
    })

    it('reverts storing order with price overflow or underflow', async () => {
      const badOrder = { ...ORDER_SHORT }
      badOrder.price = BigNumber.from(2).pow(64).add(1)
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderStorageInvalidError',
      )
      badOrder.price = badOrder.price.mul(-1)
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderStorageInvalidError',
      )
    })

    it('reverts storing order with delta overflow or underflow', async () => {
      const badOrder = { ...ORDER_SHORT }
      badOrder.delta = BigNumber.from(2).pow(64).add(1)
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderStorageInvalidError',
      )
      badOrder.delta = badOrder.delta.mul(-1)
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderStorageInvalidError',
      )
    })

    it('reverts storing order with maxFee overflow', async () => {
      const badOrder = { ...ORDER_SHORT }
      badOrder.maxFee = BigNumber.from(2).pow(64).add(1)
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderStorageInvalidError',
      )
    })

    it('reverts storing order with interface fee overflow', async () => {
      const [userA] = await ethers.getSigners()
      const badOrder = { ...ORDER_SHORT }
      badOrder.interfaceFee.amount = BigNumber.from(2).pow(64).add(1)
      badOrder.interfaceFee.receiver = userA.address
      badOrder.interfaceFee.unwrap = false
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderStorageInvalidError',
      )
    })
  })
})
