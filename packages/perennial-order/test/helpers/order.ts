import { expect } from 'chai'
import { TriggerOrderStruct } from '../../types/generated/contracts/Manager'

export enum Side {
  MAKER = 0,
  LONG = 1,
  SHORT = 2,
}

export enum Compare {
  LTE = -1,
  GTE = 1,
}

export function compareOrders(actual: TriggerOrderStruct, expected: TriggerOrderStruct) {
  expect(actual.side).to.equal(expected.side)
  expect(actual.comparison).to.equal(expected.comparison)
  expect(actual.price).to.equal(expected.price)
  expect(actual.delta).to.equal(expected.delta)
}