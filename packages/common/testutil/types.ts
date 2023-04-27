import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'

export interface Accumulator {
  _value: BigNumberish
}

export interface Position {
  version: BigNumberish
  maker: BigNumberish
  long: BigNumberish
  short: BigNumberish
}

export interface Account {
  collateral: BigNumberish
  reward: BigNumberish
  liquidation: boolean
}

export interface Version {
  makerValue: Accumulator
  longValue: Accumulator
  shortValue: Accumulator
  makerReward: Accumulator
  longReward: Accumulator
  shortReward: Accumulator
}

export interface Fee {
  protocol: BigNumberish
  market: BigNumberish
}

export function expectPositionEq(a: Position, b: Position): void {
  expect(a.version).to.equal(b.version)
  expect(a.maker).to.equal(b.maker)
  expect(a.long).to.equal(b.long)
  expect(a.short).to.equal(b.short)
}

export function expectAccountEq(a: Account, b: Account): void {
  expect(a.collateral).to.equal(b.collateral)
  expect(a.reward).to.equal(b.reward)
  expect(a.liquidation).to.equal(b.liquidation)
}

export function expectVersionEq(a: Version, b: Version): void {
  expect(a.makerValue._value).to.equal(b.makerValue._value)
  expect(a.longValue._value).to.equal(b.longValue._value)
  expect(a.shortValue._value).to.equal(b.shortValue._value)
  expect(a.makerReward._value).to.equal(b.makerReward._value)
  expect(a.longReward._value).to.equal(b.longReward._value)
  expect(a.shortReward._value).to.equal(b.shortReward._value)
}

export function expectFeeEq(a: Fee, b: Fee): void {
  expect(a.protocol).to.equal(b.protocol)
  expect(a.market).to.equal(b.market)
}

export function parse6decimal(amount: string): BigNumber {
  return utils.parseEther(amount).div(1e12)
}

export class Big18Math {
  public static BASE = constants.WeiPerEther

  public static mul(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(b).div(this.BASE)
  }

  public static div(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(this.BASE).div(b)
  }
}

export class Big6Math {
  public static BASE = BigNumber.from(1_000_000)

  public static mul(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(b).div(this.BASE)
  }

  public static div(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(this.BASE).div(b)
  }
}
