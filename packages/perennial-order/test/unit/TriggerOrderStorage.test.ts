import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parse6decimal } from '../../../common/testutil/types'
import { expect } from 'chai'

import { TriggerOrderStorageTester, TriggerOrderStorageTester__factory } from '../../types/generated'
import { TriggerOrderStruct } from '../../types/generated/contracts/test/TriggerOrderStorageTester'

const { ethers } = HRE

describe('TriggerOrderStorage', () => {
  let owner: SignerWithAddress
  let orderTester: TriggerOrderStorageTester

  before(async () => {
    ;[owner] = await ethers.getSigners()
    orderTester = await new TriggerOrderStorageTester__factory(owner).deploy()
  })

  it('stores and loads an order', async () => {
    // go long 300 if price drops below 1999.88
    const newOrder: TriggerOrderStruct = {
      side: 1,
      comparison: -2,
      price: parse6decimal('1999.88'),
      delta: parse6decimal('300'),
    }

    await expect(orderTester.connect(owner).store(newOrder)).to.not.be.reverted

    const readOrder = await orderTester.read()
    console.log(readOrder)
    expect(readOrder.side).to.equal(newOrder.side)
    expect(readOrder.comparison).to.equal(newOrder.comparison)
    expect(readOrder.price).to.equal(newOrder.price)
    expect(readOrder.delta).to.equal(newOrder.delta)
  })
})
