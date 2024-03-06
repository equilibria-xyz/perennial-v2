import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'

export interface OracleVersion {
  valid: boolean
  price: BigNumberish
  timestamp: BigNumberish
}

export interface Accumulator {
  _value: BigNumberish
}

export interface Checkpoint {
  tradeFee: BigNumberish
  settlementFee: BigNumberish
  transfer: BigNumberish
  collateral: BigNumberish
}

export interface Order {
  timestamp: BigNumberish
  orders: BigNumberish
  collateral: BigNumberish
  makerPos: BigNumberish
  makerNeg: BigNumberish
  longPos: BigNumberish
  longNeg: BigNumberish
  shortPos: BigNumberish
  shortNeg: BigNumberish
  protection: BigNumberish
  makerReferral: BigNumberish
  takerReferral: BigNumberish
}

export interface Position {
  timestamp: BigNumberish
  maker: BigNumberish
  long: BigNumberish
  short: BigNumberish
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
  claimable: BigNumberish
}

export interface Version {
  valid: boolean
  makerValue: Accumulator
  longValue: Accumulator
  shortValue: Accumulator
  makerLinearFee: Accumulator
  makerProportionalFee: Accumulator
  takerLinearFee: Accumulator
  takerProportionalFee: Accumulator
  makerPosFee: Accumulator
  makerNegFee: Accumulator
  takerPosFee: Accumulator
  takerNegFee: Accumulator
  settlementFee: Accumulator
  liquidationFee: Accumulator
}

export interface Fee {
  protocol: BigNumberish
  market: BigNumberish
}

export function expectCheckpointEq(a: Checkpoint, b: Checkpoint): void {
  expect(a.tradeFee).to.equal(b.tradeFee, 'Checkpoint:TradeFee')
  expect(a.settlementFee).to.equal(b.settlementFee, 'Checkpoint:SettlementFee')
  expect(a.transfer).to.equal(b.transfer, 'Checkpoint:Transfer')
  expect(a.collateral).to.equal(b.collateral, 'Checkpoint:Collateral')
}

export function expectOrderEq(a: Order, b: Order): void {
  expect(a.timestamp).to.equal(b.timestamp, 'Order:Timestamp')
  expect(a.orders).to.equal(b.orders, 'Order:Orders')
  expect(a.collateral).to.equal(b.collateral, 'Order:Collateral')
  expect(a.makerPos).to.equal(b.makerPos, 'Order:MakerPos')
  expect(a.makerNeg).to.equal(b.makerNeg, 'Order:MakerNeg')
  expect(a.longPos).to.equal(b.longPos, 'Order:LongPos')
  expect(a.longNeg).to.equal(b.longNeg, 'Order:LongNeg')
  expect(a.shortPos).to.equal(b.shortPos, 'Order:ShortPos')
  expect(a.shortNeg).to.equal(b.shortNeg, 'Order:ShortNeg')
  expect(a.protection).to.equal(b.protection, 'Order:Protection')
  expect(a.makerReferral).to.equal(b.makerReferral, 'Order:MakerReferral')
  expect(a.takerReferral).to.equal(b.takerReferral, 'Order:TakerReferral')
}

export function expectPositionEq(a: Position, b: Position): void {
  expect(a.timestamp).to.equal(b.timestamp, 'Position:Timestamp')
  expect(a.maker).to.equal(b.maker, 'Position:Maker')
  expect(a.long).to.equal(b.long, 'Position:Long')
  expect(a.short).to.equal(b.short, 'Position:Short')
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
  expect(a.claimable).to.equal(b.claimable, 'Local:Claimable')
}

export function expectVersionEq(a: Version, b: Version): void {
  expect(a.valid).to.equal(b.valid, 'Version:Valid')
  expect(a.makerValue._value).to.equal(b.makerValue._value, 'Version:MakerValue')
  expect(a.longValue._value).to.equal(b.longValue._value, 'Version:LongValue')
  expect(a.shortValue._value).to.equal(b.shortValue._value, 'Version:ShortValue')
  expect(a.makerLinearFee._value).to.equal(b.makerLinearFee._value, 'Version:MakerLinearFee')
  expect(a.makerProportionalFee._value).to.equal(b.makerProportionalFee._value, 'Version:MakerProportionalFee')
  expect(a.takerLinearFee._value).to.equal(b.takerLinearFee._value, 'Version:TakerLinearFee')
  expect(a.takerProportionalFee._value).to.equal(b.takerProportionalFee._value, 'Version:TakerProportionalFee')
  expect(a.makerPosFee._value).to.equal(b.makerPosFee._value, 'Version:MakerPosFee')
  expect(a.makerNegFee._value).to.equal(b.makerNegFee._value, 'Version:MakerNegFee')
  expect(a.takerPosFee._value).to.equal(b.takerPosFee._value, 'Version:TakerPosFee')
  expect(a.takerNegFee._value).to.equal(b.takerNegFee._value, 'Version:TakerNegFee')
  expect(a.settlementFee._value).to.equal(b.settlementFee._value, 'Version:SettlementFee')
  expect(a.liquidationFee._value).to.equal(b.liquidationFee._value, 'Version:LiquidationFee')
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

export const DEFAULT_CHECKPOINT: Checkpoint = {
  tradeFee: 0,
  settlementFee: 0,
  transfer: 0,
  collateral: 0,
}

export const DEFAULT_POSITION: Position = {
  timestamp: 0,
  long: 0,
  maker: 0,
  short: 0,
}

export const DEFAULT_LOCAL: Local = {
  currentId: 0,
  latestId: 0,
  collateral: 0,
  claimable: 0,
}

export const DEFAULT_ORDER: Order = {
  timestamp: 0,
  orders: 0,
  makerPos: 0,
  makerNeg: 0,
  longPos: 0,
  longNeg: 0,
  shortPos: 0,
  shortNeg: 0,
  collateral: 0,
  protection: 0,
  makerReferral: 0,
  takerReferral: 0,
}

export const DEFAULT_VERSION: Version = {
  valid: true,
  makerValue: { _value: 0 },
  longValue: { _value: 0 },
  shortValue: { _value: 0 },
  makerLinearFee: { _value: 0 },
  makerProportionalFee: { _value: 0 },
  takerLinearFee: { _value: 0 },
  takerProportionalFee: { _value: 0 },
  makerPosFee: { _value: 0 },
  makerNegFee: { _value: 0 },
  takerPosFee: { _value: 0 },
  takerNegFee: { _value: 0 },
  settlementFee: { _value: 0 },
  liquidationFee: { _value: 0 },
}
