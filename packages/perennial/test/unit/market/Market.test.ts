import { smock, FakeContract } from '@defi-wonderland/smock'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { impersonate } from '../../../../common/testutil'

import {
  Market,
  Market__factory,
  IOracleProvider,
  IERC20Metadata,
  IMarketFactory,
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
} from '../../../types/generated'
import {
  DEFAULT_POSITION,
  DEFAULT_LOCAL,
  DEFAULT_ORDER,
  DEFAULT_CHECKPOINT,
  DEFAULT_VERSION,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
  expectOrderEq,
  expectCheckpointEq,
} from '../../../../common/testutil/types'
import { IMarket, MarketParameterStruct, RiskParameterStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

const POSITION = parse6decimal('10.000')
const COLLATERAL = parse6decimal('10000')
const TIMESTAMP = 1636401093
const PRICE = parse6decimal('123')

const DEFAULT_VERSION_ACCUMULATION_RESULT = {
  positionFee: 0,
  positionFeeMaker: 0,
  positionFeeProtocol: 0,
  positionFeeSubtractive: 0,
  positionFeeExposure: 0,
  positionFeeExposureMaker: 0,
  positionFeeExposureProtocol: 0,
  positionFeeImpact: 0,

  fundingMaker: 0,
  fundingLong: 0,
  fundingShort: 0,
  fundingFee: 0,

  interestMaker: 0,
  interestLong: 0,
  interestShort: 0,
  interestFee: 0,

  pnlMaker: 0,
  pnlLong: 0,
  pnlShort: 0,

  settlementFee: 0,
  liquidationFee: parse6decimal('10.000'), // will return liquidation fee unless invalid
}

const DEFAULT_LOCAL_ACCUMULATION_RESULT = {
  collateral: 0,
  linearFee: 0,
  proportionalFee: 0,
  adiabaticFee: 0,
  subtractiveFee: 0,
  settlementFee: 0,
  liquidationFee: 0,
}

const ORACLE_VERSION_0 = {
  price: BigNumber.from(0),
  timestamp: 0,
  valid: false,
}

const ORACLE_VERSION_1 = {
  price: PRICE,
  timestamp: TIMESTAMP,
  valid: true,
}

const ORACLE_VERSION_2 = {
  price: PRICE,
  timestamp: TIMESTAMP + 3600,
  valid: true,
}

const ORACLE_VERSION_3 = {
  price: PRICE,
  timestamp: TIMESTAMP + 7200,
  valid: true,
}

const ORACLE_VERSION_4 = {
  price: PRICE,
  timestamp: TIMESTAMP + 10800,
  valid: true,
}

const ORACLE_VERSION_5 = {
  price: PRICE,
  timestamp: TIMESTAMP + 14400,
  valid: true,
}

const ORACLE_VERSION_6 = {
  price: PRICE,
  timestamp: TIMESTAMP + 18000,
  valid: true,
}

// rate_0 = 0
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 3160
const EXPECTED_FUNDING_1_5_123 = BigNumber.from(3160)
const EXPECTED_FUNDING_FEE_1_5_123 = BigNumber.from(320) // (3159 + 157) = 3316 / 5 -> 664 * 5 -> 3320
const EXPECTED_FUNDING_WITH_FEE_1_5_123 = EXPECTED_FUNDING_1_5_123.add(EXPECTED_FUNDING_FEE_1_5_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_1_5_123 = EXPECTED_FUNDING_1_5_123.sub(EXPECTED_FUNDING_FEE_1_5_123.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 2.5 * 123 / (86400 * 365) = 4740
const EXPECTED_FUNDING_2_25_123 = BigNumber.from(4740)
const EXPECTED_FUNDING_FEE_2_25_123 = BigNumber.from(470) // (4738 + 236) = 4974 / 2.5 -> 1990 * 2.5 -> 4975
const EXPECTED_FUNDING_WITH_FEE_2_25_123 = EXPECTED_FUNDING_2_25_123.add(EXPECTED_FUNDING_FEE_2_25_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_25_123 = EXPECTED_FUNDING_2_25_123.sub(EXPECTED_FUNDING_FEE_2_25_123.div(2))

// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 43 / (86400 * 365) = 3315
const EXPECTED_FUNDING_2_5_43 = BigNumber.from(3315)
const EXPECTED_FUNDING_FEE_2_5_43 = BigNumber.from(330) // (3313 + 165) = 3478 / 5 -> 696 * 5 -> (3480 - 3315) * 2 -> 330
const EXPECTED_FUNDING_WITH_FEE_2_5_43 = EXPECTED_FUNDING_2_5_43.add(EXPECTED_FUNDING_FEE_2_5_43.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_43 = EXPECTED_FUNDING_2_5_43.sub(EXPECTED_FUNDING_FEE_2_5_43.div(2))

// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 96 / (86400 * 365) = 7400
const EXPECTED_FUNDING_2_5_96 = BigNumber.from(7400)
const EXPECTED_FUNDING_FEE_2_5_96 = BigNumber.from(740) // (7397 + 369) = 7766 / 5 -> 1554 * 5 -> (7770 - 7400) * 2 -> 1150
const EXPECTED_FUNDING_WITH_FEE_2_5_96 = EXPECTED_FUNDING_2_5_96.add(EXPECTED_FUNDING_FEE_2_5_96.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_96 = EXPECTED_FUNDING_2_5_96.sub(EXPECTED_FUNDING_FEE_2_5_96.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 150 / (86400 * 365) = 11560
const EXPECTED_FUNDING_2_5_150 = BigNumber.from(11560)
const EXPECTED_FUNDING_FEE_2_5_150 = BigNumber.from(1150) // (11558 + 577) = 12135 / 5 -> 2427 * 5 -> (12135 - 11560) * 2 -> 1150
const EXPECTED_FUNDING_WITH_FEE_2_5_150 = EXPECTED_FUNDING_2_5_150.add(EXPECTED_FUNDING_FEE_2_5_150.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_150 = EXPECTED_FUNDING_2_5_150.sub(EXPECTED_FUNDING_FEE_2_5_150.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 203 / (86400 * 365) = 15645
const EXPECTED_FUNDING_2_5_203 = BigNumber.from(15645)
const EXPECTED_FUNDING_FEE_2_5_203 = BigNumber.from(1560) // (15642 + 782) = 16424 / 5 -> 3285 * 5 -> (16425 - 15645) * 2 -> 1560
const EXPECTED_FUNDING_WITH_FEE_2_5_203 = EXPECTED_FUNDING_2_5_203.add(EXPECTED_FUNDING_FEE_2_5_203.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_203 = EXPECTED_FUNDING_2_5_203.sub(EXPECTED_FUNDING_FEE_2_5_203.div(2))

// rate_0 = 0.18
// rate_1 = rate_0 + (elapsed * k * skew)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.18 + (0.18 + 3600 * 1.00 / 40000)) / 2 * 3600 * 2.5 * 123 / (86400 * 365) = 7900
const EXPECTED_FUNDING_3_25_123 = BigNumber.from('7900')
const EXPECTED_FUNDING_FEE_3_25_123 = EXPECTED_FUNDING_3_25_123.div(10)
const EXPECTED_FUNDING_WITH_FEE_3_25_123 = EXPECTED_FUNDING_3_25_123.add(EXPECTED_FUNDING_FEE_3_25_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_3_25_123 = EXPECTED_FUNDING_3_25_123.sub(EXPECTED_FUNDING_FEE_3_25_123.div(2))

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 43 = 2455
const EXPECTED_INTEREST_5_43 = BigNumber.from(2455)
const EXPECTED_INTEREST_FEE_5_43 = EXPECTED_INTEREST_5_43.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_43 = EXPECTED_INTEREST_5_43.sub(EXPECTED_INTEREST_FEE_5_43)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 96 = 5480
const EXPECTED_INTEREST_5_96 = BigNumber.from(5480)
const EXPECTED_INTEREST_FEE_5_96 = EXPECTED_INTEREST_5_96.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_96 = EXPECTED_INTEREST_5_96.sub(EXPECTED_INTEREST_FEE_5_96)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 7020
const EXPECTED_INTEREST_5_123 = BigNumber.from(7020)
const EXPECTED_INTEREST_FEE_5_123 = EXPECTED_INTEREST_5_123.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_123 = EXPECTED_INTEREST_5_123.sub(EXPECTED_INTEREST_FEE_5_123)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 150 = 8565
const EXPECTED_INTEREST_5_150 = BigNumber.from(8565)
const EXPECTED_INTEREST_FEE_5_150 = EXPECTED_INTEREST_5_150.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_150 = EXPECTED_INTEREST_5_150.sub(EXPECTED_INTEREST_FEE_5_150)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 203 = 11586
const EXPECTED_INTEREST_5_203 = BigNumber.from(11590)
const EXPECTED_INTEREST_FEE_5_203 = EXPECTED_INTEREST_5_203.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_203 = EXPECTED_INTEREST_5_203.sub(EXPECTED_INTEREST_FEE_5_203)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.05 / 365 / 24 / 60 / 60 ) * 3600 * 2.5 * 123 = 1755
const EXPECTED_INTEREST_25_123 = BigNumber.from(1755)
const EXPECTED_INTEREST_FEE_25_123 = EXPECTED_INTEREST_25_123.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_25_123 = EXPECTED_INTEREST_25_123.sub(EXPECTED_INTEREST_FEE_25_123)

// rate_0 = 0
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0 + (0 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 123 / (86400 * 365) = 3160
const EXPECTED_FUNDING_1_10_123_ALL = BigNumber.from(3160)
const EXPECTED_FUNDING_FEE_1_10_123_ALL = BigNumber.from(320) // (3159 + 157) = 3316 / 5 -> 664 * 5 -> 3320
const EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL = EXPECTED_FUNDING_1_10_123_ALL.add(
  EXPECTED_FUNDING_FEE_1_10_123_ALL.div(2),
)
const EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL = EXPECTED_FUNDING_1_10_123_ALL.sub(
  EXPECTED_FUNDING_FEE_1_10_123_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.75 / 40000)) / 2 * 3600 * 10 * 123 / (86400 * 365) = 11060
const EXPECTED_FUNDING_2_10_123_ALL = BigNumber.from(11060)
const EXPECTED_FUNDING_FEE_2_10_123_ALL = BigNumber.from(1100) // (11057 + 552) = 11609 / 10 -> 1161 * 10 -> 11610 - 11060 -> 550 * 2 -> 1100
const EXPECTED_FUNDING_WITH_FEE_2_10_123_ALL = EXPECTED_FUNDING_2_10_123_ALL.add(
  EXPECTED_FUNDING_FEE_2_10_123_ALL.div(2),
)
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL = EXPECTED_FUNDING_2_10_123_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_123_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 45 / (86400 * 365) = 3470
const EXPECTED_FUNDING_2_10_45_ALL = BigNumber.from(3470)
const EXPECTED_FUNDING_FEE_2_10_45_ALL = BigNumber.from(350)
const EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL = EXPECTED_FUNDING_2_10_45_ALL.add(EXPECTED_FUNDING_FEE_2_10_45_ALL.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL = EXPECTED_FUNDING_2_10_45_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_45_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 33 / (86400 * 365) = 2550
const EXPECTED_FUNDING_2_10_33_ALL = BigNumber.from(2550)
const EXPECTED_FUNDING_FEE_2_10_33_ALL = BigNumber.from(255)
const EXPECTED_FUNDING_WITH_FEE_2_10_33_ALL = EXPECTED_FUNDING_2_10_33_ALL.add(EXPECTED_FUNDING_FEE_2_10_33_ALL.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_33_ALL = EXPECTED_FUNDING_2_10_33_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_33_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 96 / (86400 * 365) = 7400
const EXPECTED_FUNDING_2_10_96_ALL = BigNumber.from(7400)
const EXPECTED_FUNDING_FEE_2_10_96_ALL = BigNumber.from(740)
const EXPECTED_FUNDING_WITH_FEE_2_10_96_ALL = EXPECTED_FUNDING_2_10_96_ALL.add(EXPECTED_FUNDING_FEE_2_10_96_ALL.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL = EXPECTED_FUNDING_2_10_96_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_96_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 0.50 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 7900
const EXPECTED_FUNDING_3_10_123_ALL = BigNumber.from(7900)
const EXPECTED_FUNDING_FEE_3_10_123_ALL = BigNumber.from(790)
const EXPECTED_FUNDING_WITH_FEE_3_10_123_ALL = EXPECTED_FUNDING_3_10_123_ALL.add(
  EXPECTED_FUNDING_FEE_3_10_123_ALL.div(2),
)
const EXPECTED_FUNDING_WITHOUT_FEE_3_10_123_ALL = EXPECTED_FUNDING_3_10_123_ALL.sub(
  EXPECTED_FUNDING_FEE_3_10_123_ALL.div(2),
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 56170
const EXPECTED_INTEREST_10_67_123_ALL = BigNumber.from(56170)
const EXPECTED_INTEREST_FEE_10_67_123_ALL = EXPECTED_INTEREST_10_67_123_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL = EXPECTED_INTEREST_10_67_123_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_123_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.64 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 89870
const EXPECTED_INTEREST_10_80_123_ALL = BigNumber.from(89870)
const EXPECTED_INTEREST_FEE_10_80_123_ALL = EXPECTED_INTEREST_10_80_123_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_80_123_ALL = EXPECTED_INTEREST_10_80_123_ALL.sub(
  EXPECTED_INTEREST_FEE_10_80_123_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 45 = 20550
const EXPECTED_INTEREST_10_67_45_ALL = BigNumber.from(20550)
const EXPECTED_INTEREST_FEE_10_67_45_ALL = EXPECTED_INTEREST_10_67_45_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL = EXPECTED_INTEREST_10_67_45_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_45_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 33 = 15070
const EXPECTED_INTEREST_10_67_33_ALL = BigNumber.from(15070)
const EXPECTED_INTEREST_FEE_10_67_33_ALL = EXPECTED_INTEREST_10_67_33_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_33_ALL = EXPECTED_INTEREST_10_67_33_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_33_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 96 = 43840
const EXPECTED_INTEREST_10_67_96_ALL = BigNumber.from(43840)
const EXPECTED_INTEREST_FEE_10_67_96_ALL = EXPECTED_INTEREST_10_67_96_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL = EXPECTED_INTEREST_10_67_96_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_96_ALL,
)

async function settle(market: Market, account: SignerWithAddress, sender?: SignerWithAddress) {
  const local = await market.locals(account.address)
  return await market
    .connect(sender || account)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      account.address,
      ethers.constants.MaxUint256,
      ethers.constants.MaxUint256,
      ethers.constants.MaxUint256,
      0,
      false,
    )
}

async function deposit(market: Market, amount: BigNumber, account: SignerWithAddress, sender?: SignerWithAddress) {
  const local = await market.locals(account.address)
  return await market
    .connect(sender || account)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      account.address,
      ethers.constants.MaxUint256,
      ethers.constants.MaxUint256,
      ethers.constants.MaxUint256,
      amount,
      false,
    )
}

describe('Market', () => {
  let protocolTreasury: SignerWithAddress
  let owner: SignerWithAddress
  let beneficiary: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let userD: SignerWithAddress
  let liquidator: SignerWithAddress
  let operator: SignerWithAddress
  let coordinator: SignerWithAddress
  let factorySigner: SignerWithAddress
  let oracleFactorySigner: SignerWithAddress
  let factory: FakeContract<IMarketFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>

  let market: Market
  let marketDefinition: IMarket.MarketDefinitionStruct
  let riskParameter: RiskParameterStruct
  let marketParameter: MarketParameterStruct

  beforeEach(async () => {
    ;[
      protocolTreasury,
      owner,
      beneficiary,
      user,
      userB,
      userC,
      userD,
      liquidator,
      operator,
      coordinator,
      oracleFactorySigner,
    ] = await ethers.getSigners()
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')

    factory = await smock.fake<IMarketFactory>('IMarketFactory')
    factorySigner = await impersonate.impersonateWithBalance(factory.address, utils.parseEther('10'))
    factory.owner.returns(owner.address)
    factory.parameter.returns({
      maxPendingIds: 5,
      protocolFee: parse6decimal('0.50'),
      maxFee: parse6decimal('0.01'),
      maxFeeAbsolute: parse6decimal('1000'),
      maxCut: parse6decimal('0.50'),
      maxRate: parse6decimal('10.00'),
      minMaintenance: parse6decimal('0.01'),
      minEfficiency: parse6decimal('0.1'),
      referralFee: 0,
    })
    factory.oracleFactory.returns(oracleFactorySigner.address)

    marketDefinition = {
      token: dsu.address,
      oracle: oracle.address,
    }
    riskParameter = {
      margin: parse6decimal('0.35'),
      maintenance: parse6decimal('0.3'),
      takerFee: {
        linearFee: 0,
        proportionalFee: 0,
        adiabaticFee: 0,
        scale: parse6decimal('5.000'),
      },
      makerFee: {
        linearFee: 0,
        proportionalFee: 0,
        adiabaticFee: 0,
        scale: parse6decimal('10.000'),
      },
      makerLimit: parse6decimal('1000'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('10.00'),
      utilizationCurve: {
        minRate: parse6decimal('0.0'),
        maxRate: parse6decimal('1.00'),
        targetRate: parse6decimal('0.10'),
        targetUtilization: parse6decimal('0.50'),
      },
      pController: {
        k: parse6decimal('40000'),
        min: parse6decimal('-1.20'),
        max: parse6decimal('1.20'),
      },
      minMargin: parse6decimal('120'),
      minMaintenance: parse6decimal('100'),
      staleAfter: 7200,
      makerReceiveOnly: false,
    }
    marketParameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      oracleFee: parse6decimal('0.1'),
      riskFee: parse6decimal('0.1'),
      positionFee: parse6decimal('0.1'),
      maxPendingGlobal: 5,
      maxPendingLocal: 3,
      settlementFee: 0,
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
      settle: false,
    }
    market = await new Market__factory(
      {
        'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
        'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
        'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
        'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
          await new CheckpointStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Global.sol:GlobalStorageLib': (await new GlobalStorageLib__factory(owner).deploy()).address,
        'contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
          await new MarketParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageGlobalLib': (
          await new PositionStorageGlobalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageLocalLib': (
          await new PositionStorageLocalLib__factory(owner).deploy()
        ).address,
        'contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
          await new RiskParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Version.sol:VersionStorageLib': (await new VersionStorageLib__factory(owner).deploy()).address,
      },
      owner,
    ).deploy()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      await market.connect(factorySigner).initialize(marketDefinition)

      expect(await market.factory()).to.equal(factory.address)
      expect(await market.token()).to.equal(dsu.address)
      expect(await market.oracle()).to.equal(marketDefinition.oracle)

      const riskParameterResult = await market.riskParameter()
      expect(riskParameterResult.margin).to.equal(0)
      expect(riskParameterResult.maintenance).to.equal(0)
      expect(riskParameterResult.takerFee.linearFee).to.equal(0)
      expect(riskParameterResult.takerFee.proportionalFee).to.equal(0)
      expect(riskParameterResult.takerFee.adiabaticFee).to.equal(0)
      expect(riskParameterResult.takerFee.scale).to.equal(0)
      expect(riskParameterResult.makerFee.linearFee).to.equal(0)
      expect(riskParameterResult.makerFee.proportionalFee).to.equal(0)
      expect(riskParameterResult.makerFee.adiabaticFee).to.equal(0)
      expect(riskParameterResult.makerFee.scale).to.equal(0)
      expect(riskParameterResult.makerLimit).to.equal(0)
      expect(riskParameterResult.efficiencyLimit).to.equal(0)
      expect(riskParameterResult.liquidationFee).to.equal(0)
      expect(riskParameterResult.utilizationCurve.minRate).to.equal(0)
      expect(riskParameterResult.utilizationCurve.targetRate).to.equal(0)
      expect(riskParameterResult.utilizationCurve.maxRate).to.equal(0)
      expect(riskParameterResult.utilizationCurve.targetUtilization).to.equal(0)
      expect(riskParameterResult.pController.k).to.equal(0)
      expect(riskParameterResult.pController.max).to.equal(0)
      expect(riskParameterResult.minMargin).to.equal(0)
      expect(riskParameterResult.minMaintenance).to.equal(0)
      expect(riskParameterResult.staleAfter).to.equal(0)
      expect(riskParameterResult.makerReceiveOnly).to.equal(false)

      const marketParameterResult = await market.parameter()
      expect(marketParameterResult.fundingFee).to.equal(0)
      expect(marketParameterResult.interestFee).to.equal(0)
      expect(marketParameterResult.positionFee).to.equal(0)
      expect(marketParameterResult.oracleFee).to.equal(0)
      expect(marketParameterResult.riskFee).to.equal(0)
      expect(marketParameterResult.maxPendingGlobal).to.equal(0)
      expect(marketParameterResult.maxPendingLocal).to.equal(0)
      expect(marketParameterResult.settlementFee).to.equal(0)
      expect(marketParameterResult.closed).to.equal(false)
    })

    it('reverts if already initialized', async () => {
      await market.initialize(marketDefinition)
      await expect(market.initialize(marketDefinition))
        .to.be.revertedWithCustomError(market, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  context('already initialized', async () => {
    beforeEach(async () => {
      await market.connect(factorySigner).initialize(marketDefinition)
      await market.connect(owner).updateRiskParameter(riskParameter)
    })

    describe('#updateOracle', async () => {
      it('updates the oracle', async () => {
        const oracle2 = await smock.fake<IOracleProvider>('IOracleProvider')

        await expect(market.connect(owner).updateOracle(oracle2.address))
          .to.emit(market, 'OracleUpdated')
          .withArgs(oracle2.address)

        expect(await market.oracle()).to.equal(oracle2.address)
      })

      it('reverts if not owner (user)', async () => {
        const oracle2 = await smock.fake<IOracleProvider>('IOracleProvider')

        await expect(market.connect(user).updateOracle(oracle2.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })

      it('reverts if not owner (coordinator)', async () => {
        const oracle2 = await smock.fake<IOracleProvider>('IOracleProvider')

        await expect(market.connect(coordinator).updateOracle(oracle2.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateParameter', async () => {
      const defaultMarketParameter = {
        fundingFee: parse6decimal('0.03'),
        interestFee: parse6decimal('0.02'),
        positionFee: parse6decimal('0.01'),
        oracleFee: parse6decimal('0.04'),
        riskFee: parse6decimal('0.05'),
        maxPendingGlobal: 5,
        maxPendingLocal: 3,
        settlementFee: parse6decimal('0.09'),
        makerCloseAlways: true,
        takerCloseAlways: true,
        closed: true,
        settle: true,
      }

      it('updates the parameters', async () => {
        await expect(
          market.connect(owner).updateParameter(beneficiary.address, coordinator.address, defaultMarketParameter),
        )
          .to.emit(market, 'BeneficiaryUpdated')
          .withArgs(beneficiary.address)
          .to.emit(market, 'CoordinatorUpdated')
          .withArgs(coordinator.address)
          .to.emit(market, 'ParameterUpdated')
          .withArgs(defaultMarketParameter)

        const marketParameter = await market.parameter()
        expect(marketParameter.fundingFee).to.equal(defaultMarketParameter.fundingFee)
        expect(marketParameter.interestFee).to.equal(defaultMarketParameter.interestFee)
        expect(marketParameter.positionFee).to.equal(defaultMarketParameter.positionFee)
        expect(marketParameter.oracleFee).to.equal(defaultMarketParameter.oracleFee)
        expect(marketParameter.riskFee).to.equal(defaultMarketParameter.riskFee)
        expect(marketParameter.maxPendingGlobal).to.equal(defaultMarketParameter.maxPendingGlobal)
        expect(marketParameter.maxPendingLocal).to.equal(defaultMarketParameter.maxPendingLocal)
        expect(marketParameter.settlementFee).to.equal(defaultMarketParameter.settlementFee)
        expect(marketParameter.closed).to.equal(defaultMarketParameter.closed)
        expect(marketParameter.settle).to.equal(defaultMarketParameter.settle)
      })

      it('reverts if not owner (user)', async () => {
        await expect(
          market.connect(user).updateParameter(beneficiary.address, coordinator.address, marketParameter),
        ).to.be.revertedWithCustomError(market, 'InstanceNotOwnerError')
      })

      it('reverts if not owner (coordinator)', async () => {
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, await market.parameter())
        await expect(
          market.connect(coordinator).updateParameter(beneficiary.address, coordinator.address, marketParameter),
        ).to.be.revertedWithCustomError(market, 'InstanceNotOwnerError')
      })
    })

    describe('#updateRiskParameter', async () => {
      const defaultRiskParameter = {
        margin: parse6decimal('0.5'),
        maintenance: parse6decimal('0.4'),
        takerFee: {
          linearFee: parse6decimal('0.01'),
          proportionalFee: parse6decimal('0.004'),
          adiabaticFee: parse6decimal('0.003'),
          scale: parse6decimal('50.00'),
        },
        makerFee: {
          linearFee: parse6decimal('0.005'),
          proportionalFee: parse6decimal('0.001'),
          adiabaticFee: parse6decimal('0.004'),
          scale: parse6decimal('100.00'),
        },
        makerLimit: parse6decimal('2000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('5.00'),
        utilizationCurve: {
          minRate: parse6decimal('0.20'),
          maxRate: parse6decimal('0.20'),
          targetRate: parse6decimal('0.20'),
          targetUtilization: parse6decimal('0.75'),
        },
        pController: {
          k: parse6decimal('40000'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
        minMargin: parse6decimal('60'),
        minMaintenance: parse6decimal('50'),
        staleAfter: 9600,
        makerReceiveOnly: true,
      }

      it('updates the parameters (owner)', async () => {
        await expect(market.connect(owner).updateRiskParameter(defaultRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        const riskParameter = await market.riskParameter()
        expect(riskParameter.margin).to.equal(defaultRiskParameter.margin)
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.takerFee.linearFee).to.equal(defaultRiskParameter.takerFee.linearFee)
        expect(riskParameter.takerFee.proportionalFee).to.equal(defaultRiskParameter.takerFee.proportionalFee)
        expect(riskParameter.takerFee.adiabaticFee).to.equal(defaultRiskParameter.takerFee.adiabaticFee)
        expect(riskParameter.takerFee.scale).to.equal(defaultRiskParameter.takerFee.scale)
        expect(riskParameter.makerFee.linearFee).to.equal(defaultRiskParameter.makerFee.linearFee)
        expect(riskParameter.makerFee.proportionalFee).to.equal(defaultRiskParameter.makerFee.proportionalFee)
        expect(riskParameter.makerFee.adiabaticFee).to.equal(defaultRiskParameter.makerFee.adiabaticFee)
        expect(riskParameter.makerFee.scale).to.equal(defaultRiskParameter.makerFee.scale)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMargin).to.equal(defaultRiskParameter.minMargin)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      it('updates the parameters (coordinator)', async () => {
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, await market.parameter())
        await expect(market.connect(coordinator).updateRiskParameter(defaultRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        const riskParameter = await market.riskParameter()
        expect(riskParameter.margin).to.equal(defaultRiskParameter.margin)
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.takerFee.linearFee).to.equal(defaultRiskParameter.takerFee.linearFee)
        expect(riskParameter.takerFee.proportionalFee).to.equal(defaultRiskParameter.takerFee.proportionalFee)
        expect(riskParameter.takerFee.adiabaticFee).to.equal(defaultRiskParameter.takerFee.adiabaticFee)
        expect(riskParameter.takerFee.scale).to.equal(defaultRiskParameter.takerFee.scale)
        expect(riskParameter.makerFee.linearFee).to.equal(defaultRiskParameter.makerFee.linearFee)
        expect(riskParameter.makerFee.proportionalFee).to.equal(defaultRiskParameter.makerFee.proportionalFee)
        expect(riskParameter.makerFee.adiabaticFee).to.equal(defaultRiskParameter.makerFee.adiabaticFee)
        expect(riskParameter.makerFee.scale).to.equal(defaultRiskParameter.makerFee.scale)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMargin).to.equal(defaultRiskParameter.minMargin)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      it('updates the parameters w/ fee', async () => {
        // setup market with POSITION skew
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION, 0, COLLATERAL, false)

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)
        await settle(market, userB)

        // test the risk parameter update
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, await market.parameter())
        await expect(market.connect(coordinator).updateRiskParameter(defaultRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        // before = 0
        // after = (0.20 + 0) / 2 * 0.003 * 10 * 123 + (1.00 + 0.90) / 2 * 0.004 * -10 * 123 = -4.305
        expect((await market.global()).exposure).to.equal(parse6decimal('4.305'))

        const riskParameter = await market.riskParameter()
        expect(riskParameter.margin).to.equal(defaultRiskParameter.margin)
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.takerFee.linearFee).to.equal(defaultRiskParameter.takerFee.linearFee)
        expect(riskParameter.takerFee.proportionalFee).to.equal(defaultRiskParameter.takerFee.proportionalFee)
        expect(riskParameter.takerFee.adiabaticFee).to.equal(defaultRiskParameter.takerFee.adiabaticFee)
        expect(riskParameter.takerFee.scale).to.equal(defaultRiskParameter.takerFee.scale)
        expect(riskParameter.makerFee.linearFee).to.equal(defaultRiskParameter.makerFee.linearFee)
        expect(riskParameter.makerFee.proportionalFee).to.equal(defaultRiskParameter.makerFee.proportionalFee)
        expect(riskParameter.makerFee.adiabaticFee).to.equal(defaultRiskParameter.makerFee.adiabaticFee)
        expect(riskParameter.makerFee.scale).to.equal(defaultRiskParameter.makerFee.scale)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMargin).to.equal(defaultRiskParameter.minMargin)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      it('reverts if not owner or coordinator', async () => {
        await expect(market.connect(user).updateRiskParameter(defaultRiskParameter)).to.be.revertedWithCustomError(
          market,
          'MarketNotCoordinatorError',
        )
      })
    })

    describe('#settle', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
      })

      it('opens the position and settles', async () => {
        await expect(
          market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
        )
          .to.emit(market, 'PositionProcessed')
          .withArgs(0, { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp }, DEFAULT_VERSION_ACCUMULATION_RESULT)
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            0,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'Updated')
          .withArgs(
            user.address,
            user.address,
            ORACLE_VERSION_2.timestamp,
            POSITION,
            0,
            0,
            COLLATERAL,
            false,
            constants.AddressZero,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await expect(await market.settle(user.address))
          .to.emit(market, 'PositionProcessed')
          .withArgs(
            1,
            {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_VERSION_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            1,
            {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 1,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrders(user.address, 1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          currentId: 1,
          latestId: 1,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrder(1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          liquidationFee: { _value: -riskParameter.liquidationFee },
        })
      })

      it('settles when market is in settle-only mode', async () => {
        await expect(
          market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
        )
          .to.emit(market, 'PositionProcessed')
          .withArgs(0, { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp }, DEFAULT_VERSION_ACCUMULATION_RESULT)
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            0,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'Updated')
          .withArgs(
            user.address,
            user.address,
            ORACLE_VERSION_2.timestamp,
            POSITION,
            0,
            0,
            COLLATERAL,
            false,
            constants.AddressZero,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        const marketParameter = { ...(await market.parameter()) }
        marketParameter.settle = true
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, marketParameter)

        await expect(await market.settle(user.address))
          .to.emit(market, 'PositionProcessed')
          .withArgs(
            1,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_VERSION_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            1,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 1,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrders(user.address, 1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          currentId: 1,
          latestId: 1,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrder(1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          liquidationFee: { _value: -riskParameter.liquidationFee },
        })
      })
    })

    describe('#update', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateParameter(beneficiary.address, coordinator.address, marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()
      })

      context('no position', async () => {
        it('deposits and withdraws (immediately)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              0,
              0,
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )
            .to.emit(market, 'OrderCreated')
            .withArgs(user.address, { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, collateral: COLLATERAL })

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL.mul(-1), false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              0,
              0,
              0,
              COLLATERAL.mul(-1),
              false,
              constants.AddressZero,
            )
            .to.emit(market, 'OrderCreated')
            .withArgs(user.address, {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: -COLLATERAL,
            })

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('deposits and withdraws (next)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              0,
              0,
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL.mul(-1), false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_3.timestamp,
              0,
              0,
              0,
              COLLATERAL.mul(-1),
              false,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            collateral: -COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 2,
            latestId: 1,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            collateral: -COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('deposits and withdraws (next - stale)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              0,
              0,
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL.mul(-1), false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_6.timestamp,
              0,
              0,
              0,
              COLLATERAL.mul(-1),
              false,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
            collateral: -COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 2,
            latestId: 1,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
            collateral: -COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })
      })

      context('make position', async () => {
        context('open', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          it('opens the position', async () => {
            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_2.timestamp,
                POSITION,
                0,
                0,
                COLLATERAL,
                false,
                constants.AddressZero,
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(user.address, {
                ...DEFAULT_ORDER,
                orders: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                collateral: COLLATERAL,
                makerPos: POSITION,
              })

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              latestId: 0,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('opens the position and settles', async () => {
            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                0,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
                DEFAULT_VERSION_ACCUMULATION_RESULT,
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                0,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
                DEFAULT_LOCAL_ACCUMULATION_RESULT,
              )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_2.timestamp,
                POSITION,
                0,
                0,
                COLLATERAL,
                false,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(await settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  collateral: COLLATERAL,
                  makerPos: POSITION,
                },
                DEFAULT_VERSION_ACCUMULATION_RESULT,
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  collateral: COLLATERAL,
                  makerPos: POSITION,
                },
                DEFAULT_LOCAL_ACCUMULATION_RESULT,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('opens a second position (same version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_2.timestamp,
                POSITION.mul(2),
                0,
                0,
                0,
                false,
                constants.AddressZero,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              collateral: COLLATERAL,
              makerPos: POSITION.mul(2),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              latestId: 0,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              collateral: COLLATERAL,
              makerPos: POSITION.mul(2),
            })
          })

          it('opens a second position and settles (same version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_2.timestamp,
                POSITION.mul(2),
                0,
                0,
                0,
                false,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('opens a second position (next version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_3.timestamp,
                POSITION.mul(2),
                0,
                0,
                0,
                false,
                constants.AddressZero,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              makerPos: POSITION,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              makerPos: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('opens a second position and settles (next version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_3.timestamp,
                POSITION.mul(2),
                0,
                0,
                0,
                false,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
              long: 0,
              short: 0,
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('opens the position and settles later', async () => {
            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_2.timestamp,
                POSITION,
                0,
                0,
                COLLATERAL,
                false,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('opens the position and settles later with fee', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            const riskParameterMakerFee = { ...riskParameter.makerFee }
            riskParameterMakerFee.linearFee = parse6decimal('0.005')
            riskParameterMakerFee.proportionalFee = parse6decimal('0.0025')
            riskParameterMakerFee.adiabaticFee = parse6decimal('0.01')
            riskParameter.makerFee = riskParameterMakerFee
            await market.updateRiskParameter(riskParameter)

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.settlementFee = parse6decimal('0.50')
            await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

            const MAKER_FEE = parse6decimal('3.075') // position * (0.01 * -(1.00 + 0.00) / 2 + 0.005 + 0.0025) * price
            const MAKER_FEE_WITHOUT_IMPACT = parse6decimal('9.225') // position * (0.005 + 0.0025) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_2.timestamp,
                POSITION,
                0,
                0,
                COLLATERAL,
                false,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL.sub(MAKER_FEE).sub(SETTLEMENT_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: MAKER_FEE_WITHOUT_IMPACT.div(2),
              oracleFee: MAKER_FEE_WITHOUT_IMPACT.div(2).div(10).add(SETTLEMENT_FEE),
              riskFee: MAKER_FEE_WITHOUT_IMPACT.div(2).div(10),
              donation: MAKER_FEE_WITHOUT_IMPACT.div(2).mul(8).div(10),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })

        context('close', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
          })

          context('settles first', async () => {
            beforeEach(async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
            })

            it('closes the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 2,
                makerNeg: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 2,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 4,
                latestId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrder(4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes the position and settles later', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('closes the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              const riskParameterMakerFee = { ...riskParameter.makerFee }
              riskParameterMakerFee.linearFee = parse6decimal('0.005')
              riskParameterMakerFee.proportionalFee = parse6decimal('0.0025')
              riskParameterMakerFee.adiabaticFee = parse6decimal('0.01')
              riskParameter.makerFee = riskParameterMakerFee
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const MAKER_FEE = parse6decimal('15.375') // position * (0.01 * (1.00 + 0.00) / 2 + 0.005 + 0.0025) * price
              const MAKER_FEE_WITHOUT_IMPACT = parse6decimal('9.225') // position * (0.005 + 0.0025) * price
              const MAKER_FEE_FEE = MAKER_FEE_WITHOUT_IMPACT.div(10)
              const MAKER_FEE_WITHOUT_FEE = MAKER_FEE_WITHOUT_IMPACT.sub(MAKER_FEE_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.sub(MAKER_FEE).add(MAKER_FEE_WITHOUT_FEE).sub(SETTLEMENT_FEE),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: MAKER_FEE_FEE.div(2),
                oracleFee: MAKER_FEE_FEE.div(2).div(10).add(SETTLEMENT_FEE),
                riskFee: MAKER_FEE_FEE.div(2).div(10),
                donation: MAKER_FEE_FEE.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: { _value: MAKER_FEE_WITHOUT_FEE.div(10) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })
          })
        })
      })

      context('long position', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('position delta', async () => {
          context('open', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('opens the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )
                .to.emit(market, 'OrderCreated')
                .withArgs(user.address, {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  collateral: COLLATERAL,
                  orders: 1,
                  longPos: POSITION,
                })

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                latestId: 0,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                collateral: COLLATERAL.mul(2),
                orders: 2,
                makerPos: POSITION,
                longPos: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                latestId: 0,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                collateral: COLLATERAL.mul(2),
                makerPos: POSITION,
                longPos: POSITION,
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              const riskParameterTakerFee = { ...riskParameter.takerFee }
              riskParameterTakerFee.linearFee = parse6decimal('0.01')
              riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
              riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
              riskParameter.takerFee = riskParameterTakerFee
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
              const TAKER_FEE_WITHOUT_IMPACT = parse6decimal('7.38') // position * (0.01 + 0.002) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE.div(2)),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(SETTLEMENT_FEE.div(2))
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee =
                EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_WITHOUT_IMPACT)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              const riskParameter = { ...(await market.riskParameter()) }
              const riskParameterTakerFee = { ...riskParameter.takerFee }
              riskParameterTakerFee.linearFee = parse6decimal('0.01')
              riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
              riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
              riskParameter.takerFee = riskParameterTakerFee
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
              const TAKER_FEE_ONLY = parse6decimal('7.38') // position * (0.01 + 0.002) * price
              const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
              const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(TAKER_FEE_ONLY_WITHOUT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_ONLY_FEE)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: TAKER_FEE_ONLY_WITHOUT_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  latestId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  latestId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_4.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  long: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position and settles (next version)', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                const riskParameterTakerFee = { ...riskParameter.takerFee }
                riskParameterTakerFee.scale = POSITION.div(4)
                riskParameter.takerFee = riskParameterTakerFee
                await market.updateRiskParameter(riskParameter)

                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_4.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 4,
                  latestId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_FUNDING_WITH_FEE_2_25_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_INTEREST_25_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 4), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                  .add(EXPECTED_INTEREST_FEE_5_123)
                  .add(EXPECTED_INTEREST_FEE_25_123)
                expectGlobalEq(await market.global(), {
                  currentId: 4,
                  latestId: 3,
                  protocolFee: totalFee.div(2).sub(1), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(4), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                      .div(5)
                      .add(EXPECTED_FUNDING_WITH_FEE_2_25_123.add(EXPECTED_INTEREST_25_123).mul(2).div(5))
                      .mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles later', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles later with fee', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                const riskParameterTakerFee = { ...riskParameter.takerFee }
                riskParameterTakerFee.linearFee = parse6decimal('0.01')
                riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
                riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
                riskParameter.takerFee = riskParameterTakerFee
                await market.updateRiskParameter(riskParameter)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.settlementFee = parse6decimal('0.50')
                await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

                const TAKER_FEE = parse6decimal('4.92') // position * (0.01 + 0.002 - 0.004) * price
                const TAKER_FEE_ONLY = parse6decimal('7.38') // position * (0.01 + 0.002) * price
                const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
                const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
                const SETTLEMENT_FEE = parse6decimal('0.50')

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(TAKER_FEE)
                    .sub(SETTLEMENT_FEE),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(TAKER_FEE_ONLY_WITHOUT_FEE)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_ONLY_FEE)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(TAKER_FEE_ONLY_WITHOUT_FEE)
                      .div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('same price same timestamp settle', async () => {
            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              valid: true,
            }

            oracle.at.whenCalledWith(oracleVersionSameTimestamp.timestamp).returns(oracleVersionSameTimestamp)
            oracle.status.returns([oracleVersionSameTimestamp, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
          })

          it('lower price same rate settle', async () => {
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))

            const EXPECTED_PNL = parse6decimal('2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionLowerPrice = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
            oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(2).div(5)),
                  fundingLong: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(3).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestLong: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlLong: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10),
              },
              longValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('-2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(2).div(5)),
                  fundingLong: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(3).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestLong: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlLong: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10)
                  .sub(1),
              }, // loss of precision
              longValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  parse6decimal('450'),
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('with socialization to zero', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_5_150)
                  .sub(5), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(22), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(1), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(4), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with partial socialization', async () => {
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  POSITION.div(4),
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userC)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 5620
              const EXPECTED_INTEREST_1 = BigNumber.from(5620)
              const EXPECTED_INTEREST_FEE_1 = EXPECTED_INTEREST_1.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_1 = EXPECTED_INTEREST_1.sub(EXPECTED_INTEREST_FEE_1)

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 150 = 6850
              const EXPECTED_INTEREST_2 = BigNumber.from(6850)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 * 0.5 = 35105
              const EXPECTED_INTEREST_3 = BigNumber.from(35105)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_2)
                  .sub(EXPECTED_FUNDING_WITH_FEE_3_25_123)
                  .sub(EXPECTED_INTEREST_3)
                  .add(EXPECTED_PNL)
                  .sub(5), // loss of precision
              })
              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).mul(4).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2).mul(4).div(5))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(16), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userC.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).div(5),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3))
                  .sub(EXPECTED_PNL)
                  .sub(12), // loss of precision
              })
              expectPositionEq(await market.positions(userC.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
              })
              expectOrderEq(await market.pendingOrders(userC.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_5_150.add(EXPECTED_INTEREST_FEE_2))
                .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(2), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10).add(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(2)
                    .div(25)
                    .sub(1),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150.add(EXPECTED_INTEREST_2))
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3).mul(2).div(5))
                    .sub(EXPECTED_PNL.mul(2).div(5))
                    .sub(4), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150.add(EXPECTED_INTEREST_2))
                    .add(EXPECTED_FUNDING_WITH_FEE_3_25_123.add(EXPECTED_INTEREST_3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with shortfall', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const protocolParameter = { ...(await factory.parameter()) }
              protocolParameter.maxFeeAbsolute = parse6decimal('100')
              await factory.connect(owner).updateParameter(protocolParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.liquidationFee = parse6decimal('100')
              await market.connect(owner).updateRiskParameter(riskParameter)

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('100')

              const oracleVersionHigherPrice = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .add(EXPECTED_PNL),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                shortValue: { _value: 0 },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('450')
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_203)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_203)
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(24) // loss of precision
              factory.operators.whenCalledWith(userB.address, liquidator.address).returns(false)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userB.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_5.timestamp,
                  0,
                  0,
                  0,
                  shortfall.mul(-1),
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: 0,
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })

          context('long', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  parse6decimal('216'),
                  false,
                )
            })

            it('default', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                  .sub(EXPECTED_LIQUIDATION_FEE),
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                  .sub(20), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
                EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
              )
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(4), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                shortValue: { _value: 0 },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                shortValue: { _value: 0 },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                shortValue: { _value: 0 },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with shortfall', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.minMaintenance = parse6decimal('50')
              await market.connect(owner).updateRiskParameter(riskParameter)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                  .sub(EXPECTED_PNL),
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                )
                  .add(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                shortValue: { _value: 0 },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('216')
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                .sub(EXPECTED_FUNDING_WITH_FEE_2_5_43.add(EXPECTED_INTEREST_5_43))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              factory.operators.whenCalledWith(user.address, liquidator.address).returns(false)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_5.timestamp,
                  0,
                  0,
                  0,
                  shortfall.mul(-1),
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: 0,
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

            const oracleVersionHigherPrice_0 = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            const oracleVersionHigherPrice_1 = {
              price: parse6decimal('128'),
              timestamp: TIMESTAMP + 10800,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice_0.timestamp).returns(oracleVersionHigherPrice_0)

            oracle.at.whenCalledWith(oracleVersionHigherPrice_1.timestamp).returns(oracleVersionHigherPrice_1)
            oracle.status.returns([oracleVersionHigherPrice_1, ORACLE_VERSION_5.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })
      })

      context('short position', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('position delta', async () => {
          context('open', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('opens the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )
                .to.emit(market, 'OrderCreated')
                .withArgs(user.address, {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  collateral: COLLATERAL,
                  orders: 1,
                  shortPos: POSITION,
                })

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                collateral: COLLATERAL,
                shortPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                latestId: 0,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                collateral: COLLATERAL.mul(2),
                orders: 2,
                makerPos: POSITION,
                shortPos: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  0,
                  POSITION,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                collateral: COLLATERAL,
                shortPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                latestId: 0,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                collateral: COLLATERAL.mul(2),
                makerPos: POSITION,
                shortPos: POSITION,
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  0,
                  POSITION,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  POSITION,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  POSITION,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.staleAfter = BigNumber.from(9600)
              await market.connect(owner).updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION.div(2),
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              const riskParameterTakerFee = { ...riskParameter.takerFee }
              riskParameterTakerFee.linearFee = parse6decimal('0.01')
              riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
              riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
              riskParameter.takerFee = riskParameterTakerFee
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
              const TAKER_FEE_ONLY = parse6decimal('7.38') // position * (0.01 + 0.002) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              dsu.transferFrom
                .whenCalledWith(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
                .returns(true)
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION.div(2),
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE.div(2)),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(SETTLEMENT_FEE.div(2))
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_ONLY)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              const riskParameter = { ...(await market.riskParameter()) }
              const riskParameterTakerFee = { ...riskParameter.takerFee }
              riskParameterTakerFee.linearFee = parse6decimal('0.01')
              riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
              riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
              riskParameter.takerFee = riskParameterTakerFee
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.008) * price
              const TAKER_FEE_ONLY = parse6decimal('7.38') // position * (0.01 + 0.002) * price
              const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
              const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              dsu.transferFrom
                .whenCalledWith(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
                .returns(true)
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION.div(2),
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(
                  TAKER_FEE_ONLY_WITHOUT_FEE.add(
                    EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                  ),
                ).sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_ONLY_FEE)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: TAKER_FEE_ONLY_WITHOUT_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  latestId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  latestId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_4.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  short: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position and settles (next version)', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                const riskParameterTakerFee = { ...riskParameter.takerFee }
                riskParameterTakerFee.scale = POSITION.div(4)
                riskParameter.takerFee = riskParameterTakerFee
                await market.updateRiskParameter(riskParameter)

                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_4.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 4,
                  latestId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_FUNDING_WITH_FEE_2_25_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_INTEREST_25_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 4), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                  .add(EXPECTED_INTEREST_FEE_5_123)
                  .add(EXPECTED_INTEREST_FEE_25_123)
                expectGlobalEq(await market.global(), {
                  currentId: 4,
                  latestId: 3,
                  protocolFee: totalFee.div(2).sub(1), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(4), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                      .div(5)
                      .add(EXPECTED_FUNDING_WITH_FEE_2_25_123.add(EXPECTED_INTEREST_25_123).mul(2).div(5))
                      .mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles later', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles later with fee', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                const riskParameterTakerFee = { ...riskParameter.takerFee }
                riskParameterTakerFee.linearFee = parse6decimal('0.01')
                riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
                riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
                riskParameter.takerFee = riskParameterTakerFee
                await market.updateRiskParameter(riskParameter)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.settlementFee = parse6decimal('0.50')
                await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

                const TAKER_FEE = parse6decimal('4.92') // position * (0.01 + 0.002 - 0.004) * price
                const TAKER_FEE_ONLY = parse6decimal('7.38') // position * (0.01 + 0.002) * price
                const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
                const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
                const SETTLEMENT_FEE = parse6decimal('0.50')

                dsu.transferFrom.whenCalledWith(user.address, market.address, TAKER_FEE.mul(1e12)).returns(true)
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(TAKER_FEE)
                    .sub(SETTLEMENT_FEE),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(TAKER_FEE_ONLY_WITHOUT_FEE)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_ONLY_FEE)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(TAKER_FEE_ONLY_WITHOUT_FEE)
                      .div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('same price same timestamp settle', async () => {
            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              valid: true,
            }

            oracle.at.whenCalledWith(oracleVersionSameTimestamp.timestamp).returns(oracleVersionSameTimestamp)
            oracle.status.returns([oracleVersionSameTimestamp, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
          })

          it('lower price same rate settle', async () => {
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))

            const EXPECTED_PNL = parse6decimal('-2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionLowerPrice = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
            oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(1).div(5)),
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(4).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestShort: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlShort: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10)
                  .sub(1),
              }, // loss of precision
              longValue: { _value: 0 },
              shortValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(1).div(5)),
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(4).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestShort: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlShort: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10),
              },
              longValue: { _value: 0 },
              shortValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.margin = parse6decimal('0.31')
              await market.updateRiskParameter(riskParameter)

              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('390')).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  parse6decimal('390'),
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )
            })

            it('with socialization to zero', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)).sub(
                  EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96),
                ),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(20), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
                EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
              )
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(4), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with partial socialization', async () => {
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  POSITION.div(4),
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 5620
              const EXPECTED_INTEREST_1 = BigNumber.from(5620)
              const EXPECTED_INTEREST_FEE_1 = EXPECTED_INTEREST_1.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_1 = EXPECTED_INTEREST_1.sub(EXPECTED_INTEREST_FEE_1)

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 96 = 4385
              const EXPECTED_INTEREST_2 = BigNumber.from(4385)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 * 0.5 = 35105
              const EXPECTED_INTEREST_3 = BigNumber.from(35105)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              const oracleVersionHigherPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userC)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96)
                  .sub(EXPECTED_INTEREST_2)
                  .sub(EXPECTED_FUNDING_WITH_FEE_3_25_123)
                  .sub(EXPECTED_INTEREST_3)
                  .add(EXPECTED_PNL),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).mul(4).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2).mul(4).div(5))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(17), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userC.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).div(5),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3))
                  .sub(EXPECTED_PNL)
                  .sub(12), // loss of precision
              })
              expectPositionEq(await market.positions(userC.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
              })
              expectOrderEq(await market.pendingOrders(userC.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_2))
                .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(5), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(2)
                    .div(25)
                    .sub(1),
                }, // loss of precision
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .sub(1), // loss of precision
                }, // loss of precision
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_2))
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3).mul(2).div(5))
                    .sub(EXPECTED_PNL.mul(2).div(5))
                    .sub(4), // loss of precision
                },
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_2))
                    .add(EXPECTED_FUNDING_WITH_FEE_3_25_123.add(EXPECTED_INTEREST_3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with shortfall', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)).add(
                  EXPECTED_PNL,
                ),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                  .sub(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('390')
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_43.add(EXPECTED_INTEREST_WITHOUT_FEE_5_43))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(28) // loss of precision
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              factory.operators.whenCalledWith(userB.address, liquidator.address).returns(false)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userB.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_5.timestamp,
                  0,
                  0,
                  0,
                  shortfall.mul(-1),
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: 0,
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })

          context('short', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  parse6decimal('216'),
                  false,
                )
            })

            it('default', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_5_150)
                  .sub(EXPECTED_LIQUIDATION_FEE),
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                  .sub(22), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(1), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(4), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                },
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with shortfall', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.minMaintenance = parse6decimal('50')
              await market.connect(owner).updateRiskParameter(riskParameter)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_PNL),
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                },
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('216')
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_2_5_203)
                .sub(EXPECTED_INTEREST_5_203)
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              factory.operators.whenCalledWith(user.address, liquidator.address).returns(false)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_5.timestamp,
                  0,
                  0,
                  0,
                  shortfall.mul(-1),
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: 0,
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and funding / interest fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

            const oracleVersionHigherPrice_0 = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            const oracleVersionHigherPrice_1 = {
              price: parse6decimal('118'),
              timestamp: TIMESTAMP + 10800,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice_0.timestamp).returns(oracleVersionHigherPrice_0)

            oracle.at.whenCalledWith(oracleVersionHigherPrice_1.timestamp).returns(oracleVersionHigherPrice_1)
            oracle.status.returns([oracleVersionHigherPrice_1, ORACLE_VERSION_5.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('does not zero position and settlement fee upon closing', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            const riskParmeterTakerFee = { ...riskParameter.takerFee }
            riskParmeterTakerFee.linearFee = parse6decimal('0.01')
            riskParmeterTakerFee.proportionalFee = parse6decimal('0.002')
            riskParmeterTakerFee.adiabaticFee = parse6decimal('0.008')
            const riskParameterMakerFee = { ...riskParameter.makerFee }
            riskParameterMakerFee.linearFee = parse6decimal('0.01')
            riskParameterMakerFee.proportionalFee = parse6decimal('0.004')
            riskParameterMakerFee.adiabaticFee = parse6decimal('0.008')
            riskParameter.takerFee = riskParmeterTakerFee
            riskParameter.makerFee = riskParameterMakerFee
            await market.updateRiskParameter(riskParameter)

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.settlementFee = parse6decimal('0.50')
            await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

            const EXPECTED_SETTLEMENT_FEE = parse6decimal('0.50')
            const EXPECTED_MAKER_LINEAR = parse6decimal('6.15') // position * (0.01) * price
            const EXPECTED_MAKER_PROPORTIONAL = parse6decimal('1.23') // position * (0.004 * 0.5) * price
            const EXPECTED_MAKER_ADIABATIC = parse6decimal('1.23') // position * (0.008 * (0.0 + 0.5) / 2) * price

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false),
            )
              .to.emit(market, 'Updated')
              .withArgs(
                user.address,
                user.address,
                ORACLE_VERSION_3.timestamp,
                POSITION.div(2),
                0,
                0,
                0,
                false,
                constants.AddressZero,
              )

            const marketParameter2 = { ...(await market.parameter()) }
            marketParameter2.closed = true
            await market.updateParameter(beneficiary.address, coordinator.address, marketParameter2)

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_SETTLEMENT_FEE)
                .sub(EXPECTED_MAKER_LINEAR.add(EXPECTED_MAKER_PROPORTIONAL).div(10))
                .sub(EXPECTED_MAKER_ADIABATIC),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_MAKER_LINEAR.add(EXPECTED_MAKER_PROPORTIONAL).div(10)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2),
              oracleFee: totalFee.div(2).div(10).add(EXPECTED_SETTLEMENT_FEE),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: { _value: EXPECTED_MAKER_LINEAR.add(EXPECTED_MAKER_PROPORTIONAL).mul(9).div(10).div(10) },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerLinearFee: { _value: -EXPECTED_MAKER_LINEAR.div(5) },
              makerProportionalFee: { _value: -EXPECTED_MAKER_PROPORTIONAL.div(5) },
              makerNegFee: { _value: -EXPECTED_MAKER_ADIABATIC.div(5) },
              settlementFee: { _value: -EXPECTED_SETTLEMENT_FEE },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })
      })

      context('all positions', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.scale = POSITION
          riskParameter.takerFee = riskParameterTakerFee
          await market.updateRiskParameter(riskParameter)
        })

        context('position delta', async () => {
          context('open', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )
            })

            it('opens the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                latestId: 0,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                collateral: COLLATERAL.mul(3),
                makerPos: POSITION,
                longPos: POSITION,
                shortPos: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                latestId: 0,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 4,
                collateral: COLLATERAL.mul(3),
                makerPos: POSITION,
                longPos: POSITION,
                shortPos: POSITION,
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_3.timestamp,
                  0,
                  POSITION,
                  0,
                  0,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              const riskParameterTakerFee = { ...riskParameter.takerFee }
              riskParameterTakerFee.linearFee = parse6decimal('0.01')
              riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
              riskParameterTakerFee.adiabaticFee = parse6decimal('0.004')
              riskParameter.takerFee = riskParameterTakerFee
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const EXPECTED_TAKER_LINEAR = parse6decimal('6.15') // position * (0.01) * price
              const EXPECTED_TAKER_PROPORTIONAL = parse6decimal('1.845') // position * (0.003) * price // 0.50 + 1.00 skew from setup
              const EXPECTED_TAKER_ADIABATIC = parse6decimal('0.615') // position * (0.001) * price

              const EXPECTED_TAKER_LINEAR_C = parse6decimal('12.30') // position * (0.01) * price
              const EXPECTED_TAKER_PROPORTIONAL_C = parse6decimal('3.69') // position * (0.003) * price // 0.50 + 1.00 skew from setup

              const TAKER_FEE = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL).add(EXPECTED_TAKER_ADIABATIC)
              const TAKER_FEE_ONLY = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL)
              const TAKER_FEE_ONLY_C = EXPECTED_TAKER_LINEAR_C.add(EXPECTED_TAKER_PROPORTIONAL_C)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE.div(3).add(1))
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(SETTLEMENT_FEE.div(3).add(1))
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                .add(TAKER_FEE_ONLY)
                .add(TAKER_FEE_ONLY_C)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10), // loss of precision
                donation: totalFee.div(2).mul(8).div(10), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later from different account', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user, userB)
              await settle(market, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and deposits later from different account', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await deposit(market, COLLATERAL, user, userB)
              await deposit(market, COLLATERAL, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and settles later from different account while stale', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_6.timestamp])
              oracle.request.returns()

              await settle(market, user, userB)
              await settle(market, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('opens the position and deposits later from different account while stale', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  user.address,
                  user.address,
                  ORACLE_VERSION_2.timestamp,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_6.timestamp])
              oracle.request.returns()

              await deposit(market, COLLATERAL, user, userB)
              await deposit(market, COLLATERAL, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )

              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  latestId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10),
                  riskFee: totalFee.div(2).div(10),
                  donation: totalFee.div(2).mul(8).div(10),
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  latestId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10),
                  riskFee: totalFee.div(2).div(10),
                  donation: totalFee.div(2).mul(8).div(10),
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_4.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  long: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10),
                  riskFee: totalFee.div(2).div(10),
                  donation: totalFee.div(2).mul(8).div(10),
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(4),
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes a second position and settles (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_4.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 4,
                  latestId: 3,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.div(4))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_INTEREST_10_80_123_ALL.div(5))
                    .sub(3), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 4), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.mul(3).div(4))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_80_123_ALL)
                    .sub(38), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_FUNDING_FEE_2_10_123_ALL)
                  .add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                  .add(EXPECTED_INTEREST_FEE_10_80_123_ALL)
                expectGlobalEq(await market.global(), {
                  currentId: 4,
                  latestId: 3,
                  protocolFee: totalFee.div(2).sub(2), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(4), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.mul(3).div(4))
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_80_123_ALL)
                      .div(10)
                      .sub(3), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .add(
                        EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.div(4)
                          .sub(EXPECTED_INTEREST_10_80_123_ALL.div(5))
                          .mul(2)
                          .div(5),
                      )
                      .sub(2), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .add(
                        EXPECTED_FUNDING_WITH_FEE_2_10_123_ALL.add(EXPECTED_INTEREST_10_80_123_ALL.mul(4).div(5)).div(
                          10,
                        ),
                      )
                      .mul(-1)
                      .sub(2), // loss of precision
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles later', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })

              it('closes the position and settles later with fee', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                const riskParameterTakerFee = { ...riskParameter.takerFee }
                riskParameterTakerFee.linearFee = parse6decimal('0.01')
                riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
                riskParameterTakerFee.adiabaticFee = parse6decimal('0.004')
                riskParameter.takerFee = riskParameterTakerFee
                await market.updateRiskParameter(riskParameter)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.settlementFee = parse6decimal('0.50')
                await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

                const EXPECTED_TAKER_LINEAR = parse6decimal('6.15') // position * (0.01) * price
                const EXPECTED_TAKER_PROPORTIONAL = parse6decimal('0.615') // position * (0.001) * price
                const EXPECTED_TAKER_ADIABATIC = parse6decimal('1.845') // position * (0.003) * price

                const TAKER_FEE = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL).add(EXPECTED_TAKER_ADIABATIC)
                const TAKER_FEE_ONLY = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL)
                const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
                const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
                const SETTLEMENT_FEE = parse6decimal('0.50')

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'Updated')
                  .withArgs(
                    user.address,
                    user.address,
                    ORACLE_VERSION_3.timestamp,
                    0,
                    0,
                    0,
                    0,
                    false,
                    constants.AddressZero,
                  )

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(TAKER_FEE)
                    .sub(SETTLEMENT_FEE)
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_5.timestamp,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .add(TAKER_FEE_ONLY_WITHOUT_FEE)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  takerLinearFee: { _value: -EXPECTED_TAKER_LINEAR.div(5) },
                  takerProportionalFee: { _value: -EXPECTED_TAKER_PROPORTIONAL.div(5) },
                  takerNegFee: { _value: -EXPECTED_TAKER_ADIABATIC.div(5) },
                  settlementFee: { _value: -SETTLEMENT_FEE },
                  liquidationFee: { _value: -riskParameter.liquidationFee },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('same price same timestamp settle', async () => {
            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              valid: true,
            }

            oracle.at.whenCalledWith(oracleVersionSameTimestamp.timestamp).returns(oracleVersionSameTimestamp)
            oracle.status.returns([oracleVersionSameTimestamp, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              latestId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
          })

          it('lower price same rate settle', async () => {
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))

            const EXPECTED_PNL = parse6decimal('2').mul(10) // maker pnl

            const oracleVersionLowerPrice = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
            oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2),
                  fundingLong: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2).add(1), // loss of precision
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.mul(-1).add(4), // loss of precision
                  fundingFee: EXPECTED_FUNDING_FEE_1_10_123_ALL.sub(5), // loss of precision
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL.sub(5), // loss of precision
                  interestLong: EXPECTED_INTEREST_10_67_123_ALL.div(3).mul(-1).add(2), // loss of precision
                  interestShort: EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3).mul(-1).add(3),
                  interestFee: EXPECTED_INTEREST_FEE_10_67_123_ALL.sub(1), // loss of precision
                  pnlMaker: EXPECTED_PNL.div(2).mul(-1),
                  pnlLong: EXPECTED_PNL.div(2).mul(-1),
                  pnlShort: EXPECTED_PNL,
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                .sub(2), // loss of precision
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .div(10)
                  .sub(2), // loss of precision
              },
              longValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .div(5)
                  .sub(1), // loss of precision
              },
              shortValue: {
                _value: EXPECTED_PNL.sub(EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL)
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                  .div(10),
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('-2').mul(10)

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2),
                  fundingLong: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2).add(1), // loss of precision
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.mul(-1).add(4), // loss of precision
                  fundingFee: EXPECTED_FUNDING_FEE_1_10_123_ALL.sub(5), // loss of precision
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL.sub(5), // loss of precision
                  interestLong: EXPECTED_INTEREST_10_67_123_ALL.div(3).mul(-1).add(2), // loss of precision
                  interestShort: EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3).mul(-1).add(3),
                  interestFee: EXPECTED_INTEREST_FEE_10_67_123_ALL.sub(1), // loss of precision
                  pnlMaker: EXPECTED_PNL.div(2).mul(-1),
                  pnlLong: EXPECTED_PNL.div(2).mul(-1),
                  pnlShort: EXPECTED_PNL,
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                2,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                .sub(2), // loss of precision
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .div(10)
                  .sub(1), // loss of precision
              },
              longValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .div(5),
              },
              shortValue: {
                _value: EXPECTED_PNL.sub(EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL)
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                  .div(10)
                  .sub(1), // loss of precision
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  parse6decimal('450'),
                  false,
                )
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )

              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('with socialization to zero', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('78').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)

              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.sub(EXPECTED_PNL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_45_ALL.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_10_123_ALL)
                  .sub(9), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL)
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(25), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                .add(EXPECTED_FUNDING_FEE_2_10_45_ALL)
                .add(EXPECTED_INTEREST_FEE_10_67_45_ALL)
                .add(EXPECTED_FUNDING_FEE_3_10_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(7), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).sub(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_45_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_10_67_45_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_45_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3_10_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_10_67_45_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_3_10_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with partial socialization', async () => {
              // (0.258823 / 365 / 24 / 60 / 60 ) * 3600 * 12 * 123 = 43610
              const EXPECTED_INTEREST_1 = BigNumber.from(43610)
              const EXPECTED_INTEREST_FEE_1 = EXPECTED_INTEREST_1.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_1 = EXPECTED_INTEREST_1.sub(EXPECTED_INTEREST_FEE_1)

              // (0.258823 / 365 / 24 / 60 / 60 ) * 3600 * 12 * 45 = 15960
              const EXPECTED_INTEREST_2 = BigNumber.from(15960)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 2 * 123 = 28090
              const EXPECTED_INTEREST_3 = BigNumber.from(28090)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              // rate_0 = 0.09
              // rate_1 = rate_0 + (elapsed * skew / k)
              // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
              // (0.09 + (0.09 + 3600 * 0.50 / 40000)) / 2 * 3600 * 7 * 123 / (86400 * 365) = 11060
              const EXPECTED_FUNDING_3 = BigNumber.from(11060)
              const EXPECTED_FUNDING_FEE_3 = BigNumber.from(1110)
              const EXPECTED_FUNDING_WITH_FEE_3 = EXPECTED_FUNDING_3.add(EXPECTED_FUNDING_FEE_3.div(2))
              const EXPECTED_FUNDING_WITHOUT_FEE_3 = EXPECTED_FUNDING_3.sub(EXPECTED_FUNDING_FEE_3.div(2))

              dsu.transferFrom.whenCalledWith(userD.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userD)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userD.address,
                  POSITION.div(5),
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userD)

              const EXPECTED_PNL = parse6decimal('78').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userD)

              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userD)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userD)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_1.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                  .sub(EXPECTED_INTEREST_2.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3.mul(5).div(7))
                  .sub(EXPECTED_INTEREST_3.div(3))
                  .sub(EXPECTED_PNL)
                  .sub(6), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.mul(5).div(12))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_1.mul(10).div(12))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.mul(5).div(12))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_2.mul(10).div(12))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(19), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_10_45_ALL)
                .add(EXPECTED_INTEREST_FEE_2)
                .add(EXPECTED_FUNDING_FEE_3)
                .add(EXPECTED_INTEREST_FEE_3)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(10), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).sub(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(5),
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .sub(EXPECTED_PNL)
                    .div(12)
                    .sub(1),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_1.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_1.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_2)
                    .div(12)
                    .sub(2), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_1.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_2.div(3))
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_1.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_2.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_2)
                    .div(12)
                    .add(
                      EXPECTED_FUNDING_WITHOUT_FEE_3.mul(2)
                        .div(7)
                        .add(EXPECTED_INTEREST_WITHOUT_FEE_3)
                        .sub(EXPECTED_PNL.mul(2).div(5))
                        .div(2),
                    )
                    .sub(6), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_1.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_2.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3.mul(5).div(7))
                    .sub(EXPECTED_INTEREST_3.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_1.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_2.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_3)
                    .add(EXPECTED_INTEREST_3.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(7).div(5))
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with shortfall', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('90').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('33'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .sub(EXPECTED_PNL)
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(EXPECTED_PNL)
                  .sub(13), // loss of precision
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('33'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              const shortfall = parse6decimal('450')
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_33_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_33_ALL)
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(27) // loss of precision
              factory.operators.whenCalledWith(userB.address, liquidator.address).returns(false)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userB.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  userB.address,
                  ORACLE_VERSION_5.timestamp,
                  0,
                  0,
                  0,
                  shortfall.mul(-1),
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: 0,
              })
              expect(await market.liquidators(userB.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })

          context('long', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  parse6decimal('216'),
                  false,
                )
            })

            it('default', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              // rate_0 = 0.09
              // rate_1 = rate_0 + (elapsed * skew / k)
              // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
              // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 10 * 123 / (86400 * 365) = 18960
              const EXPECTED_FUNDING_3 = BigNumber.from(18960)
              const EXPECTED_FUNDING_FEE_3 = BigNumber.from(1896)
              const EXPECTED_FUNDING_WITH_FEE_3 = EXPECTED_FUNDING_3.add(EXPECTED_FUNDING_FEE_3.div(2))
              const EXPECTED_FUNDING_WITHOUT_FEE_3 = EXPECTED_FUNDING_3.sub(EXPECTED_FUNDING_FEE_3.div(2))

              // rate * elapsed * utilization * min(maker, taker) * price
              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 140410
              const EXPECTED_INTEREST_3 = BigNumber.from(140410)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: parse6decimal('216')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_96_ALL.div(3))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(9), // loss of precision
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 5,
                latestId: 4,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_3)
                  .sub(EXPECTED_PNL.mul(2))
                  .sub(45), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                .add(EXPECTED_FUNDING_FEE_2_10_96_ALL)
                .add(EXPECTED_INTEREST_FEE_10_67_96_ALL)
                .add(EXPECTED_FUNDING_FEE_3)
                .add(EXPECTED_INTEREST_FEE_3)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                latestId: 4,
                protocolFee: totalFee.div(2).sub(5), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(5), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(-1)
                    .div(10),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_96_ALL.div(3))
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_96_ALL)
                    .add(EXPECTED_INTEREST_10_67_96_ALL.mul(2).div(3))
                    .mul(-1)
                    .div(10)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_3)
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .sub(5),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_96_ALL.div(3))
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_96_ALL)
                    .add(EXPECTED_INTEREST_10_67_96_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_3)
                    .add(EXPECTED_INTEREST_3)
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(-1)
                    .div(10)
                    .sub(1), // loss of precision
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })
            })

            it('with shortfall', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.minMaintenance = parse6decimal('50')
              await market.connect(owner).updateRiskParameter(riskParameter)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_4.timestamp,
                  0,
                  0,
                  0,
                  0,
                  true,
                  constants.AddressZero,
                )

              // rate_1 = rate_0 + (elapsed * skew / k)
              // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
              // (0.045 + (0.045 + 3600 * 0.5 / 40000)) / 2 * 3600 * 10 * 43 / (86400 * 365) = 3315
              const EXPECTED_FUNDING_2 = BigNumber.from(3315)
              const EXPECTED_FUNDING_FEE_2 = BigNumber.from(330)
              const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.add(EXPECTED_FUNDING_FEE_2.div(2))
              const EXPECTED_FUNDING_WITHOUT_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2.div(2))

              // rate * elapsed * utilization * min(maker, taker) * price
              // (0.40 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 43 = 19640
              const EXPECTED_INTEREST_2 = BigNumber.from(19640)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: parse6decimal('216')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .sub(EXPECTED_PNL)
                  .sub(2), // loss of precision
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(EXPECTED_PNL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                latestId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                liquidationFee: { _value: -riskParameter.liquidationFee },
              })

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              const shortfall = parse6decimal('216')
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2.div(2))
                .sub(EXPECTED_INTEREST_2.div(3))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(6) // loss of precision
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              factory.operators.whenCalledWith(user.address, liquidator.address).returns(false)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'Updated')
                .withArgs(
                  liquidator.address,
                  user.address,
                  ORACLE_VERSION_5.timestamp,
                  0,
                  0,
                  0,
                  shortfall.mul(-1),
                  false,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 4,
                latestId: 3,
                collateral: 0,
              })
              expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 4), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )
            dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

            const oracleVersionHigherPrice_0 = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            const oracleVersionHigherPrice_1 = {
              price: parse6decimal('128'),
              timestamp: TIMESTAMP + 10800,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice_0.timestamp).returns(oracleVersionHigherPrice_0)

            oracle.at.whenCalledWith(oracleVersionHigherPrice_1.timestamp).returns(oracleVersionHigherPrice_1)
            oracle.status.returns([oracleVersionHigherPrice_1, ORACLE_VERSION_5.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_5.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_VERSION,
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })
        })
      })

      context('invariant violations', async () => {
        it('reverts if under margin', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('500')).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                parse6decimal('1000'),
                0,
                0,
                parse6decimal('500'),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })

        it('reverts if paused', async () => {
          factory.paused.returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'InstancePausedError')
        })

        it('reverts if over maker limit', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.makerLimit = POSITION.div(2)
          await market.updateRiskParameter(riskParameter)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketMakerOverLimitError')
        })

        it('reverts if under efficiency limit', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.efficiencyLimit = parse6decimal('0.6')
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              POSITION.div(2),
              0,
              0,
              COLLATERAL,
              false,
            )
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
        })

        it('reverts if too many pending orders (global)', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.maxPendingGlobal = BigNumber.from(3)
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              POSITION.div(2),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 1])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              POSITION.add(1),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 2])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              POSITION.add(2),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 3])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(3), 0, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketExceedsPendingIdLimitError')
        })

        it('reverts if too many pending orders (local)', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.maxPendingLocal = BigNumber.from(3)
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              POSITION.div(2),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 1])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, 0, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 2])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(2), 0, 0, 0, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 3])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(3), 0, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketExceedsPendingIdLimitError')
        })

        it('reverts if not single sided', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                POSITION,
                POSITION,
                0,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                POSITION,
                0,
                POSITION,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION,
                POSITION,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')
        })

        it('reverts if insufficient collateral', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                0,
                COLLATERAL.add(1).mul(-1),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientCollateralError')
        })

        it('reverts if price is stale', async () => {
          const riskParameter = { ...(await market.riskParameter()), staleAfter: BigNumber.from(7200) }
          await market.connect(owner).updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp - 1])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // revert if withdrawing
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')

          // revert if changing position
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')
        })

        it('reverts if sender is not account', async () => {
          const riskParameter = { ...(await market.riskParameter()), staleAfter: BigNumber.from(7200) }
          await market.connect(owner).updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp - 1])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // revert if withdrawing
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')

          // revert if changing position
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')
        })

        it('reverts if under minimum margin', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('1')).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('99'),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })

        it('reverts if closed', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.closed = true
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketClosedError')
        })

        it('reverts if taker > maker', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                POSITION.add(1),
                0,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, `MarketInsufficientLiquidityError`)
        })

        it('reverts when the position is over-closed', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = BigNumber.from(14400)
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          // open to POSITION (POSITION / 2 settled)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // can't close more than POSITION / 2
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2).sub(1),
                0,
                0,
                false,
              ),
          ).to.revertedWithCustomError(market, 'MarketOverCloseError')

          // close out as much as possible
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              POSITION.div(2),
              0,
              0,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // can't close any more
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2).sub(1),
                0,
                0,
                false,
              ),
          ).to.revertedWithCustomError(market, 'MarketOverCloseError')

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // can now close out rest
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(user.address, user.address, ORACLE_VERSION_5.timestamp, 0, 0, 0, 0, false, constants.AddressZero)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.at.whenCalledWith(ORACLE_VERSION_5.timestamp).returns(ORACLE_VERSION_5)
          oracle.status.returns([ORACLE_VERSION_5, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
        })

        context('in liquidation', async () => {
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('225')

          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                POSITION,
                0,
                0,
                parse6decimal('450'),
                false,
              )
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

            const oracleVersionHigherPrice = {
              price: parse6decimal('150'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, oracleVersionHigherPrice.timestamp + 3600])
            oracle.request.whenCalledWith(user.address).returns()

            dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
          })

          it('it reverts if not protected', async () => {
            await expect(
              market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
            ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
          })

          it('it reverts if already liquidated', async () => {
            await market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true)

            await expect(
              market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            ).to.be.revertedWithCustomError(market, 'MarketProtectedError')
          })

          it('it reverts if withdrawing collateral', async () => {
            await expect(
              market
                .connect(liquidator)
                ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, -1, true),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })

          it('it reverts if position doesnt close', async () => {
            await expect(
              market
                .connect(liquidator)
                ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 1, 0, 0, 0, true),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })

          it('reverts if position increases in magnitude', async () => {
            const positionMaker = parse6decimal('20.000')
            const positionLong = parse6decimal('10.000')
            const collateral = parse6decimal('1000')
            const collateral2 = parse6decimal('350')
            const collateralWithdraw2 = parse6decimal('50')
            const collateralLiquidate = parse6decimal('4611686018427') // 2^62-1

            const oracleVersion = {
              price: parse6decimal('100'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersion.timestamp).returns(oracleVersion)
            oracle.status.returns([oracleVersion, TIMESTAMP + 7300])
            oracle.request.returns()

            dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                positionMaker,
                0,
                0,
                collateral,
                false,
              )
            dsu.transferFrom.whenCalledWith(user.address, market.address, collateral2.mul(1e12)).returns(true)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                positionLong,
                0,
                collateral2,
                false,
              )

            const oracleVersion2 = {
              price: parse6decimal('100'),
              timestamp: TIMESTAMP + 7300,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersion2.timestamp).returns(oracleVersion2)
            oracle.status.returns([oracleVersion2, TIMESTAMP + 7400])
            oracle.request.returns()

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

            oracle.status.returns([oracleVersion2, TIMESTAMP + 7500])
            oracle.request.returns()

            dsu.transfer.whenCalledWith(user.address, collateralWithdraw2.mul(1e12)).returns(true)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                0,
                -collateralWithdraw2,
                false,
              )

            const oracleVersion3 = {
              price: parse6decimal('99.9999'),
              timestamp: TIMESTAMP + 7380,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersion3.timestamp).returns(oracleVersion3)
            oracle.status.returns([oracleVersion3, TIMESTAMP + 7500])
            oracle.request.returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  collateralLiquidate,
                  0,
                  0,
                  true,
                ),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })
        })

        context('always close mode', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          context('closing long', async () => {
            beforeEach(async () => {
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION.mul(2),
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()
              await settle(market, user)
            })

            it('allows closing when takerCloseAlways', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              ).to.not.be.reverted
            })

            it('disallows closing when not takerCloseAlways', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })

            it('disallows short increasing (efficiency)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.5')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })

            it('disallows short increasing (liquidity)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.3')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })
          })

          context('closing short', async () => {
            beforeEach(async () => {
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, COLLATERAL, false)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  POSITION.mul(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()
              await settle(market, user)
            })

            it('allows closing when takerCloseAlways', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              ).to.not.be.reverted
            })

            it('disallows closing when not takerCloseAlways', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })

            it('disallows long increasing (efficiency)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.5')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })

            it('disallows long increasing (liquidity)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.3')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })
          })

          context('closing maker', async () => {
            beforeEach(async () => {
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, COLLATERAL, false)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  POSITION.mul(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()
              await settle(market, user)
            })

            it('allows closing when makerCloseAlways', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.makerCloseAlways = true
              await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

              await expect(
                market
                  .connect(userB)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
              ).to.not.be.reverted
            })

            it('disallows closing when not makerCloseAlways', async () => {
              await expect(
                market
                  .connect(userB)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })
          })
        })
      })

      context('settle only', async () => {
        it('reverts if update during settle-only', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settle = true
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('500')).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                parse6decimal('10'),
                0,
                0,
                parse6decimal('1000'),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketSettleOnlyError')
        })
      })

      context('liquidation w/ under min collateral', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              parse6decimal('216'),
              false,
            )
        })

        it('properly charges liquidation fee', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('80').mul(5)
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('50') // 6.45 -> under minimum

          const oracleVersionLowerPrice = {
            price: parse6decimal('43'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              liquidator.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              0,
              0,
              0,
              true,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: parse6decimal('216')
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
              .sub(EXPECTED_PNL),
          })
          expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
            protection: 1,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
              .add(EXPECTED_PNL)
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 3,
            latestId: 2,
            protocolFee: totalFee.div(2).sub(3), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            },
            longValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            shortValue: { _value: 0 },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })
      })

      context('liquidation w/ partial closed', async () => {
        beforeEach(async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = BigNumber.from(14400)
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('324')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              POSITION.div(2),
              parse6decimal('324'),
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              POSITION.mul(3).div(4),
              0,
              false,
            )
          await settle(market, userB)
        })

        it('default', async () => {
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

          const oracleVersionLowerPrice = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(4).sub(1),
                0,
                true,
              ),
          ).to.revertedWithCustomError(market, 'MarketOverCloseError')

          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.add(1).mul(1e12)).returns(true)
          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), -1, true),
          ).to.revertedWithCustomError(market, 'MarketInvalidProtectionError')

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, true),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              liquidator.address,
              user.address,
              ORACLE_VERSION_5.timestamp,
              0,
              0,
              POSITION.div(4),
              0,
              true,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.at.whenCalledWith(ORACLE_VERSION_5.timestamp).returns(ORACLE_VERSION_5)
          oracle.status.returns([ORACLE_VERSION_5, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const oracleVersionLowerPrice2 = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 14400,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
          oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            currentId: 0,
            latestId: 0,
            claimable: EXPECTED_LIQUIDATION_FEE,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            short: POSITION.div(4),
          })

          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          await expect(market.connect(liquidator).claimFee())
            .to.emit(market, 'FeeClaimed')
            .withArgs(liquidator.address, EXPECTED_LIQUIDATION_FEE)

          expectLocalEq(await market.locals(liquidator.address), DEFAULT_LOCAL)
        })
      })

      context('liquidation w/ invalidation', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              POSITION.div(2),
              parse6decimal('216'),
              false,
            )
        })

        it('default', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('27').mul(5)
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

          const oracleVersionLowerPrice = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              liquidator.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              0,
              0,
              0,
              true,
              constants.AddressZero,
            )

          oracle.at
            .whenCalledWith(ORACLE_VERSION_4.timestamp)
            .returns({ ...ORACLE_VERSION_4, price: oracleVersionLowerPrice.price, valid: false })
          oracle.status.returns([
            { ...ORACLE_VERSION_4, price: oracleVersionLowerPrice.price, valid: false },
            ORACLE_VERSION_5.timestamp,
          ])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              liquidator.address,
              user.address,
              ORACLE_VERSION_5.timestamp,
              0,
              0,
              0,
              0,
              true,
              constants.AddressZero,
            )
          await settle(market, userB)

          oracle.at.whenCalledWith(ORACLE_VERSION_5.timestamp).returns(ORACLE_VERSION_5)
          oracle.status.returns([ORACLE_VERSION_5, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const oracleVersionLowerPrice2 = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 18000,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
          oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_ROUND_3_ACC = BigNumber.from(28795) // position open one extra version due to invalid first liquidation
          const EXPECTED_ROUND_3_ACC_WITHOUT_FEE = BigNumber.from(26010)
          const EXPECTED_ROUND_3_ACC_FEE = EXPECTED_ROUND_3_ACC.sub(EXPECTED_ROUND_3_ACC_WITHOUT_FEE)

          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            currentId: 0,
            latestId: 0,
            claimable: EXPECTED_LIQUIDATION_FEE, // does not double charge
          })
          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 6,
            latestId: 5,
            collateral: parse6decimal('216')
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
              .sub(EXPECTED_INTEREST_5_150)
              .sub(EXPECTED_ROUND_3_ACC)
              .sub(EXPECTED_LIQUIDATION_FEE), // does not double charge
          })
          expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_6.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 6), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp + 3600,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp + 3600), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 6,
            latestId: 5,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
              .add(EXPECTED_ROUND_3_ACC_WITHOUT_FEE)
              .sub(32), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_6.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 6), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp + 3600,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp + 3600), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_2_5_150)
            .add(EXPECTED_INTEREST_FEE_5_150)
            .add(EXPECTED_ROUND_3_ACC_FEE)
          expectGlobalEq(await market.global(), {
            currentId: 6,
            latestId: 5,
            protocolFee: totalFee.div(2).sub(2), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(4), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_6.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(6), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp + 3600,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            },
            longValue: { _value: 0 },
            shortValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                .add(EXPECTED_PNL)
                .div(10)
                .sub(2), // loss of precision
            },
            longValue: { _value: 0 },
            shortValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                .add(EXPECTED_INTEREST_5_150)
                .add(EXPECTED_PNL)
                .div(5)
                .mul(-1),
            },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                .add(EXPECTED_ROUND_3_ACC_WITHOUT_FEE)
                .div(10)
                .sub(3), // loss of precision
            },
            longValue: { _value: 0 },
            shortValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                .add(EXPECTED_INTEREST_5_150)
                .add(EXPECTED_ROUND_3_ACC)
                .div(5)
                .mul(-1),
            },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })

          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          await expect(market.connect(liquidator).claimFee())
            .to.emit(market, 'FeeClaimed')
            .withArgs(liquidator.address, EXPECTED_LIQUIDATION_FEE)

          expectLocalEq(await market.locals(liquidator.address), DEFAULT_LOCAL)
        })
      })

      context('invalid oracle version', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        })

        it('settles the position w/o change', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.linearFee = parse6decimal('0.01')
          riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
          riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
          riskParameter.takerFee = riskParameterTakerFee
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_3.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 3,
            latestId: 2,
            protocolFee: 0,
            oracleFee: SETTLEMENT_FEE,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
        })

        it('settles valid version after', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.linearFee = parse6decimal('0.01')
          riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
          riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
          riskParameter.takerFee = riskParameterTakerFee
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const EXPECTED_TAKER_LINEAR = parse6decimal('6.15') // position * (0.01) * price
          const EXPECTED_TAKER_PROPORTIONAL = parse6decimal('1.23') // position * (0.002) * price
          const EXPECTED_TAKER_ADIABATIC = parse6decimal('2.46') // position * (0.004) * price

          const TAKER_FEE = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL).add(EXPECTED_TAKER_ADIABATIC)
          const TAKER_FEE_ONLY = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL)

          const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
          const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_3.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              POSITION.div(2),
              0,
              0,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4 })
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.sub(TAKER_FEE).sub(SETTLEMENT_FEE.mul(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            tradeFee: TAKER_FEE,
            settlementFee: SETTLEMENT_FEE,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(TAKER_FEE_ONLY_WITHOUT_FEE),
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 4,
            latestId: 3,
            protocolFee: TAKER_FEE_ONLY_FEE.div(2),
            oracleFee: TAKER_FEE_ONLY_FEE.div(2).div(10).add(SETTLEMENT_FEE.mul(2)),
            riskFee: TAKER_FEE_ONLY_FEE.div(2).div(10),
            donation: TAKER_FEE_ONLY_FEE.div(2).mul(8).div(10),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: { _value: TAKER_FEE_ONLY_WITHOUT_FEE.div(10) },
            takerLinearFee: { _value: -EXPECTED_TAKER_LINEAR.div(5) },
            takerProportionalFee: { _value: -EXPECTED_TAKER_PROPORTIONAL.div(5) },
            takerPosFee: { _value: -EXPECTED_TAKER_ADIABATIC.div(5) },
            settlementFee: { _value: -SETTLEMENT_FEE },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('settles invalid version after', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.linearFee = parse6decimal('0.01')
          riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
          riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
          riskParameter.takerFee = riskParameterTakerFee
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
          const TAKER_FEE_FEE = TAKER_FEE.div(10)
          const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_3.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              POSITION.div(2),
              0,
              0,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_4, valid: false }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE.mul(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
            settlementFee: SETTLEMENT_FEE,
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 4,
            latestId: 3,
            protocolFee: 0,
            oracleFee: SETTLEMENT_FEE.mul(2),
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
        })

        it('settles invalid then valid version at once', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.linearFee = parse6decimal('0.01')
          riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
          riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
          riskParameter.takerFee = riskParameterTakerFee
          riskParameter.staleAfter = BigNumber.from(9600)
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
          const TAKER_FEE_FEE = TAKER_FEE.div(10)
          const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_3.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          oracle.status.returns([{ ...ORACLE_VERSION_2 }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              POSITION.div(2),
              0,
              0,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4 })
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE), // does not charge fee if both were pending at once
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 4,
            latestId: 3,
            protocolFee: 0,
            oracleFee: SETTLEMENT_FEE,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrder(4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('settles invalid then valid version at once then valid', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.linearFee = parse6decimal('0.01')
          riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
          riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
          riskParameter.takerFee = riskParameterTakerFee
          riskParameter.staleAfter = BigNumber.from(9600)
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const EXPECTED_TAKER_LINEAR = parse6decimal('6.15') // position * (0.01) * price
          const EXPECTED_TAKER_PROPORTIONAL = parse6decimal('1.23') // position * (0.002) * price
          const EXPECTED_TAKER_ADIABATIC = parse6decimal('2.46') // position * (0.004) * price

          const TAKER_FEE = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL).add(EXPECTED_TAKER_ADIABATIC)
          const TAKER_FEE_ONLY = EXPECTED_TAKER_LINEAR.add(EXPECTED_TAKER_PROPORTIONAL)

          const TAKER_FEE_ONLY_FEE = TAKER_FEE_ONLY.div(10)
          const TAKER_FEE_ONLY_WITHOUT_FEE = TAKER_FEE_ONLY.sub(TAKER_FEE_ONLY_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_3.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          oracle.status.returns([{ ...ORACLE_VERSION_2 }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_4.timestamp,
              0,
              POSITION.div(2),
              0,
              0,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4 })
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_5.timestamp,
              0,
              POSITION.div(2),
              0,
              0,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_5.timestamp).returns({ ...ORACLE_VERSION_5 })
          oracle.status.returns([{ ...ORACLE_VERSION_5 }, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 4,
            latestId: 3,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE.mul(2)).sub(TAKER_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
            tradeFee: TAKER_FEE,
            settlementFee: SETTLEMENT_FEE,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectOrderEq(await market.pendingOrders(user.address, 4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(TAKER_FEE_ONLY_WITHOUT_FEE),
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 5,
            latestId: 4,
            protocolFee: TAKER_FEE_ONLY_FEE.div(2),
            oracleFee: TAKER_FEE_ONLY_FEE.div(20).add(SETTLEMENT_FEE.mul(2)),
            riskFee: TAKER_FEE_ONLY_FEE.div(20),
            donation: TAKER_FEE_ONLY_FEE.mul(2).div(5),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrder(4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(5), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: { _value: TAKER_FEE_ONLY_WITHOUT_FEE.div(10) },
            takerLinearFee: { _value: -EXPECTED_TAKER_LINEAR.div(5) },
            takerProportionalFee: { _value: -EXPECTED_TAKER_PROPORTIONAL.div(5) },
            takerPosFee: { _value: -EXPECTED_TAKER_ADIABATIC.div(5) },
            settlementFee: { _value: -SETTLEMENT_FEE },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('settles invalid w/ exposure', async () => {
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 2,
            latestId: 1,
            protocolFee: totalFee.div(2).sub(3), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
            },
            longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
            shortValue: { _value: 0 },
          })
        })
      })

      context('skew flip', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
        })

        it('doesnt flip funding default', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)
          await settle(market, userC)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(16), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userC.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(userC.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(userC.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_1_5_123)
            .add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 3,
            latestId: 2,
            protocolFee: totalFee.div(2).sub(6), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .div(10)
                .sub(1), // loss of precision
            },
            longValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
            },
            shortValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.sub(EXPECTED_INTEREST_5_123).div(5),
            },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('flips funding when makerReceiveOnly', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.makerReceiveOnly = true
          await market.updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)
          await settle(market, userC)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(16), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userC.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(userC.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(userC.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_1_5_123)
            .add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 3,
            latestId: 2,
            protocolFee: totalFee.div(2).sub(6), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .div(10)
                .sub(1), // loss of precision
            },
            longValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
            },
            shortValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
            },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })
      })

      context('operator', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(operator.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('opens the position when operator', async () => {
          factory.operators.whenCalledWith(user.address, operator.address).returns(true)
          await expect(
            market
              .connect(operator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              operator.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              POSITION,
              0,
              0,
              COLLATERAL,
              false,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 0,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('reverts when not operator', async () => {
          factory.operators.whenCalledWith(user.address, operator.address).returns(false)
          await expect(
            market
              .connect(operator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')
        })
      })

      context('magic values', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('withdraws all collateral on MIN', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(8), // loss of precision
          })

          dsu.transfer
            .whenCalledWith(
              user.address,
              COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123).mul(1e12),
            )
            .returns(true)
          dsu.transfer
            .whenCalledWith(
              userB.address,
              COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8)
                .mul(1e12),
            )
            .returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              0,
              ethers.constants.MinInt256,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              0,
              0,
              0,
              ethers.constants.MinInt256,
              false,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: 0,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 2,
            collateral: 0,
          })
        })

        it('keeps same position on MAX', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              ethers.constants.MaxUint256,
              0,
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256,
              0,
              0,
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              ethers.constants.MaxUint256,
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
        })

        it('closes full position on MAX - 1 (unsettled)', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, 0, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION.div(2), 0, false)

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
        })

        it('closes full position on MAX - 1 (settled)', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            makerNeg: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            shortNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, 0, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION.div(2), 0, false)

          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            makerNeg: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            shortNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
        })

        it('closes full position on MAX - 1 (pending)', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = BigNumber.from(14400)
          await market.updateRiskParameter(riskParameter)

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            shortPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
        })

        it('closes partial position on MAX - 1', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = BigNumber.from(14400)
          await market.updateRiskParameter(riskParameter)

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION.mul(2), 0, 0, 0, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              0,
              0,
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            makerNeg: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            shortNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              ethers.constants.MaxUint256.sub(1),
              0,
              false,
            )

          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            makerNeg: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectOrderEq(await market.pendingOrders(userC.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            shortNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
        })
      })

      context('funding skew', async () => {
        // rate_0 = 0
        // rate_1 = rate_0 + (elapsed * skew / k)
        // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        // (0 + (0 + 3600 * 0.333333 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 1053
        const EXPECTED_FUNDING_1_5_123_V = BigNumber.from(1055)
        const EXPECTED_FUNDING_FEE_1_5_123_V = BigNumber.from(105)
        const EXPECTED_FUNDING_WITH_FEE_1_5_123_V = EXPECTED_FUNDING_1_5_123_V.add(55)
        const EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V = EXPECTED_FUNDING_1_5_123_V.sub(50)

        beforeEach(async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.scale = parse6decimal('15')
          riskParameter.takerFee = riskParameterTakerFee
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('long', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('correctly dampens the funding rate increase', async () => {
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123_V).sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123_V.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2),
              oracleFee: totalFee.div(2).div(10),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10).add(2), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10).sub(1), // loss of precision
              },
              longValue: {
                _value: EXPECTED_FUNDING_WITH_FEE_1_5_123_V.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              shortValue: { _value: 0 },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('correctly stores large skew', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            const riskParameterTakerFee = { ...riskParameter.takerFee }
            riskParameterTakerFee.scale = parse6decimal('1')
            riskParameter.takerFee = riskParameterTakerFee
            await market.updateRiskParameter(riskParameter)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
            ).to.not.reverted
          })
        })

        context('short', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('correctly dampens the funding rate decrease', async () => {
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123_V).sub(EXPECTED_INTEREST_5_123).add(5), // excess fundingFee taken from long
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 3,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123_V.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              latestId: 2,
              protocolFee: totalFee.div(2),
              oracleFee: totalFee.div(2).div(10),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10).add(2), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(3), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerValue: {
                _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10).sub(1), // loss of precision
              },
              longValue: { _value: 0 },
              shortValue: {
                _value: EXPECTED_FUNDING_WITH_FEE_1_5_123_V.add(EXPECTED_INTEREST_5_123).div(5).mul(-1).add(1), // loss of precision (fundingFee)
              },
              liquidationFee: { _value: -riskParameter.liquidationFee },
            })
          })

          it('correctly stores large skew', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            const riskParameterTakerFee = { ...riskParameter.takerFee }
            riskParameterTakerFee.scale = parse6decimal('1')
            riskParameter.takerFee = riskParameterTakerFee
            await market.updateRiskParameter(riskParameter)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
            ).to.not.reverted
          })
        })
      })

      context('invalidation', async () => {
        it('multiple invalidations in a row without settlement', async () => {
          const positionMaker = parse6decimal('2.000')
          const collateral = parse6decimal('1000')

          const oracleVersion = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion.timestamp).returns(oracleVersion)
          oracle.status.returns([oracleVersion, oracleVersion.timestamp + 100])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              positionMaker,
              0,
              0,
              collateral,
              false,
            )

          // Increase current version so multiple pending positions are unsettled
          oracle.status.returns([oracleVersion, oracleVersion.timestamp + 200])
          dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              positionMaker,
              0,
              0,
              collateral,
              false,
            )

          // Fulfill oracle version 2 (invalid)
          const oracleVersion2 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 100,
            valid: false,
          }
          oracle.at.whenCalledWith(oracleVersion2.timestamp).returns(oracleVersion2)

          // Fulfill oracle version 3 (invalid)
          const oracleVersion3 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 200,
            valid: false,
          }
          oracle.at.whenCalledWith(oracleVersion3.timestamp).returns(oracleVersion3)

          // next oracle version is valid
          const oracleVersion4 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 300,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion4.timestamp).returns(oracleVersion4)

          // oracleVersion4 commited
          oracle.status.returns([oracleVersion4, oracleVersion4.timestamp + 100])
          oracle.request.returns()

          // settle
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, positionMaker, 0, 0, 0, false),
          ).to.not.be.reverted
        })

        it('global-local desync', async () => {
          const positionMaker = parse6decimal('2.000')
          const positionLong = parse6decimal('1.000')
          const collateral = parse6decimal('1000')

          const oracleVersion = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion.timestamp).returns(oracleVersion)
          oracle.status.returns([oracleVersion, oracleVersion.timestamp + 100])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              positionMaker,
              0,
              0,
              collateral,
              false,
            )

          const oracleVersion2 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 100,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion2.timestamp).returns(oracleVersion2)
          oracle.status.returns([oracleVersion2, oracleVersion2.timestamp + 100])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, positionLong, 0, collateral, false)

          const collateralBefore = (await market.locals(user.address)).collateral
          const collateralBeforeB = (await market.locals(userB.address)).collateral

          // invalid oracle version
          const oracleVersion3 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 200,
            valid: false,
          }
          oracle.at.whenCalledWith(oracleVersion3.timestamp).returns(oracleVersion3)

          // next oracle version is valid
          const oracleVersion4 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 300,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion4.timestamp).returns(oracleVersion4)

          // still returns oracleVersion2, because nothing commited for version 3, and version 4 time has passed but not yet commited
          oracle.status.returns([oracleVersion2, oracleVersion4.timestamp + 100])
          oracle.request.returns()

          // reset to 0
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, positionLong, 0, 0, false)

          // oracleVersion4 commited
          oracle.status.returns([oracleVersion4, oracleVersion4.timestamp + 100])
          oracle.request.returns()

          // settle
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, positionMaker, 0, 0, 0, false)

          const oracleVersion5 = {
            price: parse6decimal('90'),
            timestamp: TIMESTAMP + 400,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion5.timestamp).returns(oracleVersion5)
          oracle.status.returns([oracleVersion5, oracleVersion5.timestamp + 100])
          oracle.request.returns()

          // settle
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, positionMaker, 0, 0, 0, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

          expect((await market.locals(user.address)).collateral).to.equal(collateralBefore)
          expect((await market.locals(userB.address)).collateral).to.equal(collateralBeforeB)
        })
      })

      context('single sided', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('cant switch current before settlement', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketOverCloseError')
        })

        it('cant switch current after latest settles', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')
        })

        it('can switch current after reset settles', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.not.be.reverted
        })
      })

      context('subtractive fee', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('opens the position and settles later with fee (maker)', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxFeeAbsolute: parse6decimal('1000'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
          })

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterMakerFee = { ...riskParameter.makerFee }
          riskParameterMakerFee.linearFee = parse6decimal('0.005')
          riskParameterMakerFee.proportionalFee = parse6decimal('0.0025')
          riskParameterMakerFee.adiabaticFee = parse6decimal('0.01')
          riskParameter.makerFee = riskParameterMakerFee
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const MAKER_FEE_LINEAR = parse6decimal('6.15') // position * (0.005) * price
          const MAKER_FEE_PROPORTIONAL = parse6decimal('3.075') // position * (0.0025) * price
          const MAKER_FEE_ADIABATIC = parse6decimal('-6.15') // position * (0.01 * -(1.00 + 0.00) / 2) * price

          const MAKER_FEE = MAKER_FEE_LINEAR.add(MAKER_FEE_PROPORTIONAL).add(MAKER_FEE_ADIABATIC)
          const MAKER_FEE_WITHOUT_IMPACT = MAKER_FEE_LINEAR.add(MAKER_FEE_PROPORTIONAL)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool,address)'](
                user.address,
                POSITION,
                0,
                0,
                COLLATERAL,
                false,
                liquidator.address,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              POSITION,
              0,
              0,
              COLLATERAL,
              false,
              liquidator.address,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.sub(MAKER_FEE).sub(SETTLEMENT_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            claimable: MAKER_FEE_LINEAR.mul(2).div(10),
          })
          const totalFee = MAKER_FEE_WITHOUT_IMPACT.sub(MAKER_FEE_LINEAR.mul(2).div(10))
          expectGlobalEq(await market.global(), {
            currentId: 2,
            latestId: 1,
            protocolFee: totalFee.div(2),
            oracleFee: totalFee.div(2).div(10).add(SETTLEMENT_FEE),
            riskFee: totalFee.div(2).div(10),
            donation: totalFee.div(2).mul(8).div(10),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })

        it('opens the position and settles later with fee (taker)', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxFeeAbsolute: parse6decimal('1000'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
          })

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterTakerFee = { ...riskParameter.takerFee }
          riskParameterTakerFee.linearFee = parse6decimal('0.01')
          riskParameterTakerFee.proportionalFee = parse6decimal('0.002')
          riskParameterTakerFee.adiabaticFee = parse6decimal('0.008')
          riskParameter.takerFee = riskParameterTakerFee
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(beneficiary.address, coordinator.address, marketParameter)

          const TAKER_FEE_LINEAR = parse6decimal('6.15') // position * (0.01) * price
          const TAKER_FEE_PROPORTIONAL = parse6decimal('1.23') // position * (0.002) * price
          const TAKER_FEE_ADIABATIC = parse6decimal('2.46') // position * (0.004) * price

          const TAKER_FEE = TAKER_FEE_LINEAR.add(TAKER_FEE_PROPORTIONAL).add(TAKER_FEE_ADIABATIC)
          const TAKER_FEE_WITHOUT_IMPACT = TAKER_FEE_LINEAR.add(TAKER_FEE_PROPORTIONAL)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool,address)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
                liquidator.address,
              ),
          )
            .to.emit(market, 'Updated')
            .withArgs(
              user.address,
              user.address,
              ORACLE_VERSION_2.timestamp,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
              liquidator.address,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(TAKER_FEE)
              .sub(SETTLEMENT_FEE.div(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(SETTLEMENT_FEE.div(2))
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            claimable: TAKER_FEE_LINEAR.mul(2).div(10),
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(TAKER_FEE_WITHOUT_IMPACT)
            .sub(TAKER_FEE_LINEAR.mul(2).div(10))
          expectGlobalEq(await market.global(), {
            currentId: 2,
            latestId: 1,
            protocolFee: totalFee.div(2).sub(3), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
            },
            longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
            liquidationFee: { _value: -riskParameter.liquidationFee },
          })
        })
      })
    })

    describe('#claimFee', async () => {
      const FEE = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).sub(5) // loss of precision
      const PROTOCOL_FEE = FEE.div(2)
      const MARKET_FEE = FEE.sub(PROTOCOL_FEE)
      const ORACLE_FEE = MARKET_FEE.div(10)
      const RISK_FEE = MARKET_FEE.div(5)
      const DONATION = MARKET_FEE.sub(ORACLE_FEE).sub(RISK_FEE)

      beforeEach(async () => {
        await market.updateParameter(beneficiary.address, coordinator.address, {
          ...marketParameter,
          riskFee: parse6decimal('0.2'),
          oracleFee: parse6decimal('0.1'),
        })

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)

        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            user.address,
            0,
            POSITION.div(2),
            0,
            COLLATERAL,
            false,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

        oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
        oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)
        await settle(market, userB)
      })

      it('claims fee (protocol)', async () => {
        dsu.transfer.whenCalledWith(owner.address, PROTOCOL_FEE.mul(1e12)).returns(true)

        await expect(market.connect(owner).claimFee())
          .to.emit(market, 'FeeClaimed')
          .withArgs(owner.address, PROTOCOL_FEE)

        expect((await market.global()).protocolFee).to.equal(0)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
        expect((await market.global()).donation).to.equal(DONATION)
      })

      it('claims fee (oracle)', async () => {
        dsu.transfer.whenCalledWith(oracleFactorySigner.address, ORACLE_FEE.mul(1e12)).returns(true)

        await expect(market.connect(oracleFactorySigner).claimFee())
          .to.emit(market, 'FeeClaimed')
          .withArgs(oracleFactorySigner.address, ORACLE_FEE)

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(0)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
        expect((await market.global()).donation).to.equal(DONATION)
      })

      it('claims fee (risk)', async () => {
        dsu.transfer.whenCalledWith(coordinator.address, RISK_FEE.mul(1e12)).returns(true)

        await expect(market.connect(coordinator).claimFee())
          .to.emit(market, 'FeeClaimed')
          .withArgs(coordinator.address, RISK_FEE)

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(0)
        expect((await market.global()).donation).to.equal(DONATION)
      })

      it('claims fee (donation)', async () => {
        dsu.transfer.whenCalledWith(beneficiary.address, DONATION.mul(1e12)).returns(true)

        await expect(market.connect(beneficiary).claimFee())
          .to.emit(market, 'FeeClaimed')
          .withArgs(beneficiary.address, DONATION)

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
        expect((await market.global()).donation).to.equal(0)
      })

      it('claims fee (none)', async () => {
        await market.connect(user).claimFee()

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
        expect((await market.global()).donation).to.equal(DONATION)
      })
    })
  })
})
