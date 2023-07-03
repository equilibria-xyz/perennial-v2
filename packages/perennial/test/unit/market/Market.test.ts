import { smock, FakeContract } from '@defi-wonderland/smock'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

//TODO (coverage hint): maxPendingId test
//TODO (coverage hint): invalid version test
//TODO (coverage hint): multi-version test w/ collateral change
//TODO (coverage hint): makerFee coverage
//TODO (coverage hint): skew/impactFee coverage
//TODO (coverage hint): makerReceiveOnly coverage
//TODO (coverage hint): settlementFee/oracleFee/riskFee coverage
//TODO (coverage hint): magic values

import { impersonate } from '../../../../common/testutil'

import { Market, Market__factory, IOracleProvider, IERC20Metadata, IMarketFactory } from '../../../types/generated'
import {
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
} from '../../../../common/testutil/types'
import { IMarket, MarketParameterStruct, RiskParameterStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

const POSITION = parse6decimal('10.000')
const COLLATERAL = parse6decimal('10000')
const TIMESTAMP = 1636401093
const PRICE = parse6decimal('123')

const ORACLE_VERSION_0 = {
  price: 0,
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
const EXPECTED_FUNDING_FEE_1_5_123 = BigNumber.from(320) // (3157 + 157) = 3316 / 5 -> 664 * 5 -> 3320
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
  await market
    .connect(account)
    .update(account.address, currentPosition.maker, currentPosition.long, currentPosition.short, 0, false)
}

describe.only('Market', () => {
  let protocolTreasury: SignerWithAddress
  let owner: SignerWithAddress
  let beneficiary: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let liquidator: SignerWithAddress
  let operator: SignerWithAddress
  let factorySigner: SignerWithAddress
  let factory: FakeContract<IMarketFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>
  let reward: FakeContract<IERC20Metadata>

  let market: Market
  let marketDefinition: IMarket.MarketDefinitionStruct
  let riskParameter: RiskParameterStruct
  let marketParameter: MarketParameterStruct

  beforeEach(async () => {
    ;[protocolTreasury, owner, beneficiary, user, userB, userC, liquidator, operator] = await ethers.getSigners()
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    reward = await smock.fake<IERC20Metadata>('IERC20Metadata')

    factory = await smock.fake<IMarketFactory>('IMarketFactory')
    factorySigner = await impersonate.impersonateWithBalance(factory.address, utils.parseEther('10'))
    factory.owner.returns(owner.address)
    factory.parameter.returns({
      protocolFee: parse6decimal('0.50'),
      liquidationFee: parse6decimal('0.10'),
      maxLiquidationFee: parse6decimal('1000'),
      minCollateral: parse6decimal('100'),
      settlementFee: parse6decimal('0.00'),
      maxPendingIds: 5,
    })

    marketDefinition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: reward.address,
      oracle: oracle.address,
      payoff: constants.AddressZero,
    }
    riskParameter = {
      maintenance: parse6decimal('0.3'),
      takerFee: 0,
      takerSkewFee: 0,
      takerImpactFee: 0,
      makerFee: 0,
      makerSkewFee: 0,
      makerImpactFee: 0,
      makerLimit: parse6decimal('1000'),
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
      makerRewardRate: parse6decimal('0.3'),
      longRewardRate: parse6decimal('0.2'),
      shortRewardRate: parse6decimal('0.1'),
      makerReceiveOnly: false,
    }
    marketParameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      oracleFee: 0,
      riskFee: 0,
      positionFee: 0,
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
      expect(await market.reward()).to.equal(reward.address)
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
      expect(riskParameterResult.makerSkewFee).to.equal(riskParameter.makerSkewFee)
      expect(riskParameterResult.makerImpactFee).to.equal(riskParameter.makerImpactFee)
      expect(riskParameterResult.makerLimit).to.equal(riskParameter.makerLimit)
      expect(riskParameterResult.utilizationCurve.minRate).to.equal(riskParameter.utilizationCurve.minRate)
      expect(riskParameterResult.utilizationCurve.targetRate).to.equal(riskParameter.utilizationCurve.targetRate)
      expect(riskParameterResult.utilizationCurve.maxRate).to.equal(riskParameter.utilizationCurve.maxRate)
      expect(riskParameterResult.utilizationCurve.targetUtilization).to.equal(
        riskParameter.utilizationCurve.targetUtilization,
      )
      expect(riskParameterResult.pController.k).to.equal(riskParameter.pController.k)
      expect(riskParameterResult.pController.max).to.equal(riskParameter.pController.max)
      expect(riskParameterResult.makerRewardRate).to.equal(riskParameter.makerRewardRate)
      expect(riskParameterResult.shortRewardRate).to.equal(riskParameter.shortRewardRate)
      expect(riskParameterResult.makerReceiveOnly).to.equal(riskParameter.makerReceiveOnly)

      const marketParameterResult = await market.parameter()
      expect(marketParameterResult.fundingFee).to.equal(0)
      expect(marketParameterResult.interestFee).to.equal(0)
      expect(marketParameterResult.positionFee).to.equal(0)
      expect(marketParameterResult.closed).to.equal(false)
    })

    it('reverts if already initialized', async () => {
      await market.initialize(marketDefinition, riskParameter)
      await expect(market.initialize(marketDefinition, riskParameter))
        .to.be.revertedWithCustomError(market, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#updateReward', async () => {
    beforeEach(async () => {
      const marketDefinitionNoReward = { ...marketDefinition }
      marketDefinitionNoReward.reward = constants.AddressZero
      await market.connect(factorySigner).initialize(marketDefinitionNoReward, riskParameter)
    })

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

    it('reverts if not owner', async () => {
      await expect(market.connect(user).updateReward(beneficiary.address)).to.be.revertedWithCustomError(
        market,
        'InstanceNotOwnerError',
      )
    })
  })

  context('already initialized', async () => {
    beforeEach(async () => {
      await market.connect(factorySigner).initialize(marketDefinition, riskParameter)
      await market.connect(owner).updateParameter(marketParameter)
    })

    describe('#updateParameter', async () => {
      it('updates the parameters', async () => {
        const newMarketParameter = {
          fundingFee: parse6decimal('0.3'),
          interestFee: parse6decimal('0.2'),
          positionFee: parse6decimal('0.1'),
          oracleFee: parse6decimal('0.4'),
          riskFee: parse6decimal('0.5'),
          closed: true,
        }

        await expect(market.connect(owner).updateParameter(newMarketParameter))
          .to.emit(market, 'ParameterUpdated')
          .withArgs(newMarketParameter)

        const marketParameter = await market.parameter()
        expect(marketParameter.fundingFee).to.equal(newMarketParameter.fundingFee)
        expect(marketParameter.interestFee).to.equal(newMarketParameter.interestFee)
        expect(marketParameter.positionFee).to.equal(newMarketParameter.positionFee)
        expect(marketParameter.oracleFee).to.equal(newMarketParameter.oracleFee)
        expect(marketParameter.riskFee).to.equal(newMarketParameter.riskFee)
        expect(marketParameter.closed).to.equal(newMarketParameter.closed)
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateParameter(marketParameter)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateRiskParameter', async () => {
      it('updates the parameters', async () => {
        const newRiskParameter = {
          maintenance: parse6decimal('0.4'),

          takerFee: parse6decimal('0.1'),
          takerSkewFee: parse6decimal('0.04'),
          takerImpactFee: parse6decimal('0.03'),
          makerFee: parse6decimal('0.05'),
          makerSkewFee: parse6decimal('0.02'),
          makerImpactFee: parse6decimal('0.01'),

          makerLiquidity: parse6decimal('0.1'),
          makerLimit: parse6decimal('2000'),
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
          makerRewardRate: parse6decimal('0.1'),
          longRewardRate: parse6decimal('0.1'),
          shortRewardRate: parse6decimal('0.1'),
          makerReceiveOnly: true,
        }

        await expect(market.connect(owner).updateRiskParameter(newRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        const riskParameter = await market.riskParameter()
        expect(riskParameter.maintenance).to.equal(newRiskParameter.maintenance)
        expect(riskParameter.takerFee).to.equal(newRiskParameter.takerFee)
        expect(riskParameter.takerSkewFee).to.equal(newRiskParameter.takerSkewFee)
        expect(riskParameter.takerImpactFee).to.equal(newRiskParameter.takerImpactFee)
        expect(riskParameter.makerFee).to.equal(newRiskParameter.makerFee)
        expect(riskParameter.makerSkewFee).to.equal(newRiskParameter.makerSkewFee)
        expect(riskParameter.makerImpactFee).to.equal(newRiskParameter.makerImpactFee)
        expect(riskParameter.makerLimit).to.equal(newRiskParameter.makerLimit)
        expect(riskParameter.utilizationCurve.minRate).to.equal(newRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(newRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(newRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          newRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(newRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(newRiskParameter.pController.max)
        expect(riskParameter.makerRewardRate).to.equal(newRiskParameter.makerRewardRate)
        expect(riskParameter.shortRewardRate).to.equal(newRiskParameter.shortRewardRate)
        expect(riskParameter.makerReceiveOnly).to.equal(newRiskParameter.makerReceiveOnly)
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateParameter(marketParameter)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
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

    describe('#update / #settle', async () => {
      describe('passthrough market', async () => {
        beforeEach(async () => {
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
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
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
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
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
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
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
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 2), {
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 2,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(2), {
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
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
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
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
                .to.emit(market, 'Updated')
                .withArgs(user.address, ORACLE_VERSION_2.timestamp, POSITION, 0, 0, COLLATERAL, false)

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
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
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
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
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
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
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
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                fee: 0,
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
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 1,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(2), {
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
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
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
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
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION.div(2),
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 1,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 0,
                timestamp: ORACLE_VERSION_1.timestamp,
                maker: 0,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(1), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION.div(2),
                long: 0,
                short: 0,
                fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION.div(2),
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION.div(2),
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 4), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 4,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(4), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: POSITION,
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                await market.updateRiskParameter(riskParameter)

                const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

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
                    .sub(TAKER_FEE),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(TAKER_FEE)
                    .div(2)
                    .sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                await market.updateRiskParameter(riskParameter)

                const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

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
                    .sub(TAKER_FEE),
                  reward: EXPECTED_REWARD.mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(TAKER_FEE)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  makerValue: {
                    _value: TAKER_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: POSITION.div(4),
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(4),
                  short: 0,
                  fee: 0,
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: 0,
                    long: POSITION.div(2),
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 2,
                    protocolFee: 0,
                    oracleFee: 0,
                    riskFee: 0,
                    donation: 0,
                  })
                  expectPositionEq(await market.position(), {
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: POSITION,
                    long: POSITION.div(2),
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: 0,
                    long: POSITION.div(2),
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 2,
                    protocolFee: 0,
                    oracleFee: 0,
                    riskFee: 0,
                    donation: 0,
                  })
                  expectPositionEq(await market.position(), {
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: POSITION,
                    long: POSITION.div(2),
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: POSITION.div(4),
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: POSITION.div(4),
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 4), {
                    id: 4,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 4,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_FEE_5_123)
                      .add(EXPECTED_INTEREST_FEE_25_123)
                      .div(2)
                      .sub(1), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_FEE_5_123)
                      .add(EXPECTED_INTEREST_FEE_25_123)
                      .div(2),
                  })
                  expectPositionEq(await market.position(), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(4), {
                    id: 4,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                  await market.updateRiskParameter(riskParameter)

                  const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

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
                      .sub(TAKER_FEE),
                    reward: EXPECTED_REWARD.mul(2),
                    protection: 0,
                  })
                  expectPositionEq(await market.positions(user.address), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectLocalEq(await market.locals(userB.address), {
                    currentId: 2,
                    collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(TAKER_FEE)
                      .sub(8), // loss of precision
                    reward: EXPECTED_REWARD.mul(3).mul(2),
                    protection: 0,
                  })
                  expectPositionEq(await market.positions(userB.address), {
                    id: 1,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                    makerValue: {
                      _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                        .add(TAKER_FEE)
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
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
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

              const oracleVersionLowerPrice = {
                price: parse6decimal('121'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_PNL)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                oracleFee: 0,
                riskFee: 0,
                donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10),
                },
                longValue: {
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_5_123)
                    .div(5)
                    .mul(-1),
                },
                shortValue: { _value: 0 },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: EXPECTED_REWARD.mul(2).div(5) },
                shortReward: { _value: 0 },
              })
            })

            it('higher price same rate settle', async () => {
              const EXPECTED_PNL = parse6decimal('-2').mul(5) // maker pnl

              const oracleVersionHigherPrice = {
                price: parse6decimal('125'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_PNL)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD.mul(2),
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                oracleFee: 0,
                riskFee: 0,
                donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longValue: {
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_5_123)
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
                    .sub(EXPECTED_INTEREST_5_150),
                  reward: EXPECTED_REWARD.mul(2).mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 5,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_FEE_5_150)
                    .div(2)
                    .sub(1), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_FEE_5_150)
                    .div(2)
                    .add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                      .mul(-1),
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
                    .add(EXPECTED_PNL),
                  reward: EXPECTED_REWARD.mul(2).mul(3),
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION.div(4),
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userC.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION.div(4),
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 5,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                    .add(EXPECTED_FUNDING_FEE_2_5_150.add(EXPECTED_INTEREST_FEE_2))
                    .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
                    .div(2)
                    .sub(2), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                    .add(EXPECTED_FUNDING_FEE_2_5_150.add(EXPECTED_INTEREST_FEE_2))
                    .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
                    .div(2),
                })
                expectPositionEq(await market.position(), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION.div(4),
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION.div(4),
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                      .mul(-1),
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
                      .mul(-1),
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
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
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 4), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 5,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96))
                    .div(2)
                    .sub(4), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96))
                    .div(2)
                    .sub(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                factory.parameter.returns({
                  protocolFee: parse6decimal('0.50'),
                  liquidationFee: parse6decimal('0.10'),
                  maxLiquidationFee: parse6decimal('1000'),
                  minCollateral: parse6decimal('50'),
                  settlementFee: parse6decimal('0.00'),
                  maxPendingIds: 5,
                })

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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 4), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 3,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                fee: 0,
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION,
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                await market.updateRiskParameter(riskParameter)

                const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

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
                    .sub(TAKER_FEE),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 2,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(TAKER_FEE)
                    .div(2)
                    .sub(3), // no makers yet, taker fee is forwarded
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE).div(2).sub(2),
                })
                expectPositionEq(await market.position(), {
                  id: 1,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                await market.updateRiskParameter(riskParameter)

                const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

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
                    .sub(TAKER_FEE),
                  reward: EXPECTED_REWARD,
                  protection: 0,
                })
                expectPositionEq(await market.positions(user.address), {
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectLocalEq(await market.locals(userB.address), {
                  currentId: 2,
                  collateral: COLLATERAL.add(
                    TAKER_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)),
                  ).sub(8), // loss of precision
                  reward: EXPECTED_REWARD.mul(3).mul(2),
                  protection: 0,
                })
                expectPositionEq(await market.positions(userB.address), {
                  id: 1,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 2), {
                  id: 2,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision // no makers yet, taker fee is forwarded
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  makerValue: {
                    _value: TAKER_FEE.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(4),
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(4),
                  fee: 0,
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
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 1,
                  protocolFee: 0,
                  oracleFee: 0,
                  riskFee: 0,
                  donation: 0,
                })
                expectPositionEq(await market.position(), {
                  id: 0,
                  timestamp: ORACLE_VERSION_1.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(1), {
                  id: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: 0,
                    long: 0,
                    short: POSITION.div(2),
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 2,
                    protocolFee: 0,
                    oracleFee: 0,
                    riskFee: 0,
                    donation: 0,
                  })
                  expectPositionEq(await market.position(), {
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: POSITION.div(2),
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: 0,
                    long: 0,
                    short: POSITION.div(2),
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 2,
                    protocolFee: 0,
                    oracleFee: 0,
                    riskFee: 0,
                    donation: 0,
                  })
                  expectPositionEq(await market.position(), {
                    id: 1,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: POSITION.div(2),
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: 0,
                    long: 0,
                    short: POSITION.div(4),
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: POSITION.div(4),
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 4), {
                    id: 4,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 4,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_FEE_5_123)
                      .add(EXPECTED_INTEREST_FEE_25_123)
                      .div(2)
                      .sub(1), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_FEE_5_123)
                      .add(EXPECTED_INTEREST_FEE_25_123)
                      .div(2),
                  })
                  expectPositionEq(await market.position(), {
                    id: 3,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(4), {
                    id: 4,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                    id: 1,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
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
                  await market.updateRiskParameter(riskParameter)

                  const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

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
                      .sub(TAKER_FEE),
                    reward: EXPECTED_REWARD,
                    protection: 0,
                  })
                  expectPositionEq(await market.positions(user.address), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(user.address, 3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: 0,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectLocalEq(await market.locals(userB.address), {
                    currentId: 2,
                    collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(TAKER_FEE)
                      .sub(8), // loss of precision
                    reward: EXPECTED_REWARD.mul(3).mul(2),
                    protection: 0,
                  })
                  expectPositionEq(await market.positions(userB.address), {
                    id: 1,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPositions(userB.address, 2), {
                    id: 2,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectGlobalEq(await market.global(), {
                    currentId: 3,
                    protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                    oracleFee: 0,
                    riskFee: 0,
                    donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                  })
                  expectPositionEq(await market.position(), {
                    id: 2,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectPositionEq(await market.pendingPosition(3), {
                    id: 3,
                    timestamp: ORACLE_VERSION_5.timestamp,
                    maker: POSITION,
                    long: 0,
                    short: 0,
                    fee: 0,
                  })
                  expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                    makerValue: {
                      _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                        .add(TAKER_FEE)
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
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 2,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 2,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(2), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
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

              const oracleVersionLowerPrice = {
                price: parse6decimal('121'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionLowerPrice.timestamp).returns(oracleVersionLowerPrice)
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_PNL)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                oracleFee: 0,
                riskFee: 0,
                donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
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
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_5_123)
                    .div(5)
                    .mul(-1),
                },
                makerReward: { _value: EXPECTED_REWARD.mul(3).div(10) },
                longReward: { _value: 0 },
                shortReward: { _value: EXPECTED_REWARD.div(5) },
              })
            })

            it('higher price same rate settle', async () => {
              const EXPECTED_PNL = parse6decimal('2').mul(5) // maker pnl

              const oracleVersionHigherPrice = {
                price: parse6decimal('125'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at.whenCalledWith(oracleVersionHigherPrice.timestamp).returns(oracleVersionHigherPrice)
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                currentId: 3,
                collateral: COLLATERAL.sub(EXPECTED_PNL)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123),
                reward: EXPECTED_REWARD,
                protection: 0,
              })
              expectPositionEq(await market.positions(user.address), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                oracleFee: 0,
                riskFee: 0,
                donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                makerValue: {
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .div(10),
                },
                longValue: { _value: 0 },
                shortValue: {
                  _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_5_123)
                    .div(5)
                    .mul(-1),
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 5,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96))
                    .div(2)
                    .sub(4), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96))
                    .div(2)
                    .sub(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION.div(4),
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userC.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION.div(4),
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 5,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                    .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_2))
                    .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
                    .div(2)
                    .sub(5), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                    .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_2))
                    .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
                    .div(2)
                    .sub(3), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION.div(4),
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION.div(4),
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
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
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 4), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 5,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_FEE_5_150)
                    .div(2)
                    .sub(1), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                    .add(EXPECTED_FUNDING_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_FEE_5_150)
                    .div(2)
                    .add(1), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(5), {
                  id: 5,
                  timestamp: ORACLE_VERSION_6.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                factory.parameter.returns({
                  protocolFee: parse6decimal('0.50'),
                  liquidationFee: parse6decimal('0.10'),
                  maxLiquidationFee: parse6decimal('1000'),
                  minCollateral: parse6decimal('50'),
                  settlementFee: parse6decimal('0.00'),
                  maxPendingIds: 5,
                })

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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: 0,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(userB.address, 3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectGlobalEq(await market.global(), {
                  currentId: 3,
                  protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
                  oracleFee: 0,
                  riskFee: 0,
                  donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
                })
                expectPositionEq(await market.position(), {
                  id: 2,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: POSITION.div(2),
                  fee: 0,
                })
                expectPositionEq(await market.pendingPosition(3), {
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                  id: 3,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
                })
                expectPositionEq(await market.pendingPositions(user.address, 4), {
                  id: 4,
                  timestamp: ORACLE_VERSION_5.timestamp,
                  maker: 0,
                  long: 0,
                  short: 0,
                  fee: 0,
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
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(user.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                long: 0,
                short: 0,
                fee: 0,
              })
              expectLocalEq(await market.locals(userB.address), {
                currentId: 3,
                collateral: COLLATERAL,
                reward: 0,
                protection: 0,
              })
              expectPositionEq(await market.positions(userB.address), {
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPositions(userB.address, 3), {
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: 0,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectGlobalEq(await market.global(), {
                currentId: 3,
                protocolFee: 0,
                oracleFee: 0,
                riskFee: 0,
                donation: 0,
              })
              expectPositionEq(await market.position(), {
                id: 2,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
              })
              expectPositionEq(await market.pendingPosition(3), {
                id: 3,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                long: 0,
                short: POSITION.div(2),
                fee: 0,
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

          it('reverts if under collateral limit', async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('1')).returns(true)
            await expect(
              market.connect(user).update(user.address, 0, 0, 0, parse6decimal('1'), false),
            ).to.be.revertedWithCustomError(market, 'MarketCollateralBelowLimitError')
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
            await expect(
              market.connect(user).update(user.address, 0, POSITION.mul(4), 0, COLLATERAL, false),
            ).to.be.revertedWithCustomError(market, `MarketInsufficientLiquidityError`)
          })

          context('in liquidation', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
              await market.connect(userB).update(userB.address, POSITION, 0, 0, parse6decimal('450'), false)
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(user).update(user.address, 0, POSITION.div(2), 0, COLLATERAL, false)

              oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns(ORACLE_VERSION_2)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('45')

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
              await market.connect(liquidator).update(userB.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
            })

            it('it reverts', async () => {
              await expect(
                market.connect(userB).update(userB.address, 0, POSITION, 0, COLLATERAL, false),
              ).to.be.revertedWithCustomError(market, 'MarketProtectedError')
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
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: 0,
              long: POSITION.div(2),
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 3), {
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
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
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 3), {
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 3,
              protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3), // loss of precision
              oracleFee: 0,
              riskFee: 0,
              donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2), // loss of precision
            })
            expectPositionEq(await market.position(), {
              id: 2,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(3), {
              id: 3,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
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

            factory.parameter.returns({
              protocolFee: parse6decimal('0.50'),
              liquidationFee: parse6decimal('0.10'),
              maxLiquidationFee: parse6decimal('10'),
              minCollateral: parse6decimal('100'),
              settlementFee: parse6decimal('0.00'),
              maxPendingIds: 5,
            })

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
              id: 4,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 5), {
              id: 5,
              timestamp: ORACLE_VERSION_6.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
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
              id: 4,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(userB.address, 5), {
              id: 5,
              timestamp: ORACLE_VERSION_6.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 5,
              protocolFee: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
                .div(2)
                .sub(1), // loss of precision
              oracleFee: 0,
              riskFee: 0,
              donation: EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
                .div(2)
                .add(1), // loss of precision
            })
            expectPositionEq(await market.position(), {
              id: 4,
              timestamp: ORACLE_VERSION_5.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(5), {
              id: 5,
              timestamp: ORACLE_VERSION_6.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
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
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPositions(user.address, 1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectGlobalEq(await market.global(), {
              currentId: 1,
              protocolFee: 0,
              oracleFee: 0,
              riskFee: 0,
              donation: 0,
            })
            expectPositionEq(await market.position(), {
              id: 0,
              timestamp: ORACLE_VERSION_1.timestamp,
              maker: 0,
              long: 0,
              short: 0,
              fee: 0,
            })
            expectPositionEq(await market.pendingPosition(1), {
              id: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: 0,
              short: 0,
              fee: 0,
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
            ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowed')
          })
        })
      })

      // TODO (coverage hint): payoff market
    })

    describe('#claimFee', async () => {
      beforeEach(async () => {
        factory.treasury.returns(protocolTreasury.address)

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
      })

      it('claims fee (protocol)', async () => {
        dsu.transfer
          .whenCalledWith(
            protocolTreasury.address,
            EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3).mul(1e12),
          ) // loss of precision
          .returns(true)

        await expect(market.connect(protocolTreasury).claimProtocolFee())
          .to.emit(market, 'FeeClaimed')
          .withArgs(
            protocolTreasury.address,
            EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3),
          )

        expect((await market.global()).protocolFee).to.equal(0)
        expect((await market.global()).donation).to.equal(
          EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2),
        ) // loss of precision
      })

      it('claims fee (donation)', async () => {
        dsu.transfer
          .whenCalledWith(
            beneficiary.address,
            EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2).mul(1e12),
          )
          .returns(true)

        await expect(market.connect(beneficiary).claimDonation())
          .to.emit(market, 'FeeClaimed')
          .withArgs(beneficiary.address, EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(2))

        expect((await market.global()).protocolFee).to.equal(
          EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).div(2).sub(3),
        ) // loss of precision
        expect((await market.global()).donation).to.equal(0)
      })

      // TODO: revert when not correct role or remove if consolidated
    })

    describe('#claimReward', async () => {
      beforeEach(async () => {
        factory.treasury.returns(protocolTreasury.address)

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
