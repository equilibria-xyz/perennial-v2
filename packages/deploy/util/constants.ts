import { utils } from 'ethers'

export const cmsqETHOracleID = utils.id('oracle-cmsq-eth') // 0x002aa13b58df1c483e925045e9a580506812ed5bc85c188d3d8b501501294ad4
export const msqBTCOracleID = utils.id('oracle-msq-btc') // 0x403d2f23c2015aee67e9311896907cc05c139b2c771a92ae48a2c0e50e6883a4

export const DEFAULT_PROTOCOL_PARAMETER = {
  minScale: utils.parseUnits('0.04', 6),
  maxFee: 30000,
  maxLiquidationFee: 50000000,
  maxCut: 130000,
  maxRate: 15000000,
  minMaintenance: 4000,
  minEfficiency: 250000,
  referralFee: utils.parseUnits('0.40', 6),
  maxStaleAfter: 3600, // 1 hour
}

export const DEFAULT_MARKET_PARAMETER = {
  fundingFee: utils.parseUnits('0.10', 6), // Overriden in migration to current market value
  interestFee: utils.parseUnits('0.10', 6), // Overriden in migration to current market value
  makerFee: utils.parseUnits('0', 6),
  takerFee: utils.parseUnits('0.0002', 6),
  riskFee: utils.parseUnits('0.25', 6),
  maxPendingGlobal: 12,
  maxPendingLocal: 6,
  closed: false,
  settle: false,
  maxPriceDeviation: utils.parseUnits('0.15', 6),
}

export const DEFAULT_RISK_PARAMETERS = {
  margin: utils.parseUnits('0.0095', 6),
  maintenance: utils.parseUnits('0.008', 6),
  takerFee: {
    linearFee: utils.parseUnits('0.0002', 6),
    proportionalFee: utils.parseUnits('0.001', 6),
    adiabaticFee: 0,
    scale: utils.parseUnits('1', 6),
  },
  makerFee: {
    linearFee: utils.parseUnits('0.0001', 6),
    proportionalFee: 0,
    adiabaticFee: 0,
    scale: utils.parseUnits('1', 6),
  },
  makerLimit: utils.parseUnits('1', 6),
  efficiencyLimit: utils.parseUnits('0.5', 6),
  liquidationFee: utils.parseUnits('5', 6),
  utilizationCurve: {
    minRate: 0,
    maxRate: utils.parseUnits('0.155', 6),
    targetRate: utils.parseUnits('0.055', 6),
    targetUtilization: utils.parseUnits('0.60', 6),
  },
  pController: {
    k: utils.parseUnits('20000', 6),
    min: utils.parseUnits('-2.50', 6),
    max: utils.parseUnits('2.50', 6),
  },
  minMargin: utils.parseUnits('10', 6),
  minMaintenance: utils.parseUnits('10', 6),
  staleAfter: 7200,
  makerReceiveOnly: false,
}

export const KeeperFactoryParameter = {
  granularity: 5,
  oracleFee: 0,
  validFrom: 2,
  validTo: 7,
}

export const BaseKeeperBuffer = 275_000n
