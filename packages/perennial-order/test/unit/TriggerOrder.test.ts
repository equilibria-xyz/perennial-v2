import HRE from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parse6decimal } from '../../../common/testutil/types'
import { expect } from 'chai'

import { TriggerOrderTester, TriggerOrderTester__factory, TriggerOrderStruct } from '../../types/generated'
import { Compare, compareOrders, DEFAULT_TRIGGER_ORDER, Side } from '../helpers/order'
import { OracleVersionStruct } from '../../types/generated/contracts/test/TriggerOrderTester'

const { ethers } = HRE

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

describe('TriggerOrder', () => {
  let owner: SignerWithAddress
  let orderTester: TriggerOrderTester

  before(async () => {
    ;[owner] = await ethers.getSigners()
    orderTester = await new TriggerOrderTester__factory(owner).deploy()
  })

  function createOracleVersion(price: BigNumber, valid = true): OracleVersionStruct {
    return {
      timestamp: Math.floor(Date.now() / 1000),
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
          flatFee: true,
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
          flatFee: false,
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
