import HRE from 'hardhat'
import { BigNumber } from 'ethers'
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
  comparison: Compare.LT,
  price: parse6decimal('1999.88'),
  delta: parse6decimal('300'),
}

// short 400 if price exceeds 2444.55
const ORDER_SHORT: TriggerOrderStruct = {
  side: Side.SHORT,
  comparison: Compare.GT,
  price: parse6decimal('2444.55'),
  delta: parse6decimal('400'),
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

    // TODO: gte, lte, eq, if we keep them
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

    // TODO: test handling for underflow/overflow conditions
  })
})
