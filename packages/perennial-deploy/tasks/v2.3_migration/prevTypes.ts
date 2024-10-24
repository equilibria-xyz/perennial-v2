import { type BigNumber } from 'ethers'

type InverseAdiabatic6StructOutput = [BigNumber, BigNumber, BigNumber, BigNumber] & {
  linearFee: BigNumber
  proportionalFee: BigNumber
  adiabaticFee: BigNumber
  scale: BigNumber
}

type LinearAdiabatic6StructOutput = [BigNumber, BigNumber, BigNumber, BigNumber] & {
  linearFee: BigNumber
  proportionalFee: BigNumber
  adiabaticFee: BigNumber
  scale: BigNumber
}

type UJumpRateUtilizationCurve6StructOutput = [BigNumber, BigNumber, BigNumber, BigNumber] & {
  minRate: BigNumber
  maxRate: BigNumber
  targetRate: BigNumber
  targetUtilization: BigNumber
}

type PController6StructOutput = [BigNumber, BigNumber, BigNumber] & {
  k: BigNumber
  min: BigNumber
  max: BigNumber
}

export type V2_2RiskParameterStructOutput = [
  BigNumber,
  BigNumber,
  LinearAdiabatic6StructOutput,
  InverseAdiabatic6StructOutput,
  BigNumber,
  BigNumber,
  BigNumber,
  UJumpRateUtilizationCurve6StructOutput,
  PController6StructOutput,
  BigNumber,
  BigNumber,
  BigNumber,
  boolean,
] & {
  margin: BigNumber
  maintenance: BigNumber
  takerFee: LinearAdiabatic6StructOutput
  makerFee: InverseAdiabatic6StructOutput
  makerLimit: BigNumber
  efficiencyLimit: BigNumber
  liquidationFee: BigNumber
  utilizationCurve: UJumpRateUtilizationCurve6StructOutput
  pController: PController6StructOutput
  minMargin: BigNumber
  minMaintenance: BigNumber
  staleAfter: BigNumber
  makerReceiveOnly: boolean
}

export type V2_2MarketParameterStructOutput = [
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  boolean,
  boolean,
  boolean,
  boolean,
] & {
  fundingFee: BigNumber
  interestFee: BigNumber
  positionFee: BigNumber
  oracleFee: BigNumber
  riskFee: BigNumber
  maxPendingGlobal: BigNumber
  maxPendingLocal: BigNumber
  settlementFee: BigNumber
  takerCloseAlways: boolean
  makerCloseAlways: boolean
  closed: boolean
  settle: boolean
}
