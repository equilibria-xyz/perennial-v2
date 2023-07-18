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
  PowerTwo__factory,
} from '../../../types/generated'
import {
  DEFAULT_POSITION,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
  Position,
} from '../../../../common/testutil/types'
import { IMarket, MarketParameterStruct, RiskParameterStruct } from '../../../types/generated/contracts/Market'
import { MilliPowerTwo__factory } from '@equilibria/perennial-v2-payoff/types/generated'

const { ethers } = HRE
use(smock.matchers)

const POSITION = parse6decimal('10.000')
const COLLATERAL = parse6decimal('10000')
const TIMESTAMP = 1636401093
const PRICE = parse6decimal('123')

const DEFAULT_VERSION_ACCUMULATION_RESULT = {
  positionFeeMaker: 0,
  positionFeeFee: 0,
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
  rewardMaker: 0,
  rewardLong: 0,
  rewardShort: 0,
}

const DEFAULT_LOCAL_ACCUMULATION_RESULT = {
  collateralAmount: 0,
  rewardAmount: 0,
  positionFee: 0,
  keeper: 0,
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

const EXPECTED_REWARD = parse6decimal('0.1').mul(3600)

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

async function settle(market: Market, account: SignerWithAddress) {
  const local = await market.locals(account.address)
  const currentPosition = await market.pendingPositions(account.address, local.currentId)
  return await market
    .connect(account)
    .update(account.address, currentPosition.maker, currentPosition.long, currentPosition.short, 0, false)
}

describe('Market', () => {
  let protocolTreasury: SignerWithAddress
  let owner: SignerWithAddress
  let beneficiary: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let liquidator: SignerWithAddress
  let operator: SignerWithAddress
  let coordinator: SignerWithAddress
  let factorySigner: SignerWithAddress
  let oracleFactorySigner: SignerWithAddress
  let factory: FakeContract<IMarketFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>
  let reward: FakeContract<IERC20Metadata>

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
      liquidator,
      operator,
      coordinator,
      oracleFactorySigner,
    ] = await ethers.getSigners()
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    reward = await smock.fake<IERC20Metadata>('IERC20Metadata')

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
    })
    factory.oracleFactory.returns(oracleFactorySigner.address)

    marketDefinition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      oracle: oracle.address,
      payoff: constants.AddressZero,
    }
    riskParameter = {
      maintenance: parse6decimal('0.3'),
      takerFee: 0,
      takerSkewFee: 0,
      takerImpactFee: 0,
      makerFee: 0,
      makerImpactFee: 0,
      makerLimit: parse6decimal('1000'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('0.50'),
      minLiquidationFee: parse6decimal('0'),
      maxLiquidationFee: parse6decimal('1000'),
      utilizationCurve: {
        minRate: parse6decimal('0.0'),
        maxRate: parse6decimal('1.00'),
        targetRate: parse6decimal('0.10'),
        targetUtilization: parse6decimal('0.50'),
      },
      pController: {
        k: parse6decimal('40000'),
        max: parse6decimal('1.20'),
      },
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
      settlementFee: 0,
      makerRewardRate: parse6decimal('0.3'),
      longRewardRate: parse6decimal('0.2'),
      shortRewardRate: parse6decimal('0.1'),
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
    }
    market = await new Market__factory(owner).deploy()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      await expect(market.connect(factorySigner).initialize(marketDefinition, riskParameter)).to.emit(
        market,
        'RiskParameterUpdated',
      )

      expect(await market.factory()).to.equal(factory.address)
      expect(await market.token()).to.equal(dsu.address)
      expect(await market.name()).to.equal(marketDefinition.name)
      expect(await market.symbol()).to.equal(marketDefinition.symbol)
      expect(await market.oracle()).to.equal(marketDefinition.oracle)
      expect(await market.payoff()).to.equal(marketDefinition.payoff)

      const riskParameterResult = await market.riskParameter()
      expect(riskParameterResult.maintenance).to.equal(riskParameter.maintenance)

      expect(riskParameterResult.takerFee).to.equal(riskParameter.takerFee)
      expect(riskParameterResult.takerSkewFee).to.equal(riskParameter.takerSkewFee)
      expect(riskParameterResult.takerImpactFee).to.equal(riskParameter.takerImpactFee)
      expect(riskParameterResult.makerFee).to.equal(riskParameter.makerFee)
      expect(riskParameterResult.makerImpactFee).to.equal(riskParameter.makerImpactFee)
      expect(riskParameterResult.makerLimit).to.equal(riskParameter.makerLimit)
      expect(riskParameterResult.efficiencyLimit).to.equal(riskParameter.efficiencyLimit)
      expect(riskParameterResult.liquidationFee).to.equal(riskParameter.liquidationFee)
      expect(riskParameterResult.minLiquidationFee).to.equal(riskParameter.minLiquidationFee)
      expect(riskParameterResult.maxLiquidationFee).to.equal(riskParameter.maxLiquidationFee)
      expect(riskParameterResult.utilizationCurve.minRate).to.equal(riskParameter.utilizationCurve.minRate)
      expect(riskParameterResult.utilizationCurve.targetRate).to.equal(riskParameter.utilizationCurve.targetRate)
      expect(riskParameterResult.utilizationCurve.maxRate).to.equal(riskParameter.utilizationCurve.maxRate)
      expect(riskParameterResult.utilizationCurve.targetUtilization).to.equal(
        riskParameter.utilizationCurve.targetUtilization,
      )
      expect(riskParameterResult.pController.k).to.equal(riskParameter.pController.k)
      expect(riskParameterResult.pController.max).to.equal(riskParameter.pController.max)
      expect(riskParameterResult.minMaintenance).to.equal(riskParameter.minMaintenance)
      expect(riskParameterResult.staleAfter).to.equal(riskParameter.staleAfter)
      expect(riskParameterResult.makerReceiveOnly).to.equal(riskParameter.makerReceiveOnly)

      const marketParameterResult = await market.parameter()
      expect(marketParameterResult.fundingFee).to.equal(0)
      expect(marketParameterResult.interestFee).to.equal(0)
      expect(marketParameterResult.positionFee).to.equal(0)
      expect(marketParameterResult.oracleFee).to.equal(0)
      expect(marketParameterResult.riskFee).to.equal(0)
      expect(marketParameterResult.settlementFee).to.equal(0)
      expect(marketParameterResult.makerRewardRate).to.equal(0)
      expect(marketParameterResult.longRewardRate).to.equal(0)
      expect(marketParameterResult.shortRewardRate).to.equal(0)
      expect(marketParameterResult.closed).to.equal(false)
    })

    it('reverts if already initialized', async () => {
      await market.initialize(marketDefinition, riskParameter)
      await expect(market.initialize(marketDefinition, riskParameter))
        .to.be.revertedWithCustomError(market, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#at', async () => {
    beforeEach(async () => {
      oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)
      oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
      oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
      oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
    })

    it('returns the correct price without payoff', async () => {
      await market.connect(factorySigner).initialize(marketDefinition, riskParameter)
      await market.connect(owner).updateReward(reward.address)
      await market.connect(owner).updateParameter(marketParameter)

      const at0 = await market.at(ORACLE_VERSION_0.timestamp)
      expect(at0.timestamp).to.equal(ORACLE_VERSION_0.timestamp)
      expect(at0.price).to.equal(ORACLE_VERSION_0.price)
      expect(at0.valid).to.equal(ORACLE_VERSION_0.valid)
      const at1 = await market.at(ORACLE_VERSION_1.timestamp)
      expect(at1.timestamp).to.equal(ORACLE_VERSION_1.timestamp)
      expect(at1.price).to.equal(ORACLE_VERSION_1.price)
      expect(at1.valid).to.equal(ORACLE_VERSION_1.valid)
      const at2 = await market.at(ORACLE_VERSION_2.timestamp)
      expect(at2.timestamp).to.equal(ORACLE_VERSION_2.timestamp)
      expect(at2.price).to.equal(ORACLE_VERSION_2.price)
      expect(at2.valid).to.equal(ORACLE_VERSION_2.valid)
      const at3 = await market.at(ORACLE_VERSION_3.timestamp)
      expect(at3.timestamp).to.equal(ORACLE_VERSION_3.timestamp)
      expect(at3.price).to.equal(ORACLE_VERSION_3.price)
      expect(at3.valid).to.equal(ORACLE_VERSION_3.valid)
    })

    it('returns the correct price without payoff', async () => {
      const payoff = await new PowerTwo__factory(owner).deploy()
      marketDefinition.payoff = payoff.address

      await market.connect(factorySigner).initialize(marketDefinition, riskParameter)
      await market.connect(owner).updateReward(reward.address)
      await market.connect(owner).updateParameter(marketParameter)

      const at0 = await market.at(ORACLE_VERSION_0.timestamp)
      expect(at0.timestamp).to.equal(ORACLE_VERSION_0.timestamp)
      expect(at0.price).to.equal(ORACLE_VERSION_0.price.pow(2).div(1e6))
      expect(at0.valid).to.equal(ORACLE_VERSION_0.valid)
      const at1 = await market.at(ORACLE_VERSION_1.timestamp)
      expect(at1.timestamp).to.equal(ORACLE_VERSION_1.timestamp)
      expect(at1.price).to.equal(ORACLE_VERSION_1.price.pow(2).div(1e6))
      expect(at1.valid).to.equal(ORACLE_VERSION_1.valid)
      const at2 = await market.at(ORACLE_VERSION_2.timestamp)
      expect(at2.timestamp).to.equal(ORACLE_VERSION_2.timestamp)
      expect(at2.price).to.equal(ORACLE_VERSION_2.price.pow(2).div(1e6))
      expect(at2.valid).to.equal(ORACLE_VERSION_2.valid)
      const at3 = await market.at(ORACLE_VERSION_3.timestamp)
      expect(at3.timestamp).to.equal(ORACLE_VERSION_3.timestamp)
      expect(at3.price).to.equal(ORACLE_VERSION_3.price.pow(2).div(1e6))
      expect(at3.valid).to.equal(ORACLE_VERSION_3.valid)
    })
  })

  context('already initialized', async () => {
    beforeEach(async () => {
      await market.connect(factorySigner).initialize(marketDefinition, riskParameter)
    })

    describe('#updateReward', async () => {
      it('updates the reward', async () => {
        await expect(market.connect(owner).updateReward(reward.address))
          .to.emit(market, 'RewardUpdated')
          .withArgs(reward.address)
        expect(await market.reward()).to.equal(reward.address)
      })

      it('reverts if already set', async () => {
        await market.connect(owner).updateReward(reward.address)
        await expect(market.connect(owner).updateReward(dsu.address)).to.be.revertedWithCustomError(
          market,
          'MarketRewardAlreadySetError',
        )
      })

      it('reverts if equal to asset', async () => {
        await expect(market.connect(owner).updateReward(dsu.address)).to.be.revertedWithCustomError(
          market,
          'MarketInvalidRewardError',
        )
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateReward(reward.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateCoordinator', async () => {
      it('updates the coordinator', async () => {
        await expect(market.connect(owner).updateCoordinator(coordinator.address))
          .to.emit(market, 'CoordinatorUpdated')
          .withArgs(coordinator.address)
        expect(await market.coordinator()).to.equal(coordinator.address)
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateCoordinator(coordinator.address)).to.be.revertedWithCustomError(
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
        settlementFee: parse6decimal('0.09'),
        makerRewardRate: parse6decimal('0.06'),
        longRewardRate: parse6decimal('0.07'),
        shortRewardRate: parse6decimal('0.08'),
        makerCloseAlways: true,
        takerCloseAlways: true,
        closed: true,
      }

      it('updates the parameters', async () => {
        await market.connect(owner).updateReward(reward.address)

        await expect(market.connect(owner).updateParameter(defaultMarketParameter))
          .to.emit(market, 'ParameterUpdated')
          .withArgs(defaultMarketParameter)

        const marketParameter = await market.parameter()
        expect(marketParameter.fundingFee).to.equal(defaultMarketParameter.fundingFee)
        expect(marketParameter.interestFee).to.equal(defaultMarketParameter.interestFee)
        expect(marketParameter.positionFee).to.equal(defaultMarketParameter.positionFee)
        expect(marketParameter.oracleFee).to.equal(defaultMarketParameter.oracleFee)
        expect(marketParameter.riskFee).to.equal(defaultMarketParameter.riskFee)
        expect(marketParameter.settlementFee).to.equal(defaultMarketParameter.settlementFee)
        expect(marketParameter.makerRewardRate).to.equal(defaultMarketParameter.makerRewardRate)
        expect(marketParameter.longRewardRate).to.equal(defaultMarketParameter.longRewardRate)
        expect(marketParameter.shortRewardRate).to.equal(defaultMarketParameter.shortRewardRate)
        expect(marketParameter.closed).to.equal(defaultMarketParameter.closed)
      })

      context('updates the absolute fee parameters', async () => {
        beforeEach(async () => {
          await market.connect(owner).updateReward(reward.address)
        })

        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newMarketParameter = {
            ...defaultMarketParameter,
            settlementFee: protocolParameter.maxFeeAbsolute,
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter)).to.emit(market, 'ParameterUpdated')
        })

        it('settlementFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newMarketParameter = {
            ...defaultMarketParameter,
            settlementFee: protocolParameter.maxFeeAbsolute.add(1),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(4)
        })
      })

      context('updates the cut parameters', async () => {
        beforeEach(async () => {
          await market.connect(owner).updateReward(reward.address)
        })

        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newMarketParameter = {
            ...defaultMarketParameter,
            fundingFee: protocolParameter.maxCut,
            interestFee: protocolParameter.maxCut,
            positionFee: protocolParameter.maxCut,
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter)).to.emit(market, 'ParameterUpdated')
        })

        it('fundingFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newMarketParameter = {
            ...defaultMarketParameter,
            fundingFee: protocolParameter.maxCut.add(1),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(1)
        })

        it('interestFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newMarketParameter = {
            ...defaultMarketParameter,
            interestFee: protocolParameter.maxCut.add(1),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(2)
        })

        it('positionFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newMarketParameter = {
            ...defaultMarketParameter,
            positionFee: protocolParameter.maxCut.add(1),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(3)
        })
      })

      context('updates the oracleFee / riskFee parameters', async () => {
        beforeEach(async () => {
          await market.connect(owner).updateReward(reward.address)
        })

        it('updates the parameters (success)', async () => {
          const newMarketParameter = {
            ...defaultMarketParameter,
            oracleFee: parse6decimal('0.5'),
            riskFee: parse6decimal('0.5'),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter)).to.emit(market, 'ParameterUpdated')
        })

        it('oracleFee / riskFee -> fail', async () => {
          const newMarketParameter = {
            ...defaultMarketParameter,
            oracleFee: parse6decimal('0.5'),
            riskFee: parse6decimal('0.5').add(1),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(5)
        })
      })

      context('updates the reward parameters', async () => {
        it('updates the parameters (success)', async () => {
          await market.updateReward(reward.address)

          const newMarketParameter = {
            ...defaultMarketParameter,
            makerRewardRate: parse6decimal('0.1'),
            longRewardRate: parse6decimal('0.2'),
            shortRewardRate: parse6decimal('0.3'),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter)).to.emit(market, 'ParameterUpdated')
        })

        it('makerRewardRate -> fail', async () => {
          const newMarketParameter = {
            ...defaultMarketParameter,
            makerRewardRate: parse6decimal('0.1'),
            longRewardRate: parse6decimal('0.0'),
            shortRewardRate: parse6decimal('0.0'),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(6)
        })

        it('longRewardRate -> fail', async () => {
          const newMarketParameter = {
            ...defaultMarketParameter,
            makerRewardRate: parse6decimal('0.0'),
            longRewardRate: parse6decimal('0.2'),
            shortRewardRate: parse6decimal('0.0'),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(6)
        })

        it('shortRewardRate -> fail', async () => {
          const newMarketParameter = {
            ...defaultMarketParameter,
            makerRewardRate: parse6decimal('0.0'),
            longRewardRate: parse6decimal('0.0'),
            shortRewardRate: parse6decimal('0.3'),
          }
          await expect(market.connect(owner).updateParameter(newMarketParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidMarketParameterError')
            .withArgs(6)
        })
      })

      it('reverts if not owner (user)', async () => {
        await expect(market.connect(user).updateParameter(marketParameter)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })

      it('reverts if not owner (coordinator)', async () => {
        await market.connect(owner).updateCoordinator(coordinator.address)
        await expect(market.connect(coordinator).updateParameter(marketParameter)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateRiskParameter', async () => {
      const defaultRiskParameter = {
        maintenance: parse6decimal('0.4'),
        takerFee: parse6decimal('0.01'),
        takerSkewFee: parse6decimal('0.004'),
        takerImpactFee: parse6decimal('0.003'),
        makerFee: parse6decimal('0.005'),
        makerImpactFee: parse6decimal('0.001'),
        makerLimit: parse6decimal('2000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.25'),
        minLiquidationFee: parse6decimal('10'),
        maxLiquidationFee: parse6decimal('200'),
        utilizationCurve: {
          minRate: parse6decimal('0.20'),
          maxRate: parse6decimal('0.20'),
          targetRate: parse6decimal('0.20'),
          targetUtilization: parse6decimal('0.75'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
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
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.takerFee).to.equal(defaultRiskParameter.takerFee)
        expect(riskParameter.takerSkewFee).to.equal(defaultRiskParameter.takerSkewFee)
        expect(riskParameter.takerImpactFee).to.equal(defaultRiskParameter.takerImpactFee)
        expect(riskParameter.makerFee).to.equal(defaultRiskParameter.makerFee)
        expect(riskParameter.makerImpactFee).to.equal(defaultRiskParameter.makerImpactFee)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.minLiquidationFee).to.equal(defaultRiskParameter.minLiquidationFee)
        expect(riskParameter.maxLiquidationFee).to.equal(defaultRiskParameter.maxLiquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      it('updates the parameters (coordinator)', async () => {
        await market.connect(owner).updateCoordinator(coordinator.address)
        await expect(market.connect(coordinator).updateRiskParameter(defaultRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        const riskParameter = await market.riskParameter()
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.takerFee).to.equal(defaultRiskParameter.takerFee)
        expect(riskParameter.takerSkewFee).to.equal(defaultRiskParameter.takerSkewFee)
        expect(riskParameter.takerImpactFee).to.equal(defaultRiskParameter.takerImpactFee)
        expect(riskParameter.makerFee).to.equal(defaultRiskParameter.makerFee)
        expect(riskParameter.makerImpactFee).to.equal(defaultRiskParameter.makerImpactFee)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.minLiquidationFee).to.equal(defaultRiskParameter.minLiquidationFee)
        expect(riskParameter.maxLiquidationFee).to.equal(defaultRiskParameter.maxLiquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      context('updates the fee parameters', async () => {
        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            takerFee: protocolParameter.maxFee,
            takerSkewFee: protocolParameter.maxFee,
            takerImpactFee: protocolParameter.maxFee,
            makerFee: protocolParameter.maxFee,
            makerImpactFee: protocolParameter.maxFee,
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('takerFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            takerFee: protocolParameter.maxFee.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(2)
        })

        it('takerSkewFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            takerSkewFee: protocolParameter.maxFee.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(3)
        })

        it('takerImpactFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            takerImpactFee: protocolParameter.maxFee.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(4)
        })

        it('makerFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            makerFee: protocolParameter.maxFee.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(5)
        })

        it('makerImpactFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            makerImpactFee: protocolParameter.maxFee.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(6)
        })
      })

      context('updates the absolute fee parameters', async () => {
        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            minLiquidationFee: protocolParameter.maxFeeAbsolute,
            maxLiquidationFee: protocolParameter.maxFeeAbsolute,
            minMaintenance: protocolParameter.maxFeeAbsolute,
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('minLiquidationFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            minLiquidationFee: protocolParameter.maxFeeAbsolute.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(9)
        })

        it('maxLiquidationFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            maxLiquidationFee: protocolParameter.maxFeeAbsolute.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(10)
        })

        it('minMaintenance -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            minMaintenance: protocolParameter.maxFeeAbsolute.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(16)
        })
      })

      context('updates the cut parameters', async () => {
        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            liquidationFee: protocolParameter.maxCut,
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('liquidationFee -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            liquidationFee: protocolParameter.maxCut.add(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(8)
        })
      })

      context('updates the rate parameters', async () => {
        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            utilizationCurve: {
              ...defaultRiskParameter.utilizationCurve,
              minRate: protocolParameter.maxRate,
              maxRate: protocolParameter.maxRate,
              targetRate: protocolParameter.maxRate,
            },
            pController: {
              ...defaultRiskParameter.pController,
              max: protocolParameter.maxRate,
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('utilizationCurve.minRate -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            utilizationCurve: {
              ...defaultRiskParameter.utilizationCurve,
              minRate: protocolParameter.maxRate.add(1),
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(11)
        })

        it('utilizationCurve.maxRate -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            utilizationCurve: {
              ...defaultRiskParameter.utilizationCurve,
              maxRate: protocolParameter.maxRate.add(1),
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(12)
        })

        it('utilizationCurve.targetRate -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            utilizationCurve: {
              ...defaultRiskParameter.utilizationCurve,
              targetRate: protocolParameter.maxRate.add(1),
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(13)
        })

        it('pController.max -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            pController: {
              ...defaultRiskParameter.pController,
              max: protocolParameter.maxRate.add(1),
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(15)
        })
      })

      context('updates the maintenance parameters', async () => {
        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            maintenance: protocolParameter.minMaintenance,
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('maintenance -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            maintenance: protocolParameter.minMaintenance.sub(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(1)
        })
      })

      context('updates the efficiency parameters', async () => {
        it('updates the parameters (success)', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            efficiencyLimit: protocolParameter.minEfficiency,
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('efficiencyLimit -> fail', async () => {
          const protocolParameter = await factory.parameter()
          const newRiskParameter = {
            ...defaultRiskParameter,
            efficiencyLimit: protocolParameter.minEfficiency.sub(1),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(7)
        })
      })

      context('updates the unit parameters', async () => {
        it('updates the parameters (success)', async () => {
          const newRiskParameter = {
            ...defaultRiskParameter,
            utilizationCurve: {
              ...defaultRiskParameter.utilizationCurve,
              targetUtilization: parse6decimal('1'),
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('utilizationCurve.targetUtilization -> fail', async () => {
          const newRiskParameter = {
            ...defaultRiskParameter,
            utilizationCurve: {
              ...defaultRiskParameter.utilizationCurve,
              targetUtilization: parse6decimal('1').add(1),
            },
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(14)
        })
      })

      context('updates the minMaintenance / minLiquidationFee parameters', async () => {
        it('updates the parameters (success)', async () => {
          const newRiskParameter = {
            ...defaultRiskParameter,
            minMaintenance: parse6decimal('100'),
            minLiquidationFee: parse6decimal('100'),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
            market,
            'RiskParameterUpdated',
          )

          const newRiskParameter2 = {
            ...defaultRiskParameter,
            minMaintenance: parse6decimal('101'),
            minLiquidationFee: parse6decimal('100'),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter2)).to.emit(
            market,
            'RiskParameterUpdated',
          )
        })

        it('minMaintenance / minLiquidationFee -> fail', async () => {
          const newRiskParameter = {
            ...defaultRiskParameter,
            minMaintenance: parse6decimal('99'),
            minLiquidationFee: parse6decimal('100'),
          }
          await expect(market.connect(owner).updateRiskParameter(newRiskParameter))
            .to.revertedWithCustomError(market, 'MarketInvalidRiskParameterError')
            .withArgs(16)
        })
      })

      it('reverts if not owner or coordinator', async () => {
        await expect(market.connect(user).updateRiskParameter(defaultRiskParameter)).to.be.revertedWithCustomError(
          market,
          'MarketNotCoordinatorError',
        )
      })
    })

    describe('#updateBeneficiary', async () => {
      it('updates the beneficiary', async () => {
        await expect(market.connect(owner).updateBeneficiary(beneficiary.address))
          .to.emit(market, 'BeneficiaryUpdated')
          .withArgs(beneficiary.address)
        expect(await market.beneficiary()).to.equal(beneficiary.address)
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateBeneficiary(beneficiary.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#update', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateReward(reward.address)
        await market.connect(owner).updateParameter(marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.returns()
      })

      context('no position', async () => {
        it('deposits and withdraws (immediately)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, 0, COLLATERAL, false)

          expectLocalEq(await market.locals(user.address), {
            currentId: 1,
            collateral: COLLATERAL,
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPosition(1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL.mul(-1), false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, 0, COLLATERAL.mul(-1), false)

          expectLocalEq(await market.locals(user.address), {
            currentId: 1,
            collateral: 0,
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPosition(1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })

        it('deposits and withdraws (next)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, 0, COLLATERAL, false)

          expectLocalEq(await market.locals(user.address), {
            currentId: 1,
            collateral: COLLATERAL,
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 0,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPosition(1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL.mul(-1), false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, COLLATERAL.mul(-1), false)

          expectLocalEq(await market.locals(user.address), {
            currentId: 2,
            collateral: 0,
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectGlobalEq(await market.global(), {
            currentId: 2,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectPositionEq(await market.pendingPosition(2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })
      })

      context('make position', async () => {
        context('open', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          it('opens the position', async () => {
            await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION, 0, 0, COLLATERAL, false)

            expectLocalEq(await market.locals(user.address), {
              currentId: 1,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPosition(1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens the position and settles', async () => {
            await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
              .to.emit(market, 'PositionProcessed')
              .withArgs(0, ORACLE_VERSION_1.timestamp, 0, DEFAULT_VERSION_ACCUMULATION_RESULT)
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(user.address, 0, ORACLE_VERSION_1.timestamp, 0, DEFAULT_LOCAL_ACCUMULATION_RESULT)
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await expect(await settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(ORACLE_VERSION_1.timestamp, ORACLE_VERSION_2.timestamp, 0, DEFAULT_VERSION_ACCUMULATION_RESULT)
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                ORACLE_VERSION_1.timestamp,
                ORACLE_VERSION_2.timestamp,
                0,
                DEFAULT_LOCAL_ACCUMULATION_RESULT,
              )

            expectLocalEq(await market.locals(user.address), {
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens a second position (same version)', async () => {
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

            await expect(market.connect(user).update(user.address, POSITION.mul(2), 0, 0, 0, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION.mul(2), 0, 0, 0, false)

            expectLocalEq(await market.locals(user.address), {
              currentId: 1,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPosition(1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens a second position and settles (same version)', async () => {
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

            await expect(market.connect(user).update(user.address, POSITION.mul(2), 0, 0, 0, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION.mul(2), 0, 0, 0, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens a second position (next version)', async () => {
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await expect(market.connect(user).update(user.address, POSITION.mul(2), 0, 0, 0, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_3.timestamp, POSITION.mul(2), 0, 0, 0, false)

            expectLocalEq(await market.locals(user.address), {
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens a second position and settles (next version)', async () => {
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await expect(market.connect(user).update(user.address, POSITION.mul(2), 0, 0, 0, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_3.timestamp, POSITION.mul(2), 0, 0, 0, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL,
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION.mul(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens the position and settles later', async () => {
            await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              currentId: 2,
              collateral: COLLATERAL,
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('opens the position and settles later with fee', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            riskParameter.makerFee = parse6decimal('0.005')
            riskParameter.makerImpactFee = parse6decimal('0.0025')
            await market.updateRiskParameter(riskParameter)

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.settlementFee = parse6decimal('0.50')
            await market.updateParameter(marketParameter)

            const MAKER_FEE = parse6decimal('6.15') // position * (0.005) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              currentId: 2,
              collateral: COLLATERAL.sub(MAKER_FEE).sub(SETTLEMENT_FEE),
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: MAKER_FEE.div(2),
              oracleFee: MAKER_FEE.div(2).div(10).add(SETTLEMENT_FEE),
              riskFee: MAKER_FEE.div(2).div(10),
              donation: MAKER_FEE.div(2).mul(8).div(10),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })
        })

        context('close', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
          })

          it('closes the position', async () => {
            await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, 0, 0, false)

            expectLocalEq(await market.locals(user.address), {
              currentId: 1,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPosition(1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          it('closes the position partially', async () => {
            await expect(market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false))
              .to.emit(market, 'Updated')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION.div(2), 0, 0, 0, false)

            expectLocalEq(await market.locals(user.address), {
              currentId: 1,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectPositionEq(await market.pendingPosition(1), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })

          context('settles first', async () => {
            beforeEach(async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
            })

            it('closes the position', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes the position and settles', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL,
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes a second position (same version)', async () => {
              await market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false)

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes a second position and settles (same version)', async () => {
              await market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false)

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL,
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes a second position (next version)', async () => {
              await market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL,
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes a second position and settles (next version)', async () => {
              await market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 4,
                collateral: COLLATERAL,
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 4), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 4,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPosition(4), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).add(EXPECTED_REWARD.mul(3).div(5)) },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes the position and settles later', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL,
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.makerFee = parse6decimal('0.005')
              riskParameter.makerImpactFee = parse6decimal('0.0025')
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(marketParameter)

              const MAKER_FEE = parse6decimal('6.15') // position * (0.005) * price
              const MAKER_FEE_FEE = MAKER_FEE.div(10)
              const MAKER_FEE_WITHOUT_FEE = MAKER_FEE.sub(MAKER_FEE_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(MAKER_FEE).add(MAKER_FEE_WITHOUT_FEE).sub(SETTLEMENT_FEE),
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: MAKER_FEE_FEE.div(2),
                oracleFee: MAKER_FEE_FEE.div(2).div(10).add(SETTLEMENT_FEE),
                riskFee: MAKER_FEE_FEE.div(2).div(10),
                donation: MAKER_FEE_FEE.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                makerValue: { _value: MAKER_FEE_WITHOUT_FEE.div(10) },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
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
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
            })

            it('opens the position', async () => {
              await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION, 0, COLLATERAL, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles', async () => {
              await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION, 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (same version)', async () => {
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

              await expect(market.connect(user).update(user.address, 0, POSITION, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

              await expect(market.connect(user).update(user.address, 0, POSITION, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (next version)', async () => {
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(market.connect(user).update(user.address, 0, POSITION, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(market.connect(user).update(user.address, 0, POSITION, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION, 0, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                long: POSITION,
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles later', async () => {
              await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                long: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.takerFee = parse6decimal('0.01')
              riskParameter.takerImpactFee = parse6decimal('0.004')
              riskParameter.takerSkewFee = parse6decimal('0.002')
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                long: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.takerFee = parse6decimal('0.01')
              riskParameter.takerImpactFee = parse6decimal('0.004')
              riskParameter.takerSkewFee = parse6decimal('0.002')
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
              const TAKER_FEE_FEE = TAKER_FEE.div(10)
              const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: 0,
                long: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(TAKER_FEE_WITHOUT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_FEE)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                makerValue: {
                  _value: TAKER_FEE_WITHOUT_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10),
                },
                longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
            })

            it('closes the position partially', async () => {
              await expect(market.connect(user).update(user.address, 0, POSITION.div(4), 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, POSITION.div(4), 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION.div(4),
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(4),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes the position', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 2,
                  collateral: COLLATERAL,
                  reward: 0,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  delta: COLLATERAL,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPosition(2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes the position and settles', async () => {
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position (same version)', async () => {
                await market.connect(user).update(user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 2,
                  collateral: COLLATERAL,
                  reward: 0,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  delta: COLLATERAL,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPosition(2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market.connect(user).update(user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position (next version)', async () => {
                await market.connect(user).update(user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, 0, false)

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  long: POSITION.div(4),
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(4),
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position and settles (next version)', async () => {
                await market.connect(user).update(user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 4,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_FUNDING_WITH_FEE_2_25_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_INTEREST_25_123),
                  reward: EXPECTED_REWARD.mul(2).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 4), {
                  ...DEFAULT_POSITION,
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                    .sub(13), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                  .add(EXPECTED_INTEREST_FEE_5_123)
                  .add(EXPECTED_INTEREST_FEE_25_123)
                expectGlobalEq(await market.global(), {
                  currentId: 4,
                  protocolFee: totalFee.div(2).sub(1), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(4), {
                  ...DEFAULT_POSITION,
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                  shortReward: { _value: 0 },
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5).add(EXPECTED_REWARD.mul(2).mul(2).div(5)) },
                  shortReward: { _value: 0 },
                })
              })

              it('closes the position and settles later', async () => {
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                  shortReward: { _value: 0 },
                })
              })

              it('closes the position and settles later with fee', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                riskParameter.takerFee = parse6decimal('0.01')
                riskParameter.takerImpactFee = parse6decimal('0.004')
                riskParameter.takerSkewFee = parse6decimal('0.002')
                await market.updateRiskParameter(riskParameter)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.settlementFee = parse6decimal('0.50')
                await market.updateParameter(marketParameter)

                const TAKER_FEE = parse6decimal('4.92') // position * (0.01 - 0.004 + 0.002) * price
                const TAKER_FEE_FEE = TAKER_FEE.div(10)
                const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
                const SETTLEMENT_FEE = parse6decimal('0.50')

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(TAKER_FEE)
                    .sub(SETTLEMENT_FEE),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(TAKER_FEE_WITHOUT_FEE)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_FEE)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(TAKER_FEE_WITHOUT_FEE)
                      .div(10),
                  },
                  longValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  shortValue: { _value: 0 },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                  longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                  shortReward: { _value: 0 },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

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
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
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
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(ORACLE_VERSION_2.timestamp, oracleVersionLowerPrice.timestamp, 1, {
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
                rewardMaker: EXPECTED_REWARD.mul(3),
                rewardLong: EXPECTED_REWARD.mul(2),
              })
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, oracleVersionLowerPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.mul(-1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                rewardAmount: EXPECTED_REWARD.mul(2),
              })

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(userB.address, ORACLE_VERSION_2.timestamp, oracleVersionLowerPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8),
                rewardAmount: EXPECTED_REWARD.mul(3),
              })

            expectLocalEq(await market.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
              reward: EXPECTED_REWARD.mul(2),
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10),
              },
              longValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              shortValue: { _value: 0 },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
              shortReward: { _value: 0 },
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
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(ORACLE_VERSION_2.timestamp, oracleVersionHigherPrice.timestamp, 1, {
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
                rewardMaker: EXPECTED_REWARD.mul(3),
                rewardLong: EXPECTED_REWARD.mul(2),
              })
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, oracleVersionHigherPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.mul(-1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                rewardAmount: EXPECTED_REWARD.mul(2),
              })

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(userB.address, ORACLE_VERSION_2.timestamp, oracleVersionHigherPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8),
                rewardAmount: EXPECTED_REWARD.mul(3),
              })

            expectLocalEq(await market.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
              reward: EXPECTED_REWARD.mul(2),
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10)
                  .sub(1),
              }, // loss of precision
              longValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              shortValue: { _value: 0 },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
              shortReward: { _value: 0 },
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, parse6decimal('450'), false)
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
            })

            it('with socialization to zero', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('45')

              const oracleVersionHigherPrice = {
                price: parse6decimal('150'),
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
                market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 5,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_5_150)
                  .sub(5), // loss of precision
                reward: EXPECTED_REWARD.mul(2).mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                long: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 5,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(22), // loss of precision
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                delta: parse6decimal('450').sub(EXPECTED_LIQUIDATION_FEE),
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                protocolFee: totalFee.div(2).sub(1), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(4), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                long: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(2) },
                shortReward: { _value: 0 },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(3) },
                shortReward: { _value: 0 },
              })
            })

            it('with partial socialization', async () => {
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userC).update(userC.address, POSITION.div(4), 0, 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('45')

              const oracleVersionHigherPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userC)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

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
              oracle.request.returns()

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
                currentId: 5,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_2)
                  .sub(EXPECTED_FUNDING_WITH_FEE_3_25_123)
                  .sub(EXPECTED_INTEREST_3)
                  .add(EXPECTED_PNL)
                  .sub(5), // loss of precision
                reward: EXPECTED_REWARD.mul(2).mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                long: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 5,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).mul(4).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2).mul(4).div(5))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(16), // loss of precision
                reward: EXPECTED_REWARD.mul(4).div(5).mul(3).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                delta: parse6decimal('450').sub(EXPECTED_LIQUIDATION_FEE),
              })
              expectLocalEq(await market.locals(userC.address), {
                currentId: 5,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).div(5),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3))
                  .sub(EXPECTED_PNL)
                  .sub(12), // loss of precision
                reward: EXPECTED_REWARD.div(5).mul(3).mul(2).add(EXPECTED_REWARD.mul(3)),
                protection: 0,
              })
              expectPositionEq(await market.positions(userC.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
              })
              expectPositionEq(await market.pendingPositions(userC.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION.div(4),
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_5_150.add(EXPECTED_INTEREST_FEE_2))
                .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
              expectGlobalEq(await market.global(), {
                currentId: 5,
                protocolFee: totalFee.div(2).sub(2), // loss of precision
                oracleFee: totalFee.div(2).div(10),
                riskFee: totalFee.div(2).div(10),
                donation: totalFee.div(2).mul(8).div(10).add(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION.div(4),
                long: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(25) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(25).mul(2) },
                longReward: { _value: EXPECTED_REWARD.mul(2).mul(2).div(5) },
                shortReward: { _value: 0 },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
                shortValue: { _value: 0 },
                makerReward: {
                  _value: EXPECTED_REWARD.mul(3).mul(2).div(25).mul(2).add(EXPECTED_REWARD.mul(3).mul(2).div(5)),
                },
                longReward: { _value: EXPECTED_REWARD.mul(2).mul(3).div(5) },
                shortReward: { _value: 0 },
              })
            })

            it('with shortfall', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('60.9')

              const oracleVersionHigherPrice = {
                price: parse6decimal('203'),
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
                market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .add(EXPECTED_PNL),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                long: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 3,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(EXPECTED_PNL)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: parse6decimal('450').sub(EXPECTED_LIQUIDATION_FEE),
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                long: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

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
              await expect(market.connect(liquidator).update(userB.address, 0, 0, 0, shortfall.mul(-1), false))
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_5.timestamp, 0, 0, 0, shortfall.mul(-1), false)

              expectLocalEq(await market.locals(userB.address), {
                currentId: 4,
                collateral: 0,
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 4), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: parse6decimal('450').sub(EXPECTED_LIQUIDATION_FEE).add(shortfall.mul(-1)),
              })
            })
          })

          context('long', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('195')).returns(true)
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, parse6decimal('195'), false)
            })

            it('default', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('14.4')

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
                market.connect(liquidator).update(user.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

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

              expectLocalEq(await market.locals(user.address), {
                currentId: 5,
                collateral: parse6decimal('195')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                  .sub(EXPECTED_LIQUIDATION_FEE),
                reward: EXPECTED_REWARD.mul(2).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE),
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 5,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                  .sub(20), // loss of precision
                reward: EXPECTED_REWARD.mul(3).mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
                EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
              )
              expectGlobalEq(await market.global(), {
                currentId: 5,
                protocolFee: totalFee.div(2).sub(4), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPosition(5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(2) },
                shortReward: { _value: 0 },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(3) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(2) },
                shortReward: { _value: 0 },
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
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('6.45')

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
                market.connect(liquidator).update(user.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: parse6decimal('195')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                  .sub(EXPECTED_PNL)
                  .sub(EXPECTED_LIQUIDATION_FEE),
                reward: EXPECTED_REWARD.mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE),
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 3,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                )
                  .add(EXPECTED_PNL)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              const shortfall = parse6decimal('195')
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                .sub(EXPECTED_FUNDING_WITH_FEE_2_5_43.add(EXPECTED_INTEREST_5_43))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              factory.operators.whenCalledWith(user.address, liquidator.address).returns(false)
              await expect(market.connect(liquidator).update(user.address, 0, 0, 0, shortfall.mul(-1), false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_5.timestamp, 0, 0, 0, shortfall.mul(-1), false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 4,
                collateral: 0,
                reward: EXPECTED_REWARD.mul(2).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 4), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE).add(shortfall.mul(-1)),
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market.connect(userB).update(userB.address, 0, POSITION.div(2), 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(marketParameter)

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
              currentId: 3,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_5.timestamp,
              long: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
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
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
            })

            it('opens the position', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, POSITION, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION, COLLATERAL, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, POSITION, COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (same version)', async () => {
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)

              await expect(market.connect(user).update(user.address, 0, 0, POSITION, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)

              await expect(market.connect(user).update(user.address, 0, 0, POSITION, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (next version)', async () => {
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(market.connect(user).update(user.address, 0, 0, POSITION, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, POSITION, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(market.connect(user).update(user.address, 0, 0, POSITION, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, POSITION, 0, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION,
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
            })

            it('opens the position and settles later', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.staleAfter = BigNumber.from(9600)
              await market.connect(owner).updateRiskParameter(riskParameter)

              await expect(market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION.div(2), COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
            })

            it('opens the position and settles later with fee', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.takerFee = parse6decimal('0.01')
              riskParameter.takerImpactFee = parse6decimal('0.004')
              riskParameter.takerSkewFee = parse6decimal('0.002')
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
              const TAKER_FEE_FEE = TAKER_FEE.div(10)
              const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              dsu.transferFrom
                .whenCalledWith(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
                .returns(true)
              await expect(market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION.div(2), COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE)
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.takerFee = parse6decimal('0.01')
              riskParameter.takerImpactFee = parse6decimal('0.004')
              riskParameter.takerSkewFee = parse6decimal('0.002')
              await market.updateRiskParameter(riskParameter)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.settlementFee = parse6decimal('0.50')
              await market.updateParameter(marketParameter)

              const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
              const TAKER_FEE_FEE = TAKER_FEE.div(10)
              const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
              const SETTLEMENT_FEE = parse6decimal('0.50')

              dsu.transferFrom
                .whenCalledWith(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
                .returns(true)
              await expect(market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, POSITION.div(2), COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL.add(
                  TAKER_FEE_WITHOUT_FEE.add(
                    EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                  ),
                ).sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_FEE)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                makerValue: {
                  _value: TAKER_FEE_WITHOUT_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10),
                },
                longValue: { _value: 0 },
                shortValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)
            })

            it('closes the position partially', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, POSITION.div(4), 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, POSITION.div(4), 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION.div(4),
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION.div(4),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes the position', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, 0, 0, 0, 0, false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 1,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                delta: COLLATERAL,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectPositionEq(await market.pendingPosition(1), {
                ...DEFAULT_POSITION,
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 2,
                  collateral: COLLATERAL,
                  reward: 0,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  short: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  delta: COLLATERAL,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  short: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPosition(2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes the position and settles', async () => {
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5) },
                })
              })

              it('closes a second position (same version)', async () => {
                await market.connect(user).update(user.address, 0, 0, POSITION.div(4), 0, false)

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 2,
                  collateral: COLLATERAL,
                  reward: 0,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  short: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  delta: COLLATERAL,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  short: POSITION.div(2),
                })
                expectPositionEq(await market.pendingPosition(2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market.connect(user).update(user.address, 0, 0, POSITION.div(4), 0, false)

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5) },
                })
              })

              it('closes a second position (next version)', async () => {
                await market.connect(user).update(user.address, 0, 0, POSITION.div(4), 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, 0, false)

                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  short: POSITION.div(4),
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION.div(4),
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5) },
                })
              })

              it('closes a second position and settles (next version)', async () => {
                await market.connect(user).update(user.address, 0, 0, POSITION.div(4), 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 4,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_FUNDING_WITH_FEE_2_25_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_INTEREST_25_123),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 4), {
                  ...DEFAULT_POSITION,
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                    .sub(13), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                  .add(EXPECTED_INTEREST_FEE_5_123)
                  .add(EXPECTED_INTEREST_FEE_25_123)
                expectGlobalEq(await market.global(), {
                  currentId: 4,
                  protocolFee: totalFee.div(2).sub(1), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(4), {
                  ...DEFAULT_POSITION,
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5) },
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                  makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5).add(EXPECTED_REWARD.mul(2).div(5)) },
                })
              })

              it('closes the position and settles later', async () => {
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5) },
                })
              })

              it('closes the position and settles later with fee', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                riskParameter.takerFee = parse6decimal('0.01')
                riskParameter.takerImpactFee = parse6decimal('0.004')
                riskParameter.takerSkewFee = parse6decimal('0.002')
                await market.updateRiskParameter(riskParameter)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.settlementFee = parse6decimal('0.50')
                await market.updateParameter(marketParameter)

                const TAKER_FEE = parse6decimal('4.92') // position * (0.01 - 0.004 + 0.002) * price
                const TAKER_FEE_FEE = TAKER_FEE.div(10)
                const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
                const SETTLEMENT_FEE = parse6decimal('0.50')

                dsu.transferFrom.whenCalledWith(user.address, market.address, TAKER_FEE.mul(1e12)).returns(true)
                await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, 0, 0, 0, false)

                oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

                oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  currentId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(TAKER_FEE)
                    .sub(SETTLEMENT_FEE),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  delta: COLLATERAL,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(TAKER_FEE_WITHOUT_FEE)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  delta: COLLATERAL,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE_FEE)
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: totalFee.div(2).sub(3), // loss of precision
                  oracleFee: totalFee.div(2).div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                  riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                  donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  ...DEFAULT_POSITION,
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  makerValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(TAKER_FEE_WITHOUT_FEE)
                      .div(10),
                  },
                  longValue: { _value: 0 },
                  shortValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
                  longReward: { _value: 0 },
                  shortReward: { _value: EXPECTED_REWARD.div(5) },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)

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
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 2,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(2), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
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
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(ORACLE_VERSION_2.timestamp, oracleVersionLowerPrice.timestamp, 1, {
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
                rewardMaker: EXPECTED_REWARD.mul(3),
                rewardShort: EXPECTED_REWARD,
              })
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, oracleVersionLowerPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.mul(-1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                rewardAmount: EXPECTED_REWARD,
              })

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(userB.address, ORACLE_VERSION_2.timestamp, oracleVersionLowerPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8),
                rewardAmount: EXPECTED_REWARD.mul(3),
              })

            expectLocalEq(await market.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
              reward: EXPECTED_REWARD,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              short: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: 0 },
              shortReward: { _value: EXPECTED_REWARD.div(5) },
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
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(ORACLE_VERSION_2.timestamp, oracleVersionHigherPrice.timestamp, 1, {
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
                rewardMaker: EXPECTED_REWARD.mul(3),
                rewardShort: EXPECTED_REWARD,
              })
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(user.address, ORACLE_VERSION_2.timestamp, oracleVersionHigherPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.mul(-1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                rewardAmount: EXPECTED_REWARD,
              })

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(userB.address, ORACLE_VERSION_2.timestamp, oracleVersionHigherPrice.timestamp, 1, {
                ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                collateralAmount: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8),
                rewardAmount: EXPECTED_REWARD.mul(3),
              })

            expectLocalEq(await market.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
              reward: EXPECTED_REWARD,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              short: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: totalFee.div(2).sub(3), // loss of precision
              oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
              riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
              donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10),
              },
              longValue: { _value: 0 },
              shortValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: 0 },
              shortReward: { _value: EXPECTED_REWARD.div(5) },
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('390')).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, parse6decimal('390'), false)
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)
            })

            it('with socialization to zero', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('28.8')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

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

              expectLocalEq(await market.locals(user.address), {
                currentId: 5,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)).sub(
                  EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96),
                ),
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                short: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 5,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(20), // loss of precision
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                delta: parse6decimal('390').sub(EXPECTED_LIQUIDATION_FEE),
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
                EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
              )
              expectGlobalEq(await market.global(), {
                currentId: 5,
                protocolFee: totalFee.div(2).sub(4), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                short: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5).mul(2) },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5).mul(3) },
              })
            })

            it('with partial socialization', async () => {
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userC).update(userC.address, POSITION.div(4), 0, 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('28.8')

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
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userC)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

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
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              expectLocalEq(await market.locals(user.address), {
                currentId: 5,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96)
                  .sub(EXPECTED_INTEREST_2)
                  .sub(EXPECTED_FUNDING_WITH_FEE_3_25_123)
                  .sub(EXPECTED_INTEREST_3)
                  .add(EXPECTED_PNL),
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                short: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 5,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).mul(4).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2).mul(4).div(5))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(17), // loss of precision
                reward: EXPECTED_REWARD.mul(4).div(5).mul(3).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                delta: parse6decimal('390').sub(EXPECTED_LIQUIDATION_FEE),
              })
              expectLocalEq(await market.locals(userC.address), {
                currentId: 5,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).div(5),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3))
                  .sub(EXPECTED_PNL)
                  .sub(12), // loss of precision
                reward: EXPECTED_REWARD.div(5).mul(3).mul(2).add(EXPECTED_REWARD.mul(3)),
                protection: 0,
              })
              expectPositionEq(await market.positions(userC.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
              })
              expectPositionEq(await market.pendingPositions(userC.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION.div(4),
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_2))
                .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
              expectGlobalEq(await market.global(), {
                currentId: 5,
                protocolFee: totalFee.div(2).sub(5), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION.div(4),
                short: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(25) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(25).mul(2) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
                makerReward: {
                  _value: EXPECTED_REWARD.mul(3).mul(2).div(25).mul(2).add(EXPECTED_REWARD.mul(3).mul(2).div(5)),
                },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.mul(3).div(5) },
              })
            })

            it('with shortfall', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('12.9')

              const oracleVersionHigherPrice = {
                price: parse6decimal('43'),
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
                market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)).add(
                  EXPECTED_PNL,
                ),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION.div(2),
                delta: COLLATERAL,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 3,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(EXPECTED_PNL)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: parse6decimal('390').sub(EXPECTED_LIQUIDATION_FEE),
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

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
              await expect(market.connect(liquidator).update(userB.address, 0, 0, 0, shortfall.mul(-1), false))
                .to.emit(market, 'Updated')
                .withArgs(userB.address, ORACLE_VERSION_5.timestamp, 0, 0, 0, shortfall.mul(-1), false)

              expectLocalEq(await market.locals(userB.address), {
                currentId: 4,
                collateral: 0,
                reward: EXPECTED_REWARD.mul(3).mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 4), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: parse6decimal('390').sub(EXPECTED_LIQUIDATION_FEE).add(shortfall.mul(-1)),
              })
            })
          })

          context('short', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('195')).returns(true)
              await market.connect(user).update(user.address, 0, 0, POSITION.div(2), parse6decimal('195'), false)
            })

            it('default', async () => {
              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('22.5')

              const oracleVersionLowerPrice = {
                price: parse6decimal('150'),
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
                market.connect(liquidator).update(user.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 5,
                collateral: parse6decimal('195')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_5_150)
                  .sub(EXPECTED_LIQUIDATION_FEE),
                reward: EXPECTED_REWARD.mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE),
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 5,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                  .sub(22), // loss of precision
                reward: EXPECTED_REWARD.mul(3).mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
              expectGlobalEq(await market.global(), {
                currentId: 5,
                protocolFee: totalFee.div(2).sub(1), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(4), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPosition(5), {
                ...DEFAULT_POSITION,
                id: 5,
                timestamp: ORACLE_VERSION_6.timestamp,
                maker: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5).mul(2) },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(3) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5).mul(2) },
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
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('30.45')

              const oracleVersionHigherPrice = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market.connect(liquidator).update(user.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true),
              )
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: parse6decimal('195')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_PNL)
                  .sub(EXPECTED_LIQUIDATION_FEE),
                reward: EXPECTED_REWARD,
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE),
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 3,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_PNL)
                  .sub(8), // loss of precision
                reward: EXPECTED_REWARD.mul(3),
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                delta: COLLATERAL,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: totalFee.div(2).sub(3), // loss of precision
                oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
                riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
                donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectPositionEq(await market.pendingPosition(3), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
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
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice2.timestamp).returns(oracleVersionHigherPrice2)
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              const shortfall = parse6decimal('195')
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
              await expect(market.connect(liquidator).update(user.address, 0, 0, 0, shortfall.mul(-1), false))
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_5.timestamp, 0, 0, 0, shortfall.mul(-1), false)

              expectLocalEq(await market.locals(user.address), {
                currentId: 4,
                collateral: 0,
                reward: EXPECTED_REWARD.mul(2),
                protection: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectPositionEq(await market.pendingPositions(user.address, 4), {
                ...DEFAULT_POSITION,
                id: 4,
                timestamp: ORACLE_VERSION_5.timestamp,
                delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE).add(shortfall.mul(-1)),
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market.connect(userB).update(userB.address, 0, 0, POSITION.div(2), COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(marketParameter)

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
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            expectLocalEq(await market.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL,
              reward: 0,
              protection: 0,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_5.timestamp,
              short: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectPositionEq(await market.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              makerValue: { _value: 0 },
              longValue: { _value: 0 },
              shortValue: { _value: 0 },
              makerReward: { _value: 0 },
              longReward: { _value: 0 },
              shortReward: { _value: 0 },
            })
          })
        })
      })

      context('all positions', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        // TODO (coverage hint)
        // context.only('position delta', async () => {
        //   context.only('open', async () => {
        //     beforeEach(async () => {
        //       dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //       await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        //     })
        //
        //     it('opens the position', async () => {
        //       await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL, false)
        //       await expect(market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(userC.address, 1, 0, 0, POSITION.div(2), COLLATERAL, false)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION,
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(2),
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         makerNext: POSITION,
        //         longNext: POSITION,
        //         shortNext: POSITION.div(2),
        //       })
        //       expectVersionEq(await market.versions(ORACLE_VERSION), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     it('opens the position and settles', async () => {
        //       await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL, false)
        //       await expect(market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(userC.address, 1, 0, 0, POSITION.div(2), COLLATERAL, false)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 2,
        //         maker: 0,
        //         long: POSITION,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION,
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 2,
        //         maker: 0,
        //         long: 0,
        //         short: POSITION.div(2),
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(2),
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 2,
        //         maker: POSITION,
        //         long: POSITION,
        //         short: POSITION.div(2),
        //         makerNext: POSITION,
        //         longNext: POSITION,
        //         shortNext: POSITION.div(2),
        //       })
        //       expectVersionEq(await market.versions(2), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     it('opens a second position (same version)', async () => {
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       await market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false)
        //
        //       await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL, false)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION,
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(2),
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         makerNext: POSITION,
        //         longNext: POSITION,
        //         shortNext: POSITION.div(2),
        //       })
        //       expectVersionEq(await market.versions(ORACLE_VERSION), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     it('opens a second position and settles (same version)', async () => {
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       await market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false)
        //
        //       await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL, false)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 2,
        //         maker: 0,
        //         long: POSITION,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION,
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 2,
        //         maker: 0,
        //         long: 0,
        //         short: POSITION.div(2),
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(2),
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 2,
        //         maker: POSITION,
        //         long: POSITION,
        //         short: POSITION.div(2),
        //         makerNext: POSITION,
        //         longNext: POSITION,
        //         shortNext: POSITION.div(2),
        //       })
        //       expectVersionEq(await market.versions(2), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     it('opens a second position (next version)', async () => {
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       await market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 2, 0, POSITION, 0, COLLATERAL, false)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 2,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION,
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 1,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(2),
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 2,
        //         maker: POSITION,
        //         long: POSITION.div(2),
        //         short: POSITION.div(2),
        //         makerNext: POSITION,
        //         longNext: POSITION,
        //         shortNext: POSITION.div(2),
        //       })
        //       expectVersionEq(await market.versions(2), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     it('opens a second position and settles (next version)', async () => {
        //       // rate_0 = 0
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 3160
        //       const EXPECTED_FUNDING = BigNumber.from(3160)
        //       const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)
        //
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       await market.connect(user).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await expect(market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 2, 0, POSITION, 0, COLLATERAL, false)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //       oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: POSITION,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION,
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //         reward: EXPECTED_REWARD.mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: 0,
        //         short: POSITION.div(2),
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(2),
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE.div(2)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(1),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE.div(2)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: POSITION,
        //         short: POSITION.div(2),
        //         makerNext: POSITION,
        //         longNext: POSITION,
        //         shortNext: POSITION.div(2),
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(2).div(10) },
        //         longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //         shortValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(2).div(5) },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: EXPECTED_REWARD.mul(1).div(5) },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.div(2),
        //         market: EXPECTED_FUNDING_FEE.div(2),
        //       })
        //     })
        //
        //     it('opens the position and settles later', async () => {
        //       // rate_0 = 0
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 3160
        //       const EXPECTED_FUNDING = BigNumber.from(3160)
        //       const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)
        //
        //       await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       await market.connect(userC).update(userC.address, 0, 0, POSITION.div(4), COLLATERAL, false)
        //
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //       oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(2),
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //         reward: EXPECTED_REWARD.mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: 0,
        //         short: POSITION.div(4),
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(4),
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE.div(2)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(1),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE.div(2)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: POSITION.div(2),
        //         short: POSITION.div(4),
        //         makerNext: POSITION,
        //         longNext: POSITION.div(2),
        //         shortNext: POSITION.div(4),
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(2).div(10) },
        //         longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //         shortValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(2).div(5) },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: EXPECTED_REWARD.mul(1).div(5) },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.div(2),
        //         market: EXPECTED_FUNDING_FEE.div(2),
        //       })
        //     })
        //
        //     it('opens the position and settles later with fee', async () => {
        //       const marketParameter = { ...(await market.parameter()) }
        //       marketParameter.takerFee = parse6decimal('0.01')
        //       await market.updateParameter(marketParameter)
        //
        //       const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price
        //
        //       // rate_0 = 0
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 3160
        //       const EXPECTED_FUNDING = BigNumber.from(3160)
        //       const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)
        //
        //       dsu.mock.transferFrom
        //         .withArgs(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
        //         .returns(true)
        //       await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       dsu.mock.transferFrom
        //         .withArgs(userC.address, market.address, COLLATERAL.add(TAKER_FEE.div(2)).mul(1e12))
        //         .returns(true)
        //       await market.connect(userC).update(userC.address, 0, 0, POSITION.div(4), COLLATERAL, false)
        //
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //       oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(2),
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //         reward: EXPECTED_REWARD.mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: 0,
        //         short: POSITION.div(4),
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(4),
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE.div(2)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(1),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE.div(2)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: POSITION.div(2),
        //         short: POSITION.div(4),
        //         makerNext: POSITION,
        //         longNext: POSITION.div(2),
        //         shortNext: POSITION.div(4),
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(2).div(10) },
        //         longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //         shortValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(2).div(5) },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: EXPECTED_REWARD.mul(1).div(5) },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.add(TAKER_FEE).div(2), // no makers yet, taker fee is forwarded
        //         market: EXPECTED_FUNDING_FEE.add(TAKER_FEE).div(2),
        //       })
        //     })
        //
        //     it('settles opens the position and settles later with fee', async () => {
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //
        //       const marketParameter = { ...(await market.parameter()) }
        //       marketParameter.takerFee = parse6decimal('0.01')
        //       await market.updateParameter(marketParameter)
        //
        //       const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price
        //
        //       // rate_0 = 0
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 3160
        //       const EXPECTED_FUNDING = BigNumber.from(3160)
        //       const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)
        //
        //       dsu.mock.transferFrom
        //         .withArgs(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
        //         .returns(true)
        //       await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 2, 0, POSITION.div(2), 0, COLLATERAL, false)
        //       dsu.mock.transferFrom
        //         .withArgs(userC.address, market.address, COLLATERAL.add(TAKER_FEE.div(2)).mul(1e12))
        //         .returns(true)
        //       await market.connect(userC).update(userC.address, 0, 0, POSITION.div(4), COLLATERAL, false)
        //
        //       oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //       oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 4,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(2),
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //         reward: EXPECTED_REWARD.mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 4,
        //         maker: 0,
        //         long: 0,
        //         short: POSITION.div(4),
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: POSITION.div(4),
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //         reward: EXPECTED_REWARD.mul(1),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 4,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(TAKER_FEE.add(EXPECTED_FUNDING_WITH_FEE)).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3).mul(2),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 4,
        //         maker: POSITION,
        //         long: POSITION.div(2),
        //         short: POSITION.div(4),
        //         makerNext: POSITION,
        //         longNext: POSITION.div(2),
        //         shortNext: POSITION.div(4),
        //       })
        //       expectVersionEq(await market.versions(4), {
        //         makerValue: { _value: TAKER_FEE.add(EXPECTED_FUNDING_WITH_FEE.div(2)).div(10) },
        //         longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //         shortValue: { _value: TAKER_FEE.add(EXPECTED_FUNDING_WITH_FEE.div(2)).div(5) },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: EXPECTED_REWARD.mul(1).div(5) },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.div(2),
        //         market: EXPECTED_FUNDING_FEE.div(2),
        //       })
        //     })
        //   })
        //
        //   context('close', async () => {
        //     beforeEach(async () => {
        //       dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //       await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //     })
        //
        //     it('closes the position partially', async () => {
        //       await expect(market.connect(user).update(user.address, 0, POSITION.div(4), 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, POSITION.div(4), 0, COLLATERAL, false)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(4),
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         makerNext: POSITION,
        //         longNext: POSITION.div(4),
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(ORACLE_VERSION), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     it('closes the position', async () => {
        //       await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 1, 0, 0, 0, COLLATERAL, false)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL,
        //         reward: 0,
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: ORACLE_VERSION,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         makerNext: POSITION,
        //         longNext: 0,
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(ORACLE_VERSION), {
        //         makerValue: { _value: 0 },
        //         longValue: { _value: 0 },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: 0 },
        //         longReward: { _value: 0 },
        //         shortReward: { _value: 0 },
        //       })
        //     })
        //
        //     context('settles first', async () => {
        //       beforeEach(async () => {
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //         oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //         await settle(market, user)
        //       })
        //
        //       it('closes the position', async () => {
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 2, 0, 0, 0, COLLATERAL, false)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 2,
        //           maker: 0,
        //           long: POSITION.div(2),
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL,
        //           reward: 0,
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 2,
        //           maker: POSITION,
        //           long: POSITION.div(2),
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(2), {
        //           makerValue: { _value: 0 },
        //           longValue: { _value: 0 },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: 0 },
        //           longReward: { _value: 0 },
        //           shortReward: { _value: 0 },
        //         })
        //       })
        //
        //       it('closes the position and settles', async () => {
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 2, 0, 0, 0, COLLATERAL, false)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //         oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //         await settle(market, user)
        //         await settle(market, userB)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 3,
        //           maker: 0,
        //           long: 0,
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //           reward: EXPECTED_REWARD.mul(2),
        //           protection: false,
        //         })
        //         expectAccountEq(await market.accounts(userB.address), {
        //           latesttimestamp: 3,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           nextMaker: POSITION,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).sub(8), // loss of precision
        //           reward: EXPECTED_REWARD.mul(3),
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 3,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(3), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //           shortReward: { _value: 0 },
        //         })
        //       })
        //
        //       it('closes a second position (same version)', async () => {
        //         await market.connect(user).update(user.address, 0, POSITION.div(4), 0, COLLATERAL, false)
        //
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 2, 0, 0, 0, COLLATERAL, false)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 2,
        //           maker: 0,
        //           long: POSITION.div(2),
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL,
        //           reward: 0,
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 2,
        //           maker: POSITION,
        //           long: POSITION.div(2),
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(2), {
        //           makerValue: { _value: 0 },
        //           longValue: { _value: 0 },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: 0 },
        //           longReward: { _value: 0 },
        //           shortReward: { _value: 0 },
        //         })
        //       })
        //
        //       it('closes a second position and settles (same version)', async () => {
        //         await market.connect(user).update(user.address, 0, POSITION.div(4), 0, COLLATERAL, false)
        //
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 2, 0, 0, 0, COLLATERAL, false)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //         oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //         await settle(market, user)
        //         await settle(market, userB)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 3,
        //           maker: 0,
        //           long: 0,
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //           reward: EXPECTED_REWARD.mul(2),
        //           protection: false,
        //         })
        //         expectAccountEq(await market.accounts(userB.address), {
        //           latesttimestamp: 3,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           nextMaker: POSITION,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).sub(8), // loss of precision
        //           reward: EXPECTED_REWARD.mul(3),
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 3,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(3), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //           shortReward: { _value: 0 },
        //         })
        //         expectFeeEq(await market.fee(), {
        //           protocol: EXPECTED_FUNDING_FEE.div(2),
        //           market: EXPECTED_FUNDING_FEE.div(2),
        //         })
        //       })
        //
        //       it('closes a second position (next version)', async () => {
        //         await market.connect(user).update(user.address, 0, POSITION.div(4), 0, COLLATERAL, false)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //         oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //         dsu.mock.transferFrom
        //           .withArgs(user.address, market.address, EXPECTED_FUNDING.mul(1e12))
        //           .returns(true)
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 3, 0, 0, 0, COLLATERAL, false)
        //
        //         await settle(market, userB)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 3,
        //           maker: 0,
        //           long: POSITION.div(4),
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL, // EXPECTED_FUNDING paid at update
        //           reward: EXPECTED_REWARD.mul(2),
        //           protection: false,
        //         })
        //         expectAccountEq(await market.accounts(userB.address), {
        //           latesttimestamp: 3,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           nextMaker: POSITION,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).sub(8), // loss of precision
        //           reward: EXPECTED_REWARD.mul(3),
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 3,
        //           maker: POSITION,
        //           long: POSITION.div(4),
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(3), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //           shortReward: { _value: 0 },
        //         })
        //         expectFeeEq(await market.fee(), {
        //           protocol: EXPECTED_FUNDING_FEE.div(2),
        //           market: EXPECTED_FUNDING_FEE.div(2),
        //         })
        //       })
        //
        //       it('closes a second position and settles (next version)', async () => {
        //         // rate_0 = 0.09
        //         // rate_1 = rate_0 + (elapsed * skew / k)
        //         // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //         // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 2.5 * 123 / (86400 * 365) = 4740
        //         const EXPECTED_FUNDING_2 = BigNumber.from(4740)
        //         const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
        //         const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2)
        //
        //         await market.connect(user).update(user.address, 0, POSITION.div(4), 0, COLLATERAL, false)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        //         oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_3)
        //
        //         dsu.mock.transferFrom
        //           .withArgs(user.address, market.address, EXPECTED_FUNDING.mul(1e12))
        //           .returns(true)
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 3, 0, 0, 0, COLLATERAL, false)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //         oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //         await settle(market, user)
        //         await settle(market, userB)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 4,
        //           maker: 0,
        //           long: 0,
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.sub(EXPECTED_FUNDING_2), // EXPECTED_FUNDING_1 paid at update
        //           reward: EXPECTED_REWARD.mul(2).mul(2),
        //           protection: false,
        //         })
        //         expectAccountEq(await market.accounts(userB.address), {
        //           latesttimestamp: 4,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           nextMaker: POSITION,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE).add(EXPECTED_FUNDING_WITH_FEE_2).sub(10), // loss of precision
        //           reward: EXPECTED_REWARD.mul(3).mul(2),
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 4,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(3), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //           shortReward: { _value: 0 },
        //         })
        //         expectVersionEq(await market.versions(4), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_FUNDING_WITH_FEE_2).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING.div(5).add(EXPECTED_FUNDING_2.mul(2).div(5)).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5).add(EXPECTED_REWARD.mul(2).mul(2).div(5)) },
        //           shortReward: { _value: 0 },
        //         })
        //         expectFeeEq(await market.fee(), {
        //           protocol: EXPECTED_FUNDING_FEE.add(EXPECTED_FUNDING_FEE_2).div(2),
        //           market: EXPECTED_FUNDING_FEE.add(EXPECTED_FUNDING_FEE_2).div(2).add(1), // odd number
        //         })
        //       })
        //
        //       it('closes the position and settles later', async () => {
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 2, 0, 0, 0, COLLATERAL, false)
        //
        //         oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //         oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //         await settle(market, user)
        //         await settle(market, userB)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 4,
        //           maker: 0,
        //           long: 0,
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //           reward: EXPECTED_REWARD.mul(2),
        //           protection: false,
        //         })
        //         expectAccountEq(await market.accounts(userB.address), {
        //           latesttimestamp: 4,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           nextMaker: POSITION,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).sub(8), // loss of precision
        //           reward: EXPECTED_REWARD.mul(3).mul(2),
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 4,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(4), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //           shortReward: { _value: 0 },
        //         })
        //         expectFeeEq(await market.fee(), {
        //           protocol: EXPECTED_FUNDING_FEE.div(2),
        //           market: EXPECTED_FUNDING_FEE.div(2),
        //         })
        //       })
        //
        //       it('closes the position and settles later with fee', async () => {
        //         const marketParameter = { ...(await market.parameter()) }
        //         marketParameter.takerFee = parse6decimal('0.01')
        //         await market.updateParameter(marketParameter)
        //
        //         const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price
        //
        //         dsu.transferFrom.whenCalledWith(user.address, market.address, TAKER_FEE.mul(1e12)).returns(true)
        //         await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false))
        //           .to.emit(market, 'Updated')
        //           .withArgs(user.address, 2, 0, 0, 0, COLLATERAL, false)
        //
        //         oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        //
        //         oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //         oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //         oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //         await settle(market, user)
        //         await settle(market, userB)
        //
        //         expectAccountEq(await market.accounts(user.address), {
        //           latesttimestamp: 4,
        //           maker: 0,
        //           long: 0,
        //           short: 0,
        //           nextMaker: 0,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //           reward: EXPECTED_REWARD.mul(2),
        //           protection: false,
        //         })
        //         expectAccountEq(await market.accounts(userB.address), {
        //           latesttimestamp: 4,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           nextMaker: POSITION,
        //           nextLong: 0,
        //           nextShort: 0,
        //           collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).add(TAKER_FEE).sub(8), // loss of precision
        //           reward: EXPECTED_REWARD.mul(3).mul(2),
        //           protection: false,
        //         })
        //         expectPositionEq(await market.position(), {
        //           latesttimestamp: 4,
        //           maker: POSITION,
        //           long: 0,
        //           short: 0,
        //           makerNext: POSITION,
        //           longNext: 0,
        //           shortNext: 0,
        //         })
        //         expectVersionEq(await market.versions(4), {
        //           makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(TAKER_FEE).div(10) },
        //           longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //           shortValue: { _value: 0 },
        //           makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
        //           longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //           shortReward: { _value: 0 },
        //         })
        //         expectFeeEq(await market.fee(), {
        //           protocol: EXPECTED_FUNDING_FEE.div(2),
        //           market: EXPECTED_FUNDING_FEE.div(2),
        //         })
        //       })
        //     })
        //   })
        // })

        // context('price delta', async () => {
        //   beforeEach(async () => {
        //     dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //     await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        //     await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //
        //     oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //     oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //     oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //     await settle(market, user)
        //     await settle(market, userB)
        //   })
        //
        //   it('same price same timestamp settle', async () => {
        //     const oracleVersionSameTimestamp = {
        //       price: PRICE,
        //       timestamp: TIMESTAMP + 3600,
        //       timestamp: 3,
        //     }
        //
        //     oracle.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        //     oracle.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        //     oracle.mock.request.withArgs().returns(oracleVersionSameTimestamp)
        //
        //     await settle(market, user)
        //     await settle(market, userB)
        //
        //     expectAccountEq(await market.accounts(user.address), {
        //       latesttimestamp: 3,
        //       maker: 0,
        //       long: POSITION.div(2),
        //       short: 0,
        //       nextMaker: 0,
        //       nextLong: POSITION.div(2),
        //       nextShort: 0,
        //       collateral: COLLATERAL,
        //       reward: 0,
        //       protection: false,
        //     })
        //     expectAccountEq(await market.accounts(userB.address), {
        //       latesttimestamp: 3,
        //       maker: POSITION,
        //       long: 0,
        //       short: 0,
        //       nextMaker: POSITION,
        //       nextLong: 0,
        //       nextShort: 0,
        //       collateral: COLLATERAL,
        //       reward: 0,
        //       protection: false,
        //     })
        //     expectPositionEq(await market.position(), {
        //       latesttimestamp: 3,
        //       maker: POSITION,
        //       long: POSITION.div(2),
        //       short: 0,
        //       makerNext: POSITION,
        //       longNext: POSITION.div(2),
        //       shortNext: 0,
        //     })
        //     expectVersionEq(await market.versions(3), {
        //       makerValue: { _value: 0 },
        //       longValue: { _value: 0 },
        //       shortValue: { _value: 0 },
        //       makerReward: { _value: 0 },
        //       longReward: { _value: 0 },
        //       shortReward: { _value: 0 },
        //     })
        //     expectFeeEq(await market.fee(), {
        //       protocol: 0,
        //       market: 0,
        //     })
        //   })
        //
        //   it('lower price same rate settle', async () => {
        //     dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))
        //
        //     const EXPECTED_PNL = parse6decimal('2').mul(5) // maker pnl
        //
        //     const oracleVersionLowerPrice = {
        //       price: parse6decimal('121'),
        //       timestamp: TIMESTAMP + 7200,
        //       timestamp: 3,
        //     }
        //     oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        //     oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        //     oracle.mock.request.withArgs().returns(oracleVersionLowerPrice)
        //
        //     await settle(market, user)
        //     await settle(market, userB)
        //
        //     expectAccountEq(await market.accounts(user.address), {
        //       latesttimestamp: 3,
        //       maker: 0,
        //       long: POSITION.div(2),
        //       short: 0,
        //       nextMaker: 0,
        //       nextLong: POSITION.div(2),
        //       nextShort: 0,
        //       collateral: COLLATERAL.sub(EXPECTED_PNL).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //       reward: EXPECTED_REWARD.mul(2),
        //       protection: false,
        //     })
        //     expectAccountEq(await market.accounts(userB.address), {
        //       latesttimestamp: 3,
        //       maker: POSITION,
        //       long: 0,
        //       short: 0,
        //       nextMaker: POSITION,
        //       nextLong: 0,
        //       nextShort: 0,
        //       collateral: COLLATERAL.add(EXPECTED_PNL).add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).sub(8), // loss of precision
        //       reward: EXPECTED_REWARD.mul(3),
        //       protection: false,
        //     })
        //     expectPositionEq(await market.position(), {
        //       latesttimestamp: 3,
        //       maker: POSITION,
        //       long: POSITION.div(2),
        //       short: 0,
        //       makerNext: POSITION,
        //       longNext: POSITION.div(2),
        //       shortNext: 0,
        //     })
        //     expectVersionEq(await market.versions(3), {
        //       makerValue: { _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
        //       longValue: { _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //       shortValue: { _value: 0 },
        //       makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //       longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //       shortReward: { _value: 0 },
        //     })
        //     expectFeeEq(await market.fee(), {
        //       protocol: EXPECTED_FUNDING_FEE.div(2),
        //       market: EXPECTED_FUNDING_FEE.div(2),
        //     })
        //   })
        //
        //   it('higher price same rate settle', async () => {
        //     const EXPECTED_PNL = parse6decimal('-2').mul(5) // maker pnl
        //
        //     const oracleVersionHigherPrice = {
        //       price: parse6decimal('125'),
        //       timestamp: TIMESTAMP + 7200,
        //       timestamp: 3,
        //     }
        //     oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        //     oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        //     oracle.mock.request.withArgs().returns(oracleVersionHigherPrice)
        //
        //     await settle(market, user)
        //     await settle(market, userB)
        //
        //     expectAccountEq(await market.accounts(user.address), {
        //       latesttimestamp: 3,
        //       maker: 0,
        //       long: POSITION.div(2),
        //       short: 0,
        //       nextMaker: 0,
        //       nextLong: POSITION.div(2),
        //       nextShort: 0,
        //       collateral: COLLATERAL.sub(EXPECTED_PNL).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
        //       reward: EXPECTED_REWARD.mul(2),
        //       protection: false,
        //     })
        //     expectAccountEq(await market.accounts(userB.address), {
        //       latesttimestamp: 3,
        //       maker: POSITION,
        //       long: 0,
        //       short: 0,
        //       nextMaker: POSITION,
        //       nextLong: 0,
        //       nextShort: 0,
        //       collateral: COLLATERAL.add(EXPECTED_PNL).add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).sub(8), // loss of precision
        //       reward: EXPECTED_REWARD.mul(3),
        //       protection: false,
        //     })
        //     expectPositionEq(await market.position(), {
        //       latesttimestamp: 3,
        //       maker: POSITION,
        //       long: POSITION.div(2),
        //       short: 0,
        //       makerNext: POSITION,
        //       longNext: POSITION.div(2),
        //       shortNext: 0,
        //     })
        //     expectVersionEq(await market.versions(3), {
        //       makerValue: { _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10).sub(1) }, // loss of precision
        //       longValue: { _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
        //       shortValue: { _value: 0 },
        //       makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //       longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //       shortReward: { _value: 0 },
        //     })
        //     expectFeeEq(await market.fee(), {
        //       protocol: EXPECTED_FUNDING_FEE.div(2),
        //       market: EXPECTED_FUNDING_FEE.div(2),
        //     })
        //   })
        // })
        //
        // context('liquidation', async () => {
        //   context('maker', async () => {
        //     beforeEach(async () => {
        //       dsu.mock.transferFrom
        //         .withArgs(userB.address, market.address, utils.parseEther('450'))
        //         .returns(true)
        //       await market.connect(userB).update(userB.address, POSITION, 0, 0, parse6decimal('450'))
        //       dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //     })
        //
        //     it('with socialization to zero', async () => {
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       const EXPECTED_PNL = parse6decimal('27').mul(5)
        //       const EXPECTED_LIQUIDATION_FEE = parse6decimal('45')
        //
        //       // rate_0 = 0.09
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 150 / (86400 * 365) = 11560
        //       const EXPECTED_FUNDING_2 = BigNumber.from(11560)
        //       const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2)
        //
        //       const oracleVersionHigherPrice = {
        //         price: parse6decimal('150'),
        //         timestamp: TIMESTAMP + 7200,
        //         timestamp: 3,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        //       oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        //       oracle.mock.request.withArgs().returns(oracleVersionHigherPrice)
        //
        //       await settle(market, user)
        //       dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
        //       dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
        //
        //       await expect(market.connect(liquidator).settle(userB.address))
        //         .to.emit(market, 'Liquidation')
        //         .withArgs(userB.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //       oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       const oracleVersionHigherPrice2 = {
        //         price: parse6decimal('150'),
        //         timestamp: TIMESTAMP + 14400,
        //         timestamp: 5,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice2)
        //       oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice2)
        //       oracle.mock.request.withArgs().returns(oracleVersionHigherPrice2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 5,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(2),
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING).sub(EXPECTED_FUNDING_2),
        //         reward: EXPECTED_REWARD.mul(2).mul(3),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 5,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: parse6decimal('450')
        //           .add(EXPECTED_FUNDING_WITH_FEE)
        //           .add(EXPECTED_FUNDING_WITH_FEE_2)
        //           .sub(EXPECTED_LIQUIDATION_FEE)
        //           .sub(17), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3).mul(2),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 5,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         makerNext: 0,
        //         longNext: POSITION.div(2),
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.sub(EXPECTED_PNL).div(10).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.sub(EXPECTED_PNL).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectVersionEq(await market.versions(4), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_FUNDING_WITH_FEE_2).div(10).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.add(EXPECTED_FUNDING_2).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(2) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectVersionEq(await market.versions(5), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_FUNDING_WITH_FEE_2).div(10).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.add(EXPECTED_FUNDING_2).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(3) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.add(EXPECTED_FUNDING_FEE_2).div(2),
        //         market: EXPECTED_FUNDING_FEE.add(EXPECTED_FUNDING_FEE_2).div(2),
        //       })
        //     })
        //
        //     it('with partial socialization', async () => {
        //       dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //       await market.connect(userC).update(userC.address, POSITION.div(4), 0, 0, COLLATERAL, false)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
        //       const EXPECTED_LIQUIDATION_FEE = parse6decimal('45')
        //
        //       // rate * elapsed * utilization * maker * price
        //       // ( 0.08 * 10^6 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 5617
        //       const EXPECTED_FUNDING_1 = BigNumber.from('5620')
        //       const EXPECTED_FUNDING_FEE_1 = EXPECTED_FUNDING_1.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE_1 = EXPECTED_FUNDING_1.sub(EXPECTED_FUNDING_FEE_1)
        //
        //       // rate_0 = 0.09
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 150 / (86400 * 365) = 11560
        //       const EXPECTED_FUNDING_2 = BigNumber.from(11560)
        //       const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2)
        //
        //       // rate_0 = 0.18
        //       // rate_1 = rate_0 + (elapsed * k * skew)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0.18 + (0.18 + 3600 * 1.00 / 40000)) / 2 * 3600 * 2.5 * 123 / (86400 * 365) = 7900
        //       const EXPECTED_FUNDING_3 = BigNumber.from('7900')
        //       const EXPECTED_FUNDING_FEE_3 = EXPECTED_FUNDING_3.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE_3 = EXPECTED_FUNDING_3.sub(EXPECTED_FUNDING_FEE_3)
        //
        //       const oracleVersionHigherPrice = {
        //         price: parse6decimal('150'),
        //         timestamp: TIMESTAMP + 7200,
        //         timestamp: 3,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        //       oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        //       oracle.mock.request.withArgs().returns(oracleVersionHigherPrice)
        //
        //       await settle(market, user)
        //       await settle(market, userC)
        //       dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
        //       dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
        //       await expect(market.connect(liquidator).settle(userB.address))
        //         .to.emit(market, 'Liquidation')
        //         .withArgs(userB.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //       oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       const oracleVersionHigherPrice2 = {
        //         price: parse6decimal('150'),
        //         timestamp: TIMESTAMP + 14400,
        //         timestamp: 5,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice2)
        //       oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice2)
        //       oracle.mock.request.withArgs().returns(oracleVersionHigherPrice2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //       await settle(market, userC)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 5,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(2),
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING_1)
        //           .sub(EXPECTED_FUNDING_2)
        //           .sub(EXPECTED_FUNDING_3)
        //           .add(EXPECTED_PNL),
        //         reward: EXPECTED_REWARD.mul(2).mul(3),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 5,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: parse6decimal('450')
        //           .add(EXPECTED_FUNDING_WITH_FEE_1.mul(4).div(5))
        //           .add(EXPECTED_FUNDING_WITH_FEE_2.mul(4).div(5))
        //           .sub(EXPECTED_LIQUIDATION_FEE)
        //           .sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(4).div(5).mul(3).mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userC.address), {
        //         latesttimestamp: 5,
        //         maker: POSITION.div(4),
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION.div(4),
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE_1.div(5))
        //           .add(EXPECTED_FUNDING_WITH_FEE_2.div(5))
        //           .add(EXPECTED_FUNDING_WITH_FEE_3)
        //           .sub(EXPECTED_PNL)
        //           .sub(7), // loss of precision
        //         reward: EXPECTED_REWARD.div(5).mul(3).mul(2).add(EXPECTED_REWARD.mul(3)),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 5,
        //         maker: POSITION.div(4),
        //         long: POSITION.div(2),
        //         short: 0,
        //         makerNext: POSITION.div(4),
        //         longNext: POSITION.div(2),
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE_1.sub(EXPECTED_PNL.mul(2)).mul(2).div(25).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING_1.sub(EXPECTED_PNL.mul(2)).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(25) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectVersionEq(await market.versions(4), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2).mul(2).div(25) },
        //         longValue: { _value: EXPECTED_FUNDING_1.add(EXPECTED_FUNDING_2).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(25).mul(2) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).mul(2).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectVersionEq(await market.versions(5), {
        //         makerValue: {
        //           _value: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2)
        //             .mul(2)
        //             .div(25)
        //             .add(EXPECTED_FUNDING_WITH_FEE_3.mul(2).div(5))
        //             .sub(EXPECTED_PNL.mul(2).div(5))
        //             .sub(2), // loss of precision
        //         },
        //         longValue: {
        //           _value: EXPECTED_FUNDING_1.add(EXPECTED_FUNDING_2)
        //             .add(EXPECTED_FUNDING_3)
        //             .sub(EXPECTED_PNL)
        //             .div(5)
        //             .mul(-1),
        //         },
        //         shortValue: { _value: 0 },
        //         makerReward: {
        //           _value: EXPECTED_REWARD.mul(3).mul(2).div(25).mul(2).add(EXPECTED_REWARD.mul(3).mul(2).div(5)),
        //         },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).mul(3).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE_1.add(EXPECTED_FUNDING_FEE_2)
        //           .add(EXPECTED_FUNDING_FEE_3)
        //           .div(2)
        //           .sub(1), // loss of precision
        //         market: EXPECTED_FUNDING_FEE_1.add(EXPECTED_FUNDING_FEE_2).add(EXPECTED_FUNDING_FEE_3).div(2),
        //       })
        //     })
        //
        //     it('with shortfall', async () => {
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       const EXPECTED_PNL = parse6decimal('80').mul(5)
        //       const EXPECTED_LIQUIDATION_FEE = parse6decimal('60.9')
        //
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 203 / (86400 * 365) = 15645
        //       const EXPECTED_FUNDING_2 = BigNumber.from(15645)
        //       const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2)
        //
        //       const oracleVersionHigherPrice = {
        //         price: parse6decimal('203'),
        //         timestamp: TIMESTAMP + 7200,
        //         timestamp: 3,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        //       oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        //       oracle.mock.request.withArgs().returns(oracleVersionHigherPrice)
        //
        //       await settle(market, user)
        //       dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
        //       dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
        //
        //       await expect(market.connect(liquidator).settle(userB.address))
        //         .to.emit(market, 'Liquidation')
        //         .withArgs(userB.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: POSITION.div(2),
        //         nextShort: 0,
        //         collateral: COLLATERAL.sub(EXPECTED_FUNDING).add(EXPECTED_PNL),
        //         reward: EXPECTED_REWARD.mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: parse6decimal('450')
        //           .add(EXPECTED_FUNDING_WITH_FEE)
        //           .sub(EXPECTED_LIQUIDATION_FEE)
        //           .sub(EXPECTED_PNL)
        //           .sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3),
        //         protection: true,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: POSITION.div(2),
        //         short: 0,
        //         makerNext: 0,
        //         longNext: POSITION.div(2),
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.sub(EXPECTED_PNL).div(10).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.sub(EXPECTED_PNL).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.div(2),
        //         market: EXPECTED_FUNDING_FEE.div(2),
        //       })
        //
        //       const oracleVersionHigherPrice2 = {
        //         price: parse6decimal('203'),
        //         timestamp: TIMESTAMP + 10800,
        //         timestamp: 4,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice2)
        //       oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice2)
        //       oracle.mock.request.withArgs().returns(oracleVersionHigherPrice2)
        //
        //       const shortfall = parse6decimal('450')
        //         .add(EXPECTED_FUNDING_WITH_FEE)
        //         .add(EXPECTED_FUNDING_WITH_FEE_2)
        //         .sub(EXPECTED_LIQUIDATION_FEE)
        //         .sub(EXPECTED_PNL)
        //         .sub(19) // loss of precision
        //       dsu.mock.transferFrom
        //         .withArgs(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
        //         .returns(true)
        //       factory.operators.whenCalledWith(userB.address, liquidator.address).returns(false)
        //       await expect(market.connect(liquidator).update(userB.address, 0, 0, 0, 0))
        //         .to.emit(market, 'Updated')
        //         .withArgs(userB.address, 4, 0, 0, 0, 0)
        //
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 4,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: 0,
        //         reward: EXPECTED_REWARD.mul(3).mul(2),
        //         protection: false,
        //       })
        //     })
        //   })
        //
        //   context('long', async () => {
        //     beforeEach(async () => {
        //       dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //       await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        //       dsu.mock.transferFrom
        //         .withArgs(user.address, market.address, utils.parseEther('195'))
        //         .returns(true)
        //       await market.connect(user).update(user.address, 0, POSITION.div(2), 0, parse6decimal('195'))
        //     })
        //
        //     it('default', async () => {
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       const EXPECTED_PNL = parse6decimal('27').mul(5)
        //       const EXPECTED_LIQUIDATION_FEE = parse6decimal('14.4')
        //
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 96 / (86400 * 365) = 7400
        //       const EXPECTED_FUNDING_2 = BigNumber.from(7400)
        //       const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
        //       const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2)
        //
        //       const oracleVersionLowerPrice = {
        //         price: parse6decimal('96'),
        //         timestamp: TIMESTAMP + 7200,
        //         timestamp: 3,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        //       oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        //       oracle.mock.request.withArgs().returns(oracleVersionLowerPrice)
        //
        //       await settle(market, userB)
        //       dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
        //       dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
        //
        //       await expect(market.connect(liquidator).settle(user.address))
        //         .to.emit(market, 'Liquidation')
        //         .withArgs(user.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
        //       oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_4)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       const oracleVersionLowerPrice2 = {
        //         price: parse6decimal('96'),
        //         timestamp: TIMESTAMP + 14400,
        //         timestamp: 5,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice2)
        //       oracle.mock.atVersion.withArgs(5).returns(oracleVersionLowerPrice2)
        //       oracle.mock.request.withArgs().returns(oracleVersionLowerPrice2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 5,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: parse6decimal('195')
        //           .sub(EXPECTED_FUNDING)
        //           .sub(EXPECTED_FUNDING_2)
        //           .sub(EXPECTED_LIQUIDATION_FEE),
        //         reward: EXPECTED_REWARD.mul(2).mul(2),
        //         protection: false,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 5,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE).add(EXPECTED_FUNDING_WITH_FEE_2).sub(10), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3).mul(3),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 5,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         makerNext: POSITION,
        //         longNext: 0,
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_PNL).div(10) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.add(EXPECTED_PNL).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectVersionEq(await market.versions(4), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_FUNDING_WITH_FEE_2).div(10).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.add(EXPECTED_FUNDING_2).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(2) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectVersionEq(await market.versions(5), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_FUNDING_WITH_FEE_2).div(10).sub(1) }, // loss of precision
        //         longValue: { _value: EXPECTED_FUNDING.add(EXPECTED_FUNDING_2).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(3) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5).mul(2) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.add(EXPECTED_FUNDING_FEE_2).div(2).sub(1), // loss of precision
        //         market: EXPECTED_FUNDING_FEE.add(EXPECTED_FUNDING_FEE_2).div(2),
        //       })
        //     })
        //
        //     it('with shortfall', async () => {
        //       factory.parameter.returns({
        //         protocolFee: parse6decimal('0.50'),
        //         liquidationFee: parse6decimal('0.10'),
        //         maxLiquidationFee: parse6decimal('1000'),
        //         minCollateral: parse6decimal('50')
        //       })
        //
        //       oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //       oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //       oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //       await settle(market, user)
        //       await settle(market, userB)
        //
        //       const EXPECTED_PNL = parse6decimal('80').mul(5)
        //       const EXPECTED_LIQUIDATION_FEE = parse6decimal('6.45')
        //
        //       // rate_1 = rate_0 + (elapsed * skew / k)
        //       // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        //       // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 43 / (86400 * 365) = 3315
        //       const EXPECTED_FUNDING_2 = BigNumber.from(3315)
        //
        //       const oracleVersionLowerPrice = {
        //         price: parse6decimal('43'),
        //         timestamp: TIMESTAMP + 7200,
        //         timestamp: 3,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        //       oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        //       oracle.mock.request.withArgs().returns(oracleVersionLowerPrice)
        //
        //       await settle(market, userB)
        //       dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
        //       dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
        //
        //       await expect(market.connect(liquidator).settle(user.address))
        //         .to.emit(market, 'Liquidation')
        //         .withArgs(user.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 3,
        //         maker: 0,
        //         long: POSITION.div(2),
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: parse6decimal('195')
        //           .sub(EXPECTED_FUNDING)
        //           .sub(EXPECTED_PNL)
        //           .sub(EXPECTED_LIQUIDATION_FEE),
        //         reward: EXPECTED_REWARD.mul(2),
        //         protection: true,
        //       })
        //       expectAccountEq(await market.accounts(userB.address), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: 0,
        //         short: 0,
        //         nextMaker: POSITION,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE).add(EXPECTED_PNL).sub(4), // loss of precision
        //         reward: EXPECTED_REWARD.mul(3),
        //         protection: false,
        //       })
        //       expectPositionEq(await market.position(), {
        //         latesttimestamp: 3,
        //         maker: POSITION,
        //         long: POSITION.div(2),
        //         short: 0,
        //         makerNext: POSITION,
        //         longNext: 0,
        //         shortNext: 0,
        //       })
        //       expectVersionEq(await market.versions(3), {
        //         makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.add(EXPECTED_PNL).div(10) },
        //         longValue: { _value: EXPECTED_FUNDING.add(EXPECTED_PNL).div(5).mul(-1) },
        //         shortValue: { _value: 0 },
        //         makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
        //         longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
        //         shortReward: { _value: 0 },
        //       })
        //       expectFeeEq(await market.fee(), {
        //         protocol: EXPECTED_FUNDING_FEE.div(2),
        //         market: EXPECTED_FUNDING_FEE.div(2),
        //       })
        //
        //       const oracleVersionLowerPrice2 = {
        //         price: parse6decimal('43'),
        //         timestamp: TIMESTAMP + 10800,
        //         timestamp: 4,
        //       }
        //       oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice2)
        //       oracle.mock.atVersion.withArgs(4).returns(oracleVersionLowerPrice2)
        //       oracle.mock.request.withArgs().returns(oracleVersionLowerPrice2)
        //
        //       const shortfall = parse6decimal('195')
        //         .sub(EXPECTED_FUNDING)
        //         .sub(EXPECTED_FUNDING_2)
        //         .sub(EXPECTED_LIQUIDATION_FEE)
        //         .sub(EXPECTED_PNL)
        //       dsu.mock.transferFrom
        //         .withArgs(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
        //         .returns(true)
        //       factory.operators.whenCalledWith(user.address, liquidator.address).returns(false)
        //       await expect(market.connect(liquidator).update(user.address, 0, 0, 0, 0))
        //         .to.emit(market, 'Updated')
        //         .withArgs(user.address, 4, 0, 0, 0, 0)
        //
        //       expectAccountEq(await market.accounts(user.address), {
        //         latesttimestamp: 4,
        //         maker: 0,
        //         long: 0,
        //         short: 0,
        //         nextMaker: 0,
        //         nextLong: 0,
        //         nextShort: 0,
        //         collateral: 0,
        //         reward: EXPECTED_REWARD.mul(2).mul(2),
        //         protection: false,
        //       })
        //     })
        //   })
        // })
        //
        // context('closed', async () => {
        //   beforeEach(async () => {
        //     await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
        //     dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        //     await market.connect(userB).update(userB.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        //
        //     oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        //     oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        //     oracle.mock.request.withArgs().returns(ORACLE_VERSION_2)
        //
        //     await settle(market, user)
        //     await settle(market, userB)
        //   })
        //
        //   it('zeroes PnL and fees (price change)', async () => {
        //     const marketParameter = { ...(await market.parameter()) }
        //     marketParameter.closed = true
        //     await market.updateParameter(marketParameter)
        //
        //     const oracleVersionHigherPrice_0 = {
        //       price: parse6decimal('125'),
        //       timestamp: TIMESTAMP + 7200,
        //       timestamp: 3,
        //     }
        //     const oracleVersionHigherPrice_1 = {
        //       price: parse6decimal('128'),
        //       timestamp: TIMESTAMP + 10800,
        //       timestamp: 4,
        //     }
        //     oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_0)
        //     oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice_0)
        //
        //     oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_1)
        //     oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice_1)
        //     oracle.mock.request.withArgs().returns(oracleVersionHigherPrice_1)
        //
        //     await settle(market, user)
        //     await settle(market, userB)
        //
        //     expectAccountEq(await market.accounts(user.address), {
        //       latesttimestamp: 4,
        //       maker: POSITION,
        //       long: 0,
        //       short: 0,
        //       nextMaker: POSITION,
        //       nextLong: 0,
        //       nextShort: 0,
        //       collateral: COLLATERAL,
        //       reward: 0,
        //       protection: false,
        //     })
        //     expectAccountEq(await market.accounts(userB.address), {
        //       latesttimestamp: 4,
        //       maker: 0,
        //       long: POSITION.div(2),
        //       short: 0,
        //       nextMaker: 0,
        //       nextLong: POSITION.div(2),
        //       nextShort: 0,
        //       collateral: COLLATERAL,
        //       reward: 0,
        //       protection: false,
        //     })
        //     expectPositionEq(await market.position(), {
        //       latesttimestamp: 4,
        //       maker: POSITION,
        //       long: POSITION.div(2),
        //       short: 0,
        //       makerNext: POSITION,
        //       longNext: POSITION.div(2),
        //       shortNext: 0,
        //     })
        //     expectVersionEq(await market.versions(3), {
        //       makerValue: { _value: 0 },
        //       longValue: { _value: 0 },
        //       shortValue: { _value: 0 },
        //       makerReward: { _value: 0 },
        //       longReward: { _value: 0 },
        //       shortReward: { _value: 0 },
        //     })
        //     expectVersionEq(await market.versions(4), {
        //       makerValue: { _value: 0 },
        //       longValue: { _value: 0 },
        //       shortValue: { _value: 0 },
        //       makerReward: { _value: 0 },
        //       longReward: { _value: 0 },
        //       shortReward: { _value: 0 },
        //     })
        //     expectFeeEq(await market.fee(), {
        //       protocol: 0,
        //       market: 0,
        //     })
        //   })
        // })
      })

      context('invariant violations', async () => {
        it('reverts if can liquidate', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('500')).returns(true)
          await expect(
            market.connect(user).update(user.address, parse6decimal('1000'), 0, 0, parse6decimal('500'), false),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientCollateralizationError')
        })

        it('reverts if paused', async () => {
          factory.paused.returns(true)
          await expect(
            market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'InstancePausedError')
        })

        it('reverts if over maker limit', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.makerLimit = POSITION.div(2)
          await market.updateRiskParameter(riskParameter)
          await expect(
            market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketMakerOverLimitError')
        })

        it('reverts if under efficiency limit', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.efficiencyLimit = parse6decimal('0.6')
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(user).update(user.address, POSITION.div(2), 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(userB).update(userB.address, 0, POSITION.div(2), 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false)

          await expect(
            market.connect(userB).update(userB.address, 0, POSITION, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
        })

        it('reverts if too many pending orders', async () => {
          const protocolParameter = { ...(await factory.parameter()) }
          protocolParameter.maxPendingIds = BigNumber.from(3)
          factory.parameter.returns(protocolParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(user).update(user.address, POSITION.div(2), 0, 0, COLLATERAL, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 1])
          oracle.request.returns()

          await market.connect(user).update(user.address, POSITION.add(1), 0, 0, 0, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 2])
          oracle.request.returns()

          await market.connect(user).update(user.address, POSITION.add(2), 0, 0, 0, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 3])
          oracle.request.returns()

          await expect(
            market.connect(user).update(user.address, POSITION.add(3), 0, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketExceedsPendingIdLimitError')
        })

        it('reverts if not single sided', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          await expect(
            market.connect(user).update(user.address, POSITION, POSITION, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await expect(
            market.connect(user).update(user.address, POSITION, 0, POSITION, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await expect(
            market.connect(user).update(user.address, 0, POSITION, POSITION, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')
        })

        it('reverts if protection invalid', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 1])
          oracle.request.returns()

          await expect(market.connect(user).update(user.address, 0, 0, 0, 0, true)).to.be.revertedWithCustomError(
            market,
            'MarketInvalidProtectionError',
          )
        })

        it('reverts if insufficient collateral', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(user).update(user.address, 0, 0, 0, COLLATERAL, false)

          await expect(
            market.connect(user).update(user.address, 0, 0, 0, COLLATERAL.add(1).mul(-1), false),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientCollateralError')
        })

        it('reverts if price is stale', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = 7200
          await market.connect(owner).updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp - 1])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await expect(
            market.connect(user).update(user.address, POSITION, 0, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')
        })

        it('reverts if under minimum maintenance', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('1')).returns(true)
          await expect(
            market.connect(user).update(user.address, 1, 0, 0, parse6decimal('99'), false),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientCollateralizationError')
        })

        it('reverts if closed', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.closed = true
          await market.updateParameter(marketParameter)
          await expect(
            market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketClosedError')
        })

        it('reverts if taker > maker', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)

          await expect(
            market.connect(userB).update(userB.address, 0, POSITION.add(1), 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, `MarketInsufficientLiquidityError`)
        })

        context('in liquidation', async () => {
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('225')

          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
            await market.connect(userB).update(userB.address, POSITION, 0, 0, parse6decimal('450'), false)
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

            const oracleVersionHigherPrice = {
              price: parse6decimal('150'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, oracleVersionHigherPrice.timestamp + 3600])
            oracle.request.returns()

            dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
          })

          it('it reverts if not protected', async () => {
            await expect(market.connect(userB).update(userB.address, 0, 0, 0, 0, false)).to.be.revertedWithCustomError(
              market,
              'MarketInsufficientCollateralizationError',
            )
          })

          it('it reverts if already liquidated', async () => {
            await market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

            await expect(
              market.connect(userB).update(userB.address, 0, POSITION, 0, COLLATERAL, false),
            ).to.be.revertedWithCustomError(market, 'MarketProtectedError')
          })

          it('it reverts if liquidation fee too high', async () => {
            await expect(
              market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.add(1).mul(-1), true),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })

          it('it reverts if position doesnt close', async () => {
            await expect(
              market.connect(liquidator).update(userB.address, 1, 0, 0, EXPECTED_LIQUIDATION_FEE.add(1).mul(-1), true),
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
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              await market.connect(user).update(user.address, 0, POSITION, 0, COLLATERAL, false)
              await market.connect(userC).update(userC.address, 0, 0, POSITION.mul(2), COLLATERAL, false)
            })

            it('allows closing when takerCloseAlways', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(marketParameter)

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false)).to.not.be.reverted
            })

            it('disallows closing when not takerCloseAlways', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false)).to.revertedWithCustomError(
                market,
                'MarketInsufficientLiquidityError',
              )
            })

            it('disallows short increasing (efficiency)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.5')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market.connect(userC).update(userC.address, 0, 0, POSITION.mul(2).add(1), 0, false),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })

            it('disallows short increasing (liquidity)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.3')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market.connect(userC).update(userC.address, 0, 0, POSITION.mul(2).add(1), 0, false),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })
          })

          context('closing short', async () => {
            beforeEach(async () => {
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              await market.connect(user).update(user.address, 0, 0, POSITION, COLLATERAL, false)
              await market.connect(userC).update(userC.address, 0, POSITION.mul(2), 0, COLLATERAL, false)
            })

            it('allows closing when takerCloseAlways', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(marketParameter)

              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false)).to.not.be.reverted
            })

            it('disallows closing when not takerCloseAlways', async () => {
              await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false)).to.revertedWithCustomError(
                market,
                'MarketInsufficientLiquidityError',
              )
            })

            it('disallows long increasing (efficiency)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.5')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market.connect(userC).update(userC.address, 0, POSITION.mul(2).add(1), 0, 0, false),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })

            it('disallows long increasing (liquidity)', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerCloseAlways = true
              await market.updateParameter(marketParameter)

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.3')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market.connect(userC).update(userC.address, 0, POSITION.mul(2).add(1), 0, 0, false),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })
          })

          context('closing maker', async () => {
            beforeEach(async () => {
              await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
              await market.connect(user).update(user.address, 0, 0, POSITION, COLLATERAL, false)
              await market.connect(userC).update(userC.address, 0, POSITION.mul(2), 0, COLLATERAL, false)
            })

            it('allows closing when makerCloseAlways', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.makerCloseAlways = true
              await market.updateParameter(marketParameter)

              await expect(market.connect(userB).update(userB.address, 0, 0, 0, 0, false)).to.not.be.reverted
            })

            it('disallows closing when not makerCloseAlways', async () => {
              await expect(market.connect(userB).update(userB.address, 0, 0, 0, 0, false)).to.revertedWithCustomError(
                market,
                'MarketEfficiencyUnderLimitError',
              )
            })
          })
        })
      })

      context('liquidation w/ under min collateral', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('195')).returns(true)
          await market.connect(user).update(user.address, 0, POSITION.div(2), 0, parse6decimal('195'), false)
        })

        it('properly charges liquidation fee', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('80').mul(5)
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10') // 6.45 -> under minimum

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

          await expect(market.connect(liquidator).update(user.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: parse6decimal('195')
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
              .sub(EXPECTED_PNL)
              .sub(EXPECTED_LIQUIDATION_FEE),
            reward: EXPECTED_REWARD.mul(2),
            protection: ORACLE_VERSION_4.timestamp,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPositions(user.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE),
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 3,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
              .add(EXPECTED_PNL)
              .sub(8), // loss of precision
            reward: EXPECTED_REWARD.mul(3),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 3,
            protocolFee: totalFee.div(2).sub(3), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            },
            longValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
            longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
            shortReward: { _value: 0 },
          })
        })
      })

      context('liquidation w/ above max liquidation fee', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('195')).returns(true)
          await market.connect(user).update(user.address, 0, 0, POSITION.div(2), parse6decimal('195'), false)
        })

        it('default', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.maxLiquidationFee = parse6decimal('10')
          await market.connect(owner).updateRiskParameter(riskParameter)

          const EXPECTED_PNL = parse6decimal('27').mul(5)
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10') // 22.5

          const oracleVersionLowerPrice = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await expect(market.connect(liquidator).update(user.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          const oracleVersionLowerPrice2 = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 14400,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersionLowerPrice2.timestamp).returns(oracleVersionLowerPrice2)
          oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 5,
            collateral: parse6decimal('195')
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
              .sub(EXPECTED_INTEREST_5_150)
              .sub(EXPECTED_LIQUIDATION_FEE),
            reward: EXPECTED_REWARD.mul(2),
            protection: ORACLE_VERSION_4.timestamp,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 4,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 5), {
            ...DEFAULT_POSITION,
            id: 5,
            timestamp: ORACLE_VERSION_6.timestamp,
            delta: parse6decimal('195').sub(EXPECTED_LIQUIDATION_FEE),
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 5,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
              .sub(22), // loss of precision
            reward: EXPECTED_REWARD.mul(3).mul(3),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 4,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 5), {
            ...DEFAULT_POSITION,
            id: 5,
            timestamp: ORACLE_VERSION_6.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_2_5_150)
            .add(EXPECTED_INTEREST_FEE_5_150)
          expectGlobalEq(await market.global(), {
            currentId: 5,
            protocolFee: totalFee.div(2).sub(1), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(1), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(1), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(4), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 4,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPosition(5), {
            ...DEFAULT_POSITION,
            id: 5,
            timestamp: ORACLE_VERSION_6.timestamp,
            maker: POSITION,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            makerValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            },
            longValue: { _value: 0 },
            shortValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: EXPECTED_REWARD.div(5) },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(2) },
            longReward: { _value: 0 },
            shortReward: { _value: EXPECTED_REWARD.div(5).mul(2) },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
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
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10).mul(3) },
            longReward: { _value: 0 },
            shortReward: { _value: EXPECTED_REWARD.div(5).mul(2) },
          })
        })
      })

      context('invalid oracle version', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        })

        it('settles the position w/o change', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.takerFee = parse6decimal('0.01')
          riskParameter.takerImpactFee = parse6decimal('0.004')
          riskParameter.takerSkewFee = parse6decimal('0.002')
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 2,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(user.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 2,
            collateral: COLLATERAL,
            reward: EXPECTED_REWARD.mul(3),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 3,
            protocolFee: 0,
            oracleFee: SETTLEMENT_FEE,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPosition(2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })

        it('settles valid version after', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.takerFee = parse6decimal('0.01')
          riskParameter.takerImpactFee = parse6decimal('0.004')
          riskParameter.takerSkewFee = parse6decimal('0.002')
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
          const TAKER_FEE_FEE = TAKER_FEE.div(10)
          const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.returns()

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, 0, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, POSITION.div(2), 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4 })
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: COLLATERAL.sub(TAKER_FEE).sub(SETTLEMENT_FEE.mul(2)),
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(user.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectPositionEq(await market.pendingPositions(user.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            long: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 2,
            collateral: COLLATERAL.add(TAKER_FEE_WITHOUT_FEE),
            reward: EXPECTED_REWARD.mul(3).mul(2),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 4,
            protocolFee: TAKER_FEE_FEE.div(2),
            oracleFee: TAKER_FEE_FEE.div(2).div(10).add(SETTLEMENT_FEE.mul(2)),
            riskFee: TAKER_FEE_FEE.div(2).div(10),
            donation: TAKER_FEE_FEE.div(2).mul(8).div(10),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPosition(2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectPositionEq(await market.pendingPosition(4), {
            ...DEFAULT_POSITION,
            id: 4,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            makerValue: { _value: TAKER_FEE_WITHOUT_FEE.div(10) },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })

        it('settles invalid version after', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.takerFee = parse6decimal('0.01')
          riskParameter.takerImpactFee = parse6decimal('0.004')
          riskParameter.takerSkewFee = parse6decimal('0.002')
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
          const TAKER_FEE_FEE = TAKER_FEE.div(10)
          const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.returns()

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, 0, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, POSITION.div(2), 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4, valid: false })
          oracle.status.returns([{ ...ORACLE_VERSION_4, valid: false }, ORACLE_VERSION_5.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE.mul(2)),
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(user.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(user.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 2,
            collateral: COLLATERAL,
            reward: EXPECTED_REWARD.mul(3).mul(2),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 4,
            protocolFee: 0,
            oracleFee: SETTLEMENT_FEE.mul(2),
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPosition(2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectPositionEq(await market.pendingPosition(4), {
            ...DEFAULT_POSITION,
            id: 4,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            fee: TAKER_FEE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })

        it('settles invalid then valid version at once', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await settle(market, user)

          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.takerFee = parse6decimal('0.01')
          riskParameter.takerImpactFee = parse6decimal('0.004')
          riskParameter.takerSkewFee = parse6decimal('0.002')
          riskParameter.staleAfter = BigNumber.from(9600)
          await market.updateRiskParameter(riskParameter)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settlementFee = parse6decimal('0.50')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.004 + 0.002) * price
          const TAKER_FEE_FEE = TAKER_FEE.div(10)
          const TAKER_FEE_WITHOUT_FEE = TAKER_FEE.sub(TAKER_FEE_FEE)
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_3.timestamp, 0, POSITION.div(2), 0, COLLATERAL, false)

          oracle.status.returns([{ ...ORACLE_VERSION_2 }, ORACLE_VERSION_4.timestamp])
          oracle.request.returns()

          await expect(market.connect(user).update(user.address, 0, POSITION.div(2), 0, 0, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_4.timestamp, 0, POSITION.div(2), 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns({ ...ORACLE_VERSION_3, valid: false })
          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns({ ...ORACLE_VERSION_4 })
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE), // does not charge fee if both were pending at once
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
            fee: TAKER_FEE,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(user.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(user.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            long: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 2,
            collateral: COLLATERAL,
            reward: EXPECTED_REWARD.mul(3).mul(2),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 4,
            protocolFee: 0,
            oracleFee: SETTLEMENT_FEE,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPosition(2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            short: 0,
            fee: TAKER_FEE,
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPosition(4), {
            ...DEFAULT_POSITION,
            id: 4,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })
      })

      context('skew flip', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
        })

        it('doesnt flip funding default', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await market.connect(user).update(user.address, 0, 0, POSITION.div(2), 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123),
            reward: EXPECTED_REWARD.mul(2).add(EXPECTED_REWARD),
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            short: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPositions(user.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            short: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 2,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(16), // loss of precision
            reward: EXPECTED_REWARD.mul(3).mul(2),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_1_5_123)
            .add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 3,
            protocolFee: totalFee.div(2).sub(6), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
            makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
            longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
            shortReward: { _value: EXPECTED_REWARD.div(5) },
          })
        })

        it('flips funding when makerReceiveOnly', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.makerReceiveOnly = true
          await market.updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await market.connect(user).update(user.address, 0, 0, POSITION.div(2), 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns(ORACLE_VERSION_4)
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123),
            reward: EXPECTED_REWARD.mul(2).add(EXPECTED_REWARD),
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            short: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPositions(user.address, 3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            short: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 2,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(16), // loss of precision
            reward: EXPECTED_REWARD.mul(3).mul(2),
            protection: 0,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 2), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_1_5_123)
            .add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            currentId: 3,
            protocolFee: totalFee.div(2).sub(6), // loss of precision
            oracleFee: totalFee.div(2).div(10).sub(2), // loss of precision
            riskFee: totalFee.div(2).div(10).sub(2), // loss of precision
            donation: totalFee.div(2).mul(8).div(10).add(1), // loss of precision
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 2,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectPositionEq(await market.pendingPosition(3), {
            ...DEFAULT_POSITION,
            id: 3,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
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
            makerReward: { _value: EXPECTED_REWARD.mul(3).mul(2).div(10) },
            longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
            shortReward: { _value: EXPECTED_REWARD.div(5) },
          })
        })
      })

      context('operator', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(operator.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('opens the position when operator', async () => {
          factory.operators.whenCalledWith(user.address, operator.address).returns(true)
          await expect(market.connect(operator).update(user.address, POSITION, 0, 0, COLLATERAL, false))
            .to.emit(market, 'Updated')
            .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION, 0, 0, COLLATERAL, false)

          expectLocalEq(await market.locals(user.address), {
            currentId: 1,
            collateral: COLLATERAL,
            reward: 0,
            protection: 0,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            currentId: 1,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            id: 0,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectPositionEq(await market.pendingPosition(1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            makerValue: { _value: 0 },
            longValue: { _value: 0 },
            shortValue: { _value: 0 },
            makerReward: { _value: 0 },
            longReward: { _value: 0 },
            shortReward: { _value: 0 },
          })
        })

        it('reverts when not operator', async () => {
          factory.operators.whenCalledWith(user.address, operator.address).returns(false)
          await expect(
            market.connect(operator).update(user.address, POSITION, 0, 0, COLLATERAL, false),
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
          await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.returns()

          await market.connect(user).update(user.address, 0, 0, 0, 0, false)
          await market.connect(userB).update(userB.address, 0, 0, 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
            reward: EXPECTED_REWARD.mul(2),
            protection: 0,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 3,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(8), // loss of precision
            reward: EXPECTED_REWARD.mul(3),
            protection: 0,
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
          await market.connect(user).update(user.address, 0, 0, 0, ethers.constants.MinInt256, false)
          await market.connect(userB).update(userB.address, 0, 0, 0, ethers.constants.MinInt256, false)

          expectLocalEq(await market.locals(user.address), {
            currentId: 3,
            collateral: 0,
            reward: EXPECTED_REWARD.mul(2),
            protection: 0,
          })
          expectLocalEq(await market.locals(userB.address), {
            currentId: 3,
            collateral: 0,
            reward: EXPECTED_REWARD.mul(3),
            protection: 0,
          })
        })

        it('keeps same position on MAX', async () => {
          await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)
          await market.connect(userC).update(userC.address, 0, 0, POSITION.div(2), COLLATERAL, false)

          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            long: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userC.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            short: POSITION.div(2),
            delta: COLLATERAL,
          })

          await market.connect(user).update(user.address, 0, ethers.constants.MaxUint256, 0, 0, false)
          await market.connect(userB).update(userB.address, ethers.constants.MaxUint256, 0, 0, 0, false)
          await market.connect(userC).update(userC.address, 0, 0, ethers.constants.MaxUint256, 0, false)

          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            long: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userC.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            short: POSITION.div(2),
            delta: COLLATERAL,
          })

          await market
            .connect(user)
            .update(
              user.address,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              0,
              false,
            )
          await market
            .connect(userB)
            .update(
              userB.address,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              0,
              false,
            )
          await market
            .connect(userC)
            .update(
              userC.address,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              ethers.constants.MaxUint256,
              0,
              false,
            )

          expectPositionEq(await market.pendingPositions(user.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            long: POSITION.div(2),
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userB.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            maker: POSITION,
            delta: COLLATERAL,
          })
          expectPositionEq(await market.pendingPositions(userC.address, 1), {
            ...DEFAULT_POSITION,
            id: 1,
            timestamp: ORACLE_VERSION_2.timestamp,
            short: POSITION.div(2),
            delta: COLLATERAL,
          })
        })
      })

      context('payoff', async () => {
        let marketPayoff: Market

        // rate_0 = 0
        // rate_1 = rate_0 + (elapsed * skew / k)
        // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        // (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 15.129 / (86400 * 365) = 390
        const EXPECTED_FUNDING_1_5_123_P2 = BigNumber.from(390)
        const EXPECTED_FUNDING_FEE_1_5_123_P2 = BigNumber.from(40) // (388 + 19) = 407 / 5 -> 82 * 5 -> 410 - 390 -> 20 * 2 -> 40
        const EXPECTED_FUNDING_WITH_FEE_1_5_123_P2 = EXPECTED_FUNDING_1_5_123_P2.add(
          EXPECTED_FUNDING_FEE_1_5_123_P2.div(2),
        )
        const EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_P2 = EXPECTED_FUNDING_1_5_123_P2.sub(
          EXPECTED_FUNDING_FEE_1_5_123_P2.div(2),
        )

        // rate * elapsed * utilization * min(maker, taker) * price
        // (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 15.129 = 865
        const EXPECTED_INTEREST_5_123_P2 = BigNumber.from(865)
        const EXPECTED_INTEREST_FEE_5_123_P2 = EXPECTED_INTEREST_5_123_P2.div(10)
        const EXPECTED_INTEREST_WITHOUT_FEE_5_123_P2 = EXPECTED_INTEREST_5_123_P2.sub(EXPECTED_INTEREST_FEE_5_123_P2)

        beforeEach(async () => {
          marketPayoff = await new Market__factory(owner).deploy()
          const payoff = await new MilliPowerTwo__factory(owner).deploy()
          marketDefinition.payoff = payoff.address
          await marketPayoff.connect(factorySigner).initialize(marketDefinition, riskParameter)
          await marketPayoff.connect(owner).updateReward(reward.address)
          await marketPayoff.connect(owner).updateParameter(marketParameter)

          dsu.transferFrom.whenCalledWith(user.address, marketPayoff.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('long', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, marketPayoff.address, COLLATERAL.mul(1e12)).returns(true)
            await marketPayoff.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
            await marketPayoff.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(marketPayoff, user)
            await settle(marketPayoff, userB)
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('-0.496').mul(5) // maker pnl

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await settle(marketPayoff, user)
            await settle(marketPayoff, userB)

            expectLocalEq(await marketPayoff.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123_P2)
                .sub(EXPECTED_INTEREST_5_123_P2),
              reward: EXPECTED_REWARD.mul(2),
              protection: 0,
            })
            expectPositionEq(await marketPayoff.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectPositionEq(await marketPayoff.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await marketPayoff.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_P2)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123_P2)
                .sub(19), // loss of precision
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await marketPayoff.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await marketPayoff.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123_P2.add(EXPECTED_INTEREST_FEE_5_123_P2)
            expectGlobalEq(await marketPayoff.global(), {
              currentId: 3,
              protocolFee: totalFee.div(2).sub(1), // loss of precision
              oracleFee: totalFee.div(2).div(10),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10),
            })
            expectPositionEq(await marketPayoff.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectPositionEq(await marketPayoff.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectVersionEq(await marketPayoff.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_P2)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123_P2)
                  .div(10)
                  .sub(2), // loss of precision
              },
              longValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123_P2)
                  .add(EXPECTED_INTEREST_5_123_P2)
                  .div(5)
                  .mul(-1),
              },
              shortValue: { _value: 0 },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
              shortReward: { _value: 0 },
            })
          })
        })

        context('short', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, marketPayoff.address, COLLATERAL.mul(1e12)).returns(true)
            await marketPayoff.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
            await marketPayoff.connect(user).update(user.address, 0, 0, POSITION.div(2), COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(marketPayoff, user)
            await settle(marketPayoff, userB)
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('0.496').mul(5) // maker pnl

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await settle(marketPayoff, user)
            await settle(marketPayoff, userB)

            expectLocalEq(await marketPayoff.locals(user.address), {
              currentId: 3,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123_P2)
                .sub(EXPECTED_INTEREST_5_123_P2),
              reward: EXPECTED_REWARD,
              protection: 0,
            })
            expectPositionEq(await marketPayoff.positions(user.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectPositionEq(await marketPayoff.pendingPositions(user.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              short: POSITION.div(2),
              delta: COLLATERAL,
            })
            expectLocalEq(await marketPayoff.locals(userB.address), {
              currentId: 3,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_P2)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123_P2)
                .sub(19), // loss of precision
              reward: EXPECTED_REWARD.mul(3),
              protection: 0,
            })
            expectPositionEq(await marketPayoff.positions(userB.address), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectPositionEq(await marketPayoff.pendingPositions(userB.address, 3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              delta: COLLATERAL,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123_P2.add(EXPECTED_INTEREST_FEE_5_123_P2)
            expectGlobalEq(await marketPayoff.global(), {
              currentId: 3,
              protocolFee: totalFee.div(2).sub(1), // loss of precision
              oracleFee: totalFee.div(2).div(10),
              riskFee: totalFee.div(2).div(10),
              donation: totalFee.div(2).mul(8).div(10),
            })
            expectPositionEq(await marketPayoff.position(), {
              ...DEFAULT_POSITION,
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectPositionEq(await marketPayoff.pendingPosition(3), {
              ...DEFAULT_POSITION,
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectVersionEq(await marketPayoff.versions(ORACLE_VERSION_3.timestamp), {
              makerValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_P2)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123_P2)
                  .div(10)
                  .sub(1), // loss of precision
              },
              longValue: { _value: 0 },
              shortValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123_P2)
                  .add(EXPECTED_INTEREST_5_123_P2)
                  .div(5)
                  .mul(-1),
              },
              makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
              longReward: { _value: 0 },
              shortReward: { _value: EXPECTED_REWARD.div(5) },
            })
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
        await market.connect(owner).updateReward(reward.address)
        await market.updateParameter({
          ...marketParameter,
          riskFee: parse6decimal('0.2'),
          oracleFee: parse6decimal('0.1'),
        })

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)

        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.returns()

        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

        oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
        oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
        oracle.request.returns()

        await settle(market, user)
        await settle(market, userB)

        await market.updateBeneficiary(beneficiary.address)
        await market.updateCoordinator(coordinator.address)
      })

      it('claims fee (protocol)', async () => {
        dsu.transfer.whenCalledWith(factory.address, PROTOCOL_FEE.mul(1e12)).returns(true)

        await expect(market.connect(factorySigner).claimFee())
          .to.emit(market, 'FeeClaimed')
          .withArgs(factory.address, PROTOCOL_FEE)

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

    describe('#claimReward', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateReward(reward.address)
        await market.connect(owner).updateParameter(marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns(ORACLE_VERSION_0)

        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns(ORACLE_VERSION_1)
        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.returns()

        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL, false)
        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)

        oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns(ORACLE_VERSION_3)
        oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
        oracle.request.returns()

        await settle(market, user)
        await settle(market, userB)

        await market.updateBeneficiary(beneficiary.address)

        expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
          makerValue: { _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10) },
          longValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
          shortValue: { _value: 0 },
          makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
          longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
          shortReward: { _value: 0 },
        })
      })

      it('claims reward', async () => {
        await reward.transfer.whenCalledWith(user.address, EXPECTED_REWARD.mul(2).mul(1e12)).returns(true)

        await expect(market.connect(user).claimReward())
          .to.emit(market, 'RewardClaimed')
          .withArgs(user.address, EXPECTED_REWARD.mul(2))

        expect((await market.locals(user.address)).reward).to.equal(0)
      })

      it('claims reward (none)', async () => {
        await reward.transfer.whenCalledWith(userC.address, 0).returns(true)

        await expect(market.connect(userC).claimReward()).to.emit(market, 'RewardClaimed').withArgs(userC.address, 0)
      })
    })
  })
})
