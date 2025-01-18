import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'

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
  invalidation: BigNumberish
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
  orderReferral: BigNumberish
  solverReferral: BigNumberish
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
  exposure: BigNumberish
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
  makerValue: Accumulator
  longValue: Accumulator
  shortValue: Accumulator
  makerFee: Accumulator
  takerFee: Accumulator
  makerOffset: Accumulator
  takerPosOffset: Accumulator
  takerNegOffset: Accumulator
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

export interface AdiabaticFee {
  linearFee: BigNumberish
  proportionalFee: BigNumberish
  adiabaticFee: BigNumberish
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
  takerFee: AdiabaticFee
  makerFee: AdiabaticFee
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

export type Common = {
  account: string
  signer: string
  domain: string
  nonce: BigNumberish
  group: BigNumberish
  expiry: BigNumberish
}

export interface Take {
  amount: BigNumberish
  referrer: string
  common: Common
}

export interface AccessUpdate {
  accessor: string
  approved: boolean
}

export interface AccessUpdateBatch {
  operators: AccessUpdate[]
  signers: AccessUpdate[]
  common: Common
}

export interface SignerUpdate {
  access: {
    accessor: string
    approved: boolean
  }
  common: Common
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
  expect(a.notional).to.equal(b.notional, 'Order:Notional')
  expect(a.takerFee).to.equal(b.takerFee, 'Order:TakerFee')
  expect(a.orderReferral).to.equal(b.orderReferral, 'Order:OrderReferral')
  expect(a.solverReferral).to.equal(b.solverReferral, 'Order:SolverReferral')
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
  expect(a.exposure).to.equal(b.exposure, 'Global:Exposure')
}

export function expectLocalEq(a: Local, b: Local): void {
  expect(a.currentId).to.equal(b.currentId, 'Local:Currentid')
  expect(a.latestId).to.equal(b.latestId, 'Local:LatestId')
  expect(a.collateral).to.equal(b.collateral, 'Local:Collateral')
  expect(a.claimable).to.equal(b.claimable, 'Local:Claimable')
}

export function expectVersionEq(a: Version, b: Version): void {
  expect(a.valid).to.equal(b.valid, 'Version:Valid')
  expect(a.price).to.equal(b.price, 'Version:Price')
  expect(a.makerValue._value).to.equal(b.makerValue._value, 'Version:MakerValue')
  expect(a.longValue._value).to.equal(b.longValue._value, 'Version:LongValue')
  expect(a.shortValue._value).to.equal(b.shortValue._value, 'Version:ShortValue')
  expect(a.makerFee._value).to.equal(b.makerFee._value, 'Version:MakerFee')
  expect(a.takerFee._value).to.equal(b.takerFee._value, 'Version:TakerFee')
  expect(a.makerOffset._value).to.equal(b.makerOffset._value, 'Version:MakerOffset')
  expect(a.takerPosOffset._value).to.equal(b.takerPosOffset._value, 'Version:TakerPosOffset')
  expect(a.takerNegOffset._value).to.equal(b.takerNegOffset._value, 'Version:TakerNegOffset')
  expect(a.settlementFee._value).to.equal(b.settlementFee._value, 'Version:SettlementFee')
  expect(a.liquidationFee._value).to.equal(b.liquidationFee._value, 'Version:LiquidationFee')
}

export function expectCommonEq(a: Common, b: Common): void {
  expect(a.account).to.equal(b.account, 'Common:Account')
  expect(a.signer).to.equal(b.signer, 'Common:Signer')
  expect(a.domain).to.equal(b.domain, 'Common:Domain')
  expect(a.nonce).to.equal(b.nonce, 'Common:Nonce')
  expect(a.group).to.equal(b.group, 'Common:Group')
  expect(a.expiry).to.equal(b.expiry, 'Common:Expiry')
}

export function expectTakeEq(a: Take, b: Take): void {
  expect(a.amount).to.equal(b.amount, 'Take:Amount')
  expect(a.referrer).to.equal(b.referrer, 'Take:Referrer')
  expectCommonEq(a.common, b.common)
}

export function expectAccessUpdateBatchEq(a: AccessUpdateBatch, b: AccessUpdateBatch): void {
  expect(a.operators.length).to.equal(b.operators.length, 'AccessUpdateBatch:Operators:length')
  for (let i = 0; i < a.operators.length; i++) {
    expect(a.operators[i].accessor).to.equal(b.operators[i].accessor, 'AccessUpdateBatch:Operator:Accessor')
    expect(a.operators[i].approved).to.equal(b.operators[i].approved, 'AccessUpdateBatch:Operator:Approved')
  }
  expect(a.signers.length).to.equal(b.signers.length, 'AccessUpdateBatch:Signers:length')
  for (let i = 0; i < a.signers.length; i++) {
    expect(a.signers[i].accessor).to.equal(b.signers[i].accessor, 'AccessUpdateBatch:Signer:Accessor')
    expect(a.signers[i].approved).to.equal(b.signers[i].approved, 'AccessUpdateBatch:Signer:Approved')
  }
  expectCommonEq(a.common, b.common)
}

export function expectSignerUpdateEq(a: SignerUpdate, b: SignerUpdate): void {
  expect(a.access.accessor).to.equal(b.access.accessor, 'SignerUpdate:Accessor')
  expect(a.access.approved).to.equal(b.access.approved, 'SignerUpdate:Approved')
  expectCommonEq(a.common, b.common)
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
  exposure: 0,
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
  invalidation: 0,
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
  orderReferral: 0,
  solverReferral: 0,
}

export const DEFAULT_VERSION: Version = {
  valid: true,
  price: 0,
  makerValue: { _value: 0 },
  longValue: { _value: 0 },
  shortValue: { _value: 0 },
  makerFee: { _value: 0 },
  takerFee: { _value: 0 },
  makerOffset: { _value: 0 },
  takerPosOffset: { _value: 0 },
  takerNegOffset: { _value: 0 },
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

export const DEFAULT_ADIABATIC_FEE: AdiabaticFee = {
  linearFee: 0,
  proportionalFee: 0,
  adiabaticFee: 0,
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
  takerFee: DEFAULT_ADIABATIC_FEE,
  makerFee: DEFAULT_ADIABATIC_FEE,
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
