import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'

export interface Accumulator {
  _value: BigNumberish
}

export interface Account {
  latestVersion: BigNumberish
  maker: BigNumberish
  long: BigNumberish
  short: BigNumberish
  nextMaker: BigNumberish
  nextLong: BigNumberish
  nextShort: BigNumberish
  collateral: BigNumberish
  reward: BigNumberish
  liquidation: boolean
}

export interface Position {
  maker: BigNumberish
  long: BigNumberish
  short: BigNumberish
  makerNext: BigNumberish
  longNext: BigNumberish
  shortNext: BigNumberish
}

export interface Version {
  makerValue: Accumulator
  longValue: Accumulator
  shortValue: Accumulator
  makerReward: Accumulator
  longReward: Accumulator
  shortReward: Accumulator
}

export function expectAccountEq(a: Account, b: Account): void {
  expect(a.latestVersion).to.equal(b.latestVersion)
  expect(a.maker).to.equal(b.maker)
  expect(a.long).to.equal(b.long)
  expect(a.short).to.equal(b.short)
  expect(a.nextMaker).to.equal(b.nextMaker)
  expect(a.nextLong).to.equal(b.nextLong)
  expect(a.nextShort).to.equal(b.nextShort)
  expect(a.collateral).to.equal(b.collateral)
  expect(a.reward).to.equal(b.reward)
  expect(a.liquidation).to.equal(b.liquidation)
}

export function expectPositionEq(a: Position, b: Position): void {
  expect(a.maker).to.equal(b.maker)
  expect(a.long).to.equal(b.long)
  expect(a.short).to.equal(b.short)
  expect(a.makerNext).to.equal(b.makerNext)
  expect(a.longNext).to.equal(b.longNext)
  expect(a.shortNext).to.equal(b.shortNext)
}

export function expectVersionEq(a: Version, b: Version): void {
  expect(a.makerValue).to.equal(b.makerValue)
  expect(a.longValue).to.equal(b.longValue)
  expect(a.shortValue).to.equal(b.shortValue)
  expect(a.makerReward).to.equal(b.makerReward)
  expect(a.longReward).to.equal(b.longReward)
  expect(a.shortReward).to.equal(b.shortReward)
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
