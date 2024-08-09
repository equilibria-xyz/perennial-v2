import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { TriggerOrderStruct } from '../../types/generated/contracts/Manager'

export enum Side {
  MAKER = 4,
  LONG = 5,
  SHORT = 6,
}

export enum Compare {
  LTE = -1,
  GTE = 1,
}

export const MAGIC_VALUE_CLOSE_POSITION = BigNumber.from(2).pow(63).mul(-1)

export function compareOrders(actual: TriggerOrderStruct, expected: TriggerOrderStruct) {
  expect(actual.side).to.equal(expected.side)
  expect(actual.comparison).to.equal(expected.comparison)
  expect(actual.price).to.equal(expected.price)
  expect(actual.delta).to.equal(expected.delta)
  expect(actual.maxFee).to.equal(expected.maxFee)
  expect(actual.referrer).to.equal(expected.referrer)
}
