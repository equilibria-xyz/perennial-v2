import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'
import exp from 'constants'

export interface OracleVersion {
  valid: boolean
  price: BigNumberish
  timestamp: BigNumberish
}

export interface OracleReceipt {
  settlementFee: BigNumberish
  oracleFee: BigNumberish
}

export interface PAccumulator {
  _value: BigNumberish
  _skew: BigNumberish
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

export interface Guarantee {
  orders: BigNumberish
  longPos: BigNumberish
  longNeg: BigNumberish
  shortPos: BigNumberish
  shortNeg: BigNumberish
  notional: BigNumberish
  takerFee: BigNumberish
  referral: BigNumberish
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
  latestPrice: BigNumberish
  pAccumulator: PAccumulator
}

export interface Local {
  currentId: BigNumberish
  latestId: BigNumberish
  collateral: BigNumberish
  claimable: BigNumberish
}

export interface Version {
  valid: boolean
  price: BigNumberish
  makerPosExposure: BigNumberish
  makerNegExposure: BigNumberish
  longPosExposure: BigNumberish
  longNegExposure: BigNumberish
  shortPosExposure: BigNumberish
  shortNegExposure: BigNumberish
  makerPreValue: Accumulator
  longPreValue: Accumulator
  shortPreValue: Accumulator
  makerCloseValue: Accumulator
  longCloseValue: Accumulator
  shortCloseValue: Accumulator
  longPostValue: Accumulator
  shortPostValue: Accumulator
  spreadPos: Accumulator
  spreadNeg: Accumulator
  makerFee: Accumulator
  takerFee: Accumulator
  settlementFee: Accumulator
  liquidationFee: Accumulator
}

export interface Fee {
  protocol: BigNumberish
  market: BigNumberish
}

export interface MarketParameter {
  fundingFee: BigNumberish
  interestFee: BigNumberish
  makerFee: BigNumberish
  takerFee: BigNumberish
  riskFee: BigNumberish
  maxPendingGlobal: number
  maxPendingLocal: number
  maxPriceDeviation: BigNumberish
  closed: boolean
  settle: boolean
}

export interface SynBook {
  d0: BigNumberish
  d1: BigNumberish
  d2: BigNumberish
  d3: BigNumberish
  scale: BigNumberish
}

export interface UtilizationCurve {
  minRate: BigNumberish
  maxRate: BigNumberish
  targetRate: BigNumberish
  targetUtilization: BigNumberish
}

export interface PController {
  k: BigNumberish
  min: BigNumberish
  max: BigNumberish
}

export interface RiskParameter {
  margin: BigNumberish
  maintenance: BigNumberish
  synBook: SynBook
  makerLimit: BigNumberish
  efficiencyLimit: BigNumberish
  liquidationFee: BigNumberish
  utilizationCurve: UtilizationCurve
  pController: PController
  minMargin: BigNumberish
  minMaintenance: BigNumberish
  staleAfter: BigNumberish
  makerReceiveOnly: boolean
}

export interface Context {
  account: string
  marketParameter: MarketParameter
  riskParameter: RiskParameter
  latestOracleVersion: OracleVersion
  currentTimestamp: number
  global: Global
  local: Local
  latestPositionGlobal: Position
  latestPositionLocal: Position
  pendingGlobal: Order
  pendingLocal: Order
}

export interface SettlementContext {
  latestVersion: Version
  latestCheckpoint: Checkpoint
  orderOracleVersion: OracleVersion
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

export function expectGuaranteeEq(a: Guarantee, b: Guarantee): void {
  expect(a.orders).to.equal(b.orders, 'Order:Orders')
  expect(a.longPos).to.equal(b.longPos, 'Order:LongPos')
  expect(a.longNeg).to.equal(b.longNeg, 'Order:LongNeg')
  expect(a.shortPos).to.equal(b.shortPos, 'Order:ShortPos')
  expect(a.shortNeg).to.equal(b.shortNeg, 'Order:ShortNeg')
  expect(a.notional).to.equal(b.notional, 'Order:Notional')
  expect(a.takerFee).to.equal(b.takerFee, 'Order:TakerFee')
  expect(a.referral).to.equal(b.referral, 'Order:Referral')
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
  expect(a.latestPrice).to.equal(b.latestPrice, 'Global:LatestPrice')
}

export function expectLocalEq(a: Local, b: Local): void {
  expect(a.currentId).to.equal(b.currentId, 'Local:Currentid')
  expect(a.latestId).to.equal(b.latestId, 'Local:LatestId')
  // ensure no nonzero values were written to storage
  expect(a.collateral).to.equal(constants.Zero)
  expect(a.claimable).to.equal(constants.Zero)
  // ensure no test expected a nonzero value
  expect(b.collateral).to.equal(constants.Zero)
  expect(b.claimable).to.equal(constants.Zero)
}

export function expectVersionEq(a: Version, b: Version): void {
  expect(a.valid).to.equal(b.valid, 'Version:Valid')
  expect(a.price).to.equal(b.price, 'Version:Price')
  expect(a.makerPreValue._value).to.equal(b.makerPreValue._value, 'Version:MakerPreValue')
  expect(a.longPreValue._value).to.equal(b.longPreValue._value, 'Version:LongPreValue')
  expect(a.shortPreValue._value).to.equal(b.shortPreValue._value, 'Version:ShortPreValue')
  expect(a.makerCloseValue._value).to.equal(b.makerCloseValue._value, 'Version:MakerCloseValue')
  expect(a.longCloseValue._value).to.equal(b.longCloseValue._value, 'Version:LongCloseValue')
  expect(a.shortCloseValue._value).to.equal(b.shortCloseValue._value, 'Version:ShortCloseValue')
  expect(a.longPostValue._value).to.equal(b.longPostValue._value, 'Version:LongPostValue')
  expect(a.shortPostValue._value).to.equal(b.shortPostValue._value, 'Version:ShortPostValue')
  expect(a.spreadPos._value).to.equal(b.spreadPos._value, 'Version:SpreadPos')
  expect(a.spreadNeg._value).to.equal(b.spreadNeg._value, 'Version:SpreadNeg')
  expect(a.makerFee._value).to.equal(b.makerFee._value, 'Version:MakerFee')
  expect(a.takerFee._value).to.equal(b.takerFee._value, 'Version:TakerFee')
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

export const DEFAULT_GLOBAL: Global = {
  currentId: 0,
  latestId: 0,
  protocolFee: 0,
  oracleFee: 0,
  riskFee: 0,
  latestPrice: 0,
  pAccumulator: {
    _value: 0,
    _skew: 0,
  },
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

export const DEFAULT_GUARANTEE: Guarantee = {
  orders: 0,
  longPos: 0,
  longNeg: 0,
  shortPos: 0,
  shortNeg: 0,
  notional: 0,
  takerFee: 0,
  referral: 0,
}

export const DEFAULT_VERSION: Version = {
  valid: true,
  price: 0,
  makerPosExposure: 0,
  makerNegExposure: 0,
  longPosExposure: 0,
  longNegExposure: 0,
  shortPosExposure: 0,
  shortNegExposure: 0,
  makerPreValue: { _value: 0 },
  longPreValue: { _value: 0 },
  shortPreValue: { _value: 0 },
  makerCloseValue: { _value: 0 },
  longCloseValue: { _value: 0 },
  shortCloseValue: { _value: 0 },
  longPostValue: { _value: 0 },
  shortPostValue: { _value: 0 },
  spreadPos: { _value: 0 },
  spreadNeg: { _value: 0 },
  makerFee: { _value: 0 },
  takerFee: { _value: 0 },
  settlementFee: { _value: 0 },
  liquidationFee: { _value: 0 },
}

export const DEFAULT_ORACLE_RECEIPT: OracleReceipt = {
  settlementFee: 0,
  oracleFee: 0,
}

export const DEFAULT_ORACLE_VERSION: OracleVersion = {
  valid: true, // a valid version is the default
  price: 0,
  timestamp: 0,
}

export const DEFAULT_MARKET_PARAMETER: MarketParameter = {
  fundingFee: 0,
  interestFee: 0,
  makerFee: 0,
  takerFee: 0,
  riskFee: 0,
  maxPendingGlobal: 0,
  maxPendingLocal: 0,
  maxPriceDeviation: 0,
  closed: false,
  settle: false,
}

export const DEFAULT_SYN_BOOK: SynBook = {
  d0: 0,
  d1: 0,
  d2: 0,
  d3: 0,
  scale: 0,
}

export const DEFAULT_UTILIZATION_CURVE: UtilizationCurve = {
  minRate: 0,
  maxRate: 0,
  targetRate: 0,
  targetUtilization: 0,
}

export const DEFAULT_PCONTROLLER: PController = {
  k: 0,
  min: 0,
  max: 0,
}

export const DEFAULT_RISK_PARAMETER: RiskParameter = {
  margin: 0,
  maintenance: 0,
  synBook: DEFAULT_SYN_BOOK,
  makerLimit: 0,
  efficiencyLimit: 0,
  liquidationFee: 0,
  utilizationCurve: DEFAULT_UTILIZATION_CURVE,
  pController: DEFAULT_PCONTROLLER,
  minMargin: 0,
  minMaintenance: 0,
  staleAfter: 0,
  makerReceiveOnly: false,
}

export const DEFAULT_CONTEXT: Context = {
  account: constants.AddressZero,
  marketParameter: DEFAULT_MARKET_PARAMETER,
  riskParameter: DEFAULT_RISK_PARAMETER,
  latestOracleVersion: DEFAULT_ORACLE_VERSION,
  currentTimestamp: 0,
  global: DEFAULT_GLOBAL,
  local: DEFAULT_LOCAL,
  latestPositionGlobal: DEFAULT_POSITION,
  latestPositionLocal: DEFAULT_POSITION,
  pendingGlobal: DEFAULT_ORDER,
  pendingLocal: DEFAULT_ORDER,
}

export const DEFAULT_SETTLEMENT_CONTEXT: SettlementContext = {
  latestVersion: DEFAULT_VERSION,
  latestCheckpoint: DEFAULT_CHECKPOINT,
  orderOracleVersion: DEFAULT_ORACLE_VERSION,
}
