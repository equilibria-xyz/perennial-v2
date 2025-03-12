import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

import { TriggerOrderStruct } from '../../../types/generated/contracts/TriggerOrders/Manager'
import { TriggerOrderStructOutput } from '../../../types/generated/contracts/TriggerOrders/Manager'

export enum Side {
  MAKER = 4,
  LONG = 5,
  SHORT = 6,
}

export enum Compare {
  LTE = -1,
  GTE = 1,
}

export const DEFAULT_TRIGGER_ORDER = {
  side: Side.MAKER,
  comparison: Compare.GTE,
  price: constants.Zero,
  delta: parse6decimal('1'),
  maxFee: utils.parseEther('0.77'),
  isSpent: false,
  referrer: constants.AddressZero,
  additiveFee: 0,
}

export const MAGIC_VALUE_CLOSE_POSITION = BigNumber.from(2).pow(63).mul(-1)

export function compareOrders(actual: TriggerOrderStruct, expected: TriggerOrderStruct) {
  expect(actual.side).to.equal(expected.side)
  expect(actual.comparison).to.equal(expected.comparison)
  expect(actual.price).to.equal(expected.price)
  expect(actual.delta).to.equal(expected.delta)
  expect(actual.maxFee).to.equal(expected.maxFee)
  expect(actual.isSpent).to.equal(expected.isSpent)
  expect(actual.referrer).to.equal(expected.referrer)
  expect(actual.additiveFee).to.equal(expected.additiveFee)
}

export function orderFromStructOutput(structOutput: TriggerOrderStructOutput): TriggerOrderStruct {
  return {
    side: structOutput.side,
    comparison: structOutput.comparison,
    price: structOutput.price,
    delta: structOutput.delta,
    maxFee: structOutput.maxFee,
    isSpent: structOutput.isSpent,
    referrer: structOutput.referrer,
    additiveFee: structOutput.additiveFee,
  }
}
