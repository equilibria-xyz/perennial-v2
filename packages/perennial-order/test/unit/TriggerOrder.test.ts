import HRE from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parse6decimal } from '../../../common/testutil/types'
import { expect } from 'chai'

import { TriggerOrderTester, TriggerOrderTester__factory } from '../../types/generated'
import { TriggerOrderStruct } from '../../types/generated/contracts/test/TriggerOrderStorageTester'
import { Compare, Side } from '../helpers/order'
import { OracleVersionStruct } from '../../types/generated/contracts/test/TriggerOrderTester'

const { ethers } = HRE

// go long 300 if price drops below 1999.88
const ORDER_LONG: TriggerOrderStruct = {
  side: Side.LONG,
  comparison: Compare.LTE,
  price: parse6decimal('1999.88'),
  delta: parse6decimal('300'),
  maxFee: parse6decimal('0.66'),
  referrer: constants.AddressZero,
}

// short 400 if price exceeds 2444.55
const ORDER_SHORT: TriggerOrderStruct = {
  side: Side.SHORT,
  comparison: Compare.GTE,
  price: parse6decimal('2444.55'),
  delta: parse6decimal('400'),
  maxFee: parse6decimal('0.66'),
  referrer: constants.AddressZero,
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
        side: Side.MAKER,
        comparison: Compare.GTE,
        price: 0,
        delta: parse6decimal('200'),
        maxFee: parse6decimal('0.55'),
        referrer: constants.AddressZero,
      }
      expect(await orderTester.canExecute(zeroPriceOrder, createOracleVersion(parse6decimal('1')))).to.be.true
    })
  })

  describe('#storage', () => {
    it('stores and loads an order', async () => {
      await expect(orderTester.connect(owner).store(ORDER_LONG)).to.not.be.reverted

      const readOrder = await orderTester.read()
      expect(readOrder.side).to.equal(ORDER_LONG.side)
      expect(readOrder.comparison).to.equal(ORDER_LONG.comparison)
      expect(readOrder.price).to.equal(ORDER_LONG.price)
      expect(readOrder.delta).to.equal(ORDER_LONG.delta)
    })

    it('reverts storing order with invalid side', async () => {
      const badOrder = { ...ORDER_SHORT }
      badOrder.side = 5
      await expect(orderTester.connect(owner).store(badOrder)).to.be.revertedWithCustomError(
        orderTester,
        'TriggerOrderInvalidError',
      )
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
  })
})
