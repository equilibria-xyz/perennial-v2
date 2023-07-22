import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'

export interface Accumulator {
  _value: BigNumberish
}

export interface Position {
  timestamp: BigNumberish
  maker: BigNumberish
  long: BigNumberish
  short: BigNumberish
  fee: BigNumberish
  collateral: BigNumberish
  delta: BigNumberish
}

export interface Global {
  currentId: BigNumberish
  latestId: BigNumberish
  protocolFee: BigNumberish
  oracleFee: BigNumberish
  riskFee: BigNumberish
  donation: BigNumberish
}

export interface Local {
  currentId: BigNumberish
  latestId: BigNumberish
  collateral: BigNumberish
  reward: BigNumberish
  protection: BigNumberish
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
  expect(a.timestamp).to.equal(b.timestamp, 'Position:Timestamp')
  expect(a.maker).to.equal(b.maker, 'Position:Maker')
  expect(a.long).to.equal(b.long, 'Position:Long')
  expect(a.short).to.equal(b.short, 'Position:Short')
  expect(a.fee).to.equal(b.fee, 'Position:Fee')
  expect(a.collateral).to.equal(b.collateral, 'Position:Collateral')
  expect(a.delta).to.equal(b.delta, 'Position:Delta')
}

export function expectGlobalEq(a: Global, b: Global): void {
  expect(a.currentId).to.equal(b.currentId, 'Global:CurrentId')
  expect(a.latestId).to.equal(b.latestId, 'Global:LatestId')
  expect(a.protocolFee).to.equal(b.protocolFee, 'Global:ProtocolFee')
  expect(a.oracleFee).to.equal(b.oracleFee, 'Global:OracleFee')
  expect(a.riskFee).to.equal(b.riskFee, 'Global:RiskFee')
  expect(a.donation).to.equal(b.donation, 'Global:Donation')
}

export function expectLocalEq(a: Local, b: Local): void {
  expect(a.currentId).to.equal(b.currentId, 'Local:Currentid')
  expect(a.latestId).to.equal(b.latestId, 'Local:LatestId')
  expect(a.collateral).to.equal(b.collateral, 'Local:Collateral')
  expect(a.reward).to.equal(b.reward, 'Local:Reward')
  expect(a.protection).to.equal(b.protection, 'Local:Protection')
}

export function expectVersionEq(a: Version, b: Version): void {
  expect(a.makerValue._value).to.equal(b.makerValue._value, 'Version:MakerValue')
  expect(a.longValue._value).to.equal(b.longValue._value, 'Version:LongValue')
  expect(a.shortValue._value).to.equal(b.shortValue._value, 'Version:ShortValue')
  expect(a.makerReward._value).to.equal(b.makerReward._value, 'Version:MakerReward')
  expect(a.longReward._value).to.equal(b.longReward._value, 'Version:LongReward')
  expect(a.shortReward._value).to.equal(b.shortReward._value, 'Version:ShortReward')
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

export const DEFAULT_POSITION: Position = {
  timestamp: 0,
  long: 0,
  maker: 0,
  short: 0,
  fee: 0,
  collateral: 0,
  delta: 0,
}
