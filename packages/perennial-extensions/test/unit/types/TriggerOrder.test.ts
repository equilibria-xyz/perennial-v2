// import * as generated from "../../../types/generated"
import { BigNumberish, BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { TriggerOrderTester, TriggerOrderTester__factory } from '../../../types/generated'
import HRE from 'hardhat'
import { expect } from 'chai'

type TriggerOrderStruct = {
  side: BigNumberish
  comparison: BigNumberish
  fee: BigNumberish
  price: BigNumberish
  delta: BigNumberish
}

// const MAX_UINT8 = BigNumber.from('255')
// const MIN_MAX_INT8 = BigNumber.from('127')
const MAX_UINT64 = BigNumber.from('18446744073709551615')
const MIN_MAX_UINT64 = BigNumber.from('9223372036854775807')

describe('Trigger order lib', () => {
  let triggerTester: TriggerOrderTester
  let defaultOrder: TriggerOrderStruct

  beforeEach(async () => {
    triggerTester = await new TriggerOrderTester__factory((await HRE.ethers.getSigners())[0]).deploy()
    defaultOrder = {
      side: 1,
      comparison: -1,
      fee: 100,
      price: BigNumber.from(1000e6),
      delta: parse6decimal('10000'),
    }
  })

  it('Writes and reads an valid trigger order', async () => {
    await triggerTester.storeTriggerOrder(defaultOrder)
    const retreivedOrder = await triggerTester.readTriggerOrder()
    expect(retreivedOrder.side).to.eq(defaultOrder.side)
    expect(retreivedOrder.comparison).to.eq(defaultOrder.comparison)
    expect(retreivedOrder.fee).to.eq(defaultOrder.fee)
    expect(retreivedOrder.price).to.eq(defaultOrder.price)
    expect(retreivedOrder.delta).to.eq(defaultOrder.delta)
  })

  it('Writes an invalid trigger order', async () => {
    let testOrder = defaultOrder

    //     testOrder.side= MAX_UINT8.add(1)
    //     await assertStoreFail(testOrder, triggerTester)
    //     testOrder = defaultOrder

    //     testOrder.comparison = MIN_MAX_INT8.add(1)
    //     await assertStoreFail(testOrder, triggerTester)
    //     testOrder = defaultOrder

    //     testOrder.comparison = MIN_MAX_INT8.add(1).mul(-1)
    //     await assertStoreFail(testOrder, triggerTester)
    //     testOrder = defaultOrder

    testOrder.fee = MAX_UINT64.add(1)
    await assertStoreFail(testOrder, triggerTester)
    testOrder = defaultOrder

    testOrder.price = MIN_MAX_UINT64.add(1)
    await assertStoreFail(testOrder, triggerTester)
    testOrder = defaultOrder

    testOrder.price = MIN_MAX_UINT64.add(1).mul(-1)
    await assertStoreFail(testOrder, triggerTester)
    testOrder = defaultOrder

    testOrder.delta = MIN_MAX_UINT64.add(1)
    await assertStoreFail(testOrder, triggerTester)
    testOrder = defaultOrder

    testOrder.delta = MIN_MAX_UINT64.add(1).mul(-1)
    await assertStoreFail(testOrder, triggerTester)
  })
})

async function assertStoreFail(testOrder: TriggerOrderStruct, tester: TriggerOrderTester) {
  await expect(tester.storeTriggerOrder(testOrder)).to.be.revertedWithCustomError(
    tester,
    'TriggerOrderStorageInvalidError',
  )
}
