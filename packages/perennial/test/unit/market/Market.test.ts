import { smock, MockContract as SmockContract, FakeContract } from '@defi-wonderland/smock'
import { MockContract } from '@ethereum-waffle/mock-contract'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE, { waffle } from 'hardhat'

import { impersonate } from '../../../../common/testutil'

import {
  Market,
  Market__factory,
  IOracleProvider__factory,
  Factory__factory,
  IERC20Metadata__factory,
} from '../../../types/generated'
import { expectAccountEq, expectPositionEq, expectVersionEq, parse6decimal } from '../../../../common/testutil/types'
import { IMarket, MarketParameterStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

const POSITION = parse6decimal('10.000')
const COLLATERAL = parse6decimal('10000')

describe.only('Market', () => {
  let owner: SignerWithAddress
  let treasury: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let factorySigner: SignerWithAddress
  let factory: MockContract
  let oracle: MockContract
  let dsu: MockContract
  let reward: MockContract

  let market: Market
  let marketDefinition: IMarket.MarketDefinitionStruct
  let marketParameter: MarketParameterStruct

  beforeEach(async () => {
    ;[owner, treasury, user, userB, userC] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(owner, IOracleProvider__factory.abi)
    dsu = await waffle.deployMockContract(owner, IERC20Metadata__factory.abi)
    reward = await waffle.deployMockContract(owner, IERC20Metadata__factory.abi)

    factory = await waffle.deployMockContract(owner, Factory__factory.abi)
    factorySigner = await impersonate.impersonateWithBalance(factory.address, utils.parseEther('10'))
    await factory.mock.owner.withArgs().returns(owner.address)
    await factory.mock.parameter.withArgs().returns({
      protocolFee: parse6decimal('0.50'),
      minFundingFee: parse6decimal('0.10'),
      liquidationFee: parse6decimal('0.50'),
      minCollateral: parse6decimal('500'),
      paused: false,
    })

    marketDefinition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: reward.address,
    }
    marketParameter = {
      maintenance: parse6decimal('0.3'),
      fundingFee: parse6decimal('0.1'),
      takerFee: 0,
      positionFee: 0,
      makerLiquidity: parse6decimal('0.2'),
      makerLimit: parse6decimal('1000'),
      closed: false,
      utilizationCurve: {
        minRate: parse6decimal('0.10'),
        maxRate: parse6decimal('0.10'),
        targetRate: parse6decimal('0.10'),
        targetUtilization: parse6decimal('1'),
      },
      makerRewardRate: 0,
      longRewardRate: 0,
      shortRewardRate: 0,
      oracle: oracle.address,
      payoff: {
        provider: constants.AddressZero,
        short: false,
      },
    }
    market = await new Market__factory(owner).deploy()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      await expect(market.connect(factorySigner).initialize(marketDefinition, marketParameter)).to.emit(
        market,
        'ParameterUpdated',
      )

      expect(await market.factory()).to.equal(factory.address)
      expect(await market.token()).to.equal(dsu.address)
      expect(await market.reward()).to.equal(reward.address)
      expect(await market.name()).to.equal(marketDefinition.name)
      expect(await market.symbol()).to.equal(marketDefinition.symbol)

      const parameter = await market.parameter()
      expect(parameter.maintenance).to.equal(marketParameter.maintenance)
      expect(parameter.fundingFee).to.equal(marketParameter.fundingFee)
      expect(parameter.takerFee).to.equal(marketParameter.takerFee)
      expect(parameter.positionFee).to.equal(marketParameter.positionFee)
      expect(parameter.makerLiquidity).to.equal(marketParameter.makerLiquidity)
      expect(parameter.makerLimit).to.equal(marketParameter.makerLimit)
      expect(parameter.utilizationCurve.minRate).to.equal(marketParameter.utilizationCurve.minRate)
      expect(parameter.utilizationCurve.targetRate).to.equal(marketParameter.utilizationCurve.targetRate)
      expect(parameter.utilizationCurve.maxRate).to.equal(marketParameter.utilizationCurve.maxRate)
      expect(parameter.utilizationCurve.targetUtilization).to.equal(marketParameter.utilizationCurve.targetUtilization)
      expect(parameter.makerRewardRate).to.equal(marketParameter.makerRewardRate)
      expect(parameter.shortRewardRate).to.equal(marketParameter.shortRewardRate)
      expect(parameter.oracle).to.equal(marketParameter.oracle)
      expect(parameter.payoff.provider).to.equal(marketParameter.payoff.provider)
      expect(parameter.payoff.short).to.equal(marketParameter.payoff.short)
    })

    it('reverts if already initialized', async () => {
      await market.initialize(marketDefinition, marketParameter)
      await expect(market.initialize(marketDefinition, marketParameter)).to.be.revertedWith(
        'UInitializableAlreadyInitializedError(1)',
      )
    })
  })

  context('already initialized', async () => {
    beforeEach(async () => {
      await market.connect(factorySigner).initialize(marketDefinition, marketParameter)
      await market.connect(factorySigner).updatePendingOwner(owner.address)
      await market.connect(owner).acceptOwner()
    })

    describe('#updateParameter', async () => {
      it('updates the parameters', async () => {
        const newMarketParameter = {
          maintenance: parse6decimal('0.4'),
          fundingFee: parse6decimal('0.2'),
          takerFee: parse6decimal('0.1'),
          positionFee: parse6decimal('0.1'),
          makerLiquidity: parse6decimal('0.1'),
          makerLimit: parse6decimal('2000'),
          closed: true,
          utilizationCurve: {
            minRate: parse6decimal('0.20'),
            maxRate: parse6decimal('0.20'),
            targetRate: parse6decimal('0.20'),
            targetUtilization: parse6decimal('0.75'),
          },
          makerRewardRate: parse6decimal('0.1'),
          longRewardRate: parse6decimal('0.1'),
          shortRewardRate: parse6decimal('0.1'),
          oracle: constants.AddressZero,
          payoff: {
            //TODO: many of these should not be updateable
            provider: constants.AddressZero,
            short: true,
          },
        }

        await expect(market.connect(owner).updateParameter(newMarketParameter)).to.emit(market, 'ParameterUpdated')

        const parameter = await market.parameter()
        expect(parameter.maintenance).to.equal(newMarketParameter.maintenance)
        expect(parameter.fundingFee).to.equal(newMarketParameter.fundingFee)
        expect(parameter.takerFee).to.equal(newMarketParameter.takerFee)
        expect(parameter.positionFee).to.equal(newMarketParameter.positionFee)
        expect(parameter.makerLiquidity).to.equal(newMarketParameter.makerLiquidity)
        expect(parameter.makerLimit).to.equal(newMarketParameter.makerLimit)
        expect(parameter.utilizationCurve.minRate).to.equal(newMarketParameter.utilizationCurve.minRate)
        expect(parameter.utilizationCurve.targetRate).to.equal(newMarketParameter.utilizationCurve.targetRate)
        expect(parameter.utilizationCurve.maxRate).to.equal(newMarketParameter.utilizationCurve.maxRate)
        expect(parameter.utilizationCurve.targetUtilization).to.equal(
          newMarketParameter.utilizationCurve.targetUtilization,
        )
        expect(parameter.makerRewardRate).to.equal(newMarketParameter.makerRewardRate)
        expect(parameter.shortRewardRate).to.equal(newMarketParameter.shortRewardRate)
        expect(parameter.oracle).to.equal(newMarketParameter.oracle)
        expect(parameter.payoff.provider).to.equal(newMarketParameter.payoff.provider)
        expect(parameter.payoff.short).to.equal(newMarketParameter.payoff.short)
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateParameter(marketParameter)).to.be.be.revertedWith(
          'UOwnableNotOwnerError()',
        )
      })

      //TODO: should be more validation on parameters
    })

    describe('#updateTreasury', async () => {
      it('updates the treasury', async () => {
        await expect(market.connect(owner).updateTreasury(treasury.address))
          .to.emit(market, 'TreasuryUpdated')
          .withArgs(treasury.address)
        expect(await market.treasury()).to.equal(treasury.address)
      })

      it('reverts if not owner', async () => {
        await expect(market.connect(user).updateTreasury(treasury.address)).to.be.revertedWith(
          'UOwnableNotOwnerError()',
        )
      })
    })

    describe('#update', async () => {
      describe('long market', async () => {
        const ORACLE_VERSION = 1
        const TIMESTAMP = 1636401093
        const PRICE = parse6decimal('123')

        const ORACLE_VERSION_0 = {
          price: 0,
          timestamp: 0,
          version: 0,
        }

        const ORACLE_VERSION_1 = {
          price: PRICE,
          timestamp: TIMESTAMP,
          version: ORACLE_VERSION,
        }

        const ORACLE_VERSION_2 = {
          price: PRICE,
          timestamp: TIMESTAMP + 3600,
          version: ORACLE_VERSION + 1,
        }

        const ORACLE_VERSION_3 = {
          price: PRICE,
          timestamp: TIMESTAMP + 7200,
          version: ORACLE_VERSION + 2,
        }

        const ORACLE_VERSION_4 = {
          price: PRICE,
          timestamp: TIMESTAMP + 10800,
          version: ORACLE_VERSION + 3,
        }

        beforeEach(async () => {
          await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
          await oracle.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
        })

        context('no position', async () => {
          beforeEach(async () => {
            await dsu.mock.transferFrom.withArgs(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          // TODO
        })

        context('make position', async () => {
          context('open', async () => {
            beforeEach(async () => {
              await dsu.mock.transferFrom.withArgs(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            })

            it('opens the position', async () => {
              await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, POSITION, 0, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                makerNext: POSITION,
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles', async () => {
              await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, POSITION, 0, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await market.connect(user).settle(user.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 2,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 2,
                maker: POSITION,
                long: 0,
                short: 0,
                makerNext: POSITION,
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(2), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (same version)', async () => {
              await market.connect(user).update(POSITION, 0, 0, COLLATERAL)

              console.log((await market.position()).latestVersion)
              await expect(market.connect(user).update(POSITION.mul(2), 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, POSITION.mul(2), 0, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                nextMaker: POSITION.mul(2),
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                makerNext: POSITION.mul(2),
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market.connect(user).update(POSITION, 0, 0, COLLATERAL)

              await expect(market.connect(user).update(POSITION.mul(2), 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, POSITION.mul(2), 0, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await market.connect(user).settle(user.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 2,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                nextMaker: POSITION.mul(2),
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 2,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                makerNext: POSITION.mul(2),
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(2), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (next version)', async () => {
              await market.connect(user).update(POSITION, 0, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await expect(market.connect(user).update(POSITION.mul(2), 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 2, POSITION.mul(2), 0, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 2,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION.mul(2),
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 2,
                maker: POSITION,
                long: 0,
                short: 0,
                makerNext: POSITION.mul(2),
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(2), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market.connect(user).update(POSITION, 0, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await expect(market.connect(user).update(POSITION.mul(2), 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 2, POSITION.mul(2), 0, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await market.connect(user).settle(user.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 3,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                nextMaker: POSITION.mul(2),
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 3,
                maker: POSITION.mul(2),
                long: 0,
                short: 0,
                makerNext: POSITION.mul(2),
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(3), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles later', async () => {
              await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, POSITION, 0, 0, COLLATERAL)

              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await market.connect(user).settle(user.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 3,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 3,
                maker: POSITION,
                long: 0,
                short: 0,
                makerNext: POSITION,
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(3), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              await dsu.mock.transferFrom.withArgs(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
            })

            it('closes the position', async () => {
              await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, 0, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                nextMaker: 0,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                makerNext: 0,
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('closes the position partially', async () => {
              await expect(market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, POSITION.div(2), 0, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                nextMaker: POSITION.div(2),
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                makerNext: POSITION.div(2),
                longNext: 0,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION), {
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
                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
                await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

                await market.connect(user).settle(user.address)
              })

              it('closes the position', async () => {
                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 2, 0, 0, 0, COLLATERAL)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 2,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 2,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(2), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes the position and settles', async () => {
                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 2, 0, 0, 0, COLLATERAL)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await market.connect(user).settle(user.address)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 3,
                  maker: 0,
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 3,
                  maker: 0,
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(3), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position (same version)', async () => {
                await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)

                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 2, 0, 0, 0, COLLATERAL)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 2,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 2,
                  maker: POSITION,
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(2), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)

                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 2, 0, 0, 0, COLLATERAL)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await market.connect(user).settle(user.address)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 3,
                  maker: 0,
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 3,
                  maker: 0,
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(3), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position (next version)', async () => {
                await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 3, 0, 0, 0, COLLATERAL)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 3,
                  maker: POSITION.div(2),
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 3,
                  maker: POSITION.div(2),
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(3), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes a second position and settles (next version)', async () => {
                await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 3, 0, 0, 0, COLLATERAL)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
                await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

                await market.connect(user).settle(user.address)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 4,
                  maker: 0,
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 4,
                  maker: 0,
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(4), {
                  makerValue: { _value: 0 },
                  longValue: { _value: 0 },
                  shortValue: { _value: 0 },
                  makerReward: { _value: 0 },
                  longReward: { _value: 0 },
                  shortReward: { _value: 0 },
                })
              })

              it('closes the position and settles later', async () => {
                await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
                  .to.emit(market, 'Updated')
                  .withArgs(user.address, 2, 0, 0, 0, COLLATERAL)

                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
                await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

                await market.connect(user).settle(user.address)

                expectAccountEq(await market.accounts(user.address), {
                  latestVersion: 4,
                  maker: 0,
                  long: 0,
                  short: 0,
                  nextMaker: 0,
                  nextLong: 0,
                  nextShort: 0,
                  collateral: COLLATERAL,
                  reward: 0,
                  liquidation: false,
                })
                expectPositionEq(await market.position(), {
                  latestVersion: 4,
                  maker: 0,
                  long: 0,
                  short: 0,
                  makerNext: 0,
                  longNext: 0,
                  shortNext: 0,
                })
                expectVersionEq(await market.versions(4), {
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
        })

        context('long position', async () => {
          beforeEach(async () => {
            await dsu.mock.transferFrom.withArgs(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          context.only('open', async () => {
            beforeEach(async () => {
              await dsu.mock.transferFrom.withArgs(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market.connect(userB).update(POSITION, 0, 0, COLLATERAL)
            })

            it('opens the position', async () => {
              await expect(market.connect(user).update(0, POSITION, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                nextMaker: 0,
                nextLong: POSITION,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                makerNext: POSITION,
                longNext: POSITION,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles', async () => {
              await expect(market.connect(user).update(0, POSITION, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await market.connect(user).settle(user.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 2,
                maker: 0,
                long: POSITION,
                short: 0,
                nextMaker: 0,
                nextLong: POSITION,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 2,
                maker: POSITION,
                long: POSITION,
                short: 0,
                makerNext: POSITION,
                longNext: POSITION,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(2), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (same version)', async () => {
              await market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL)

              await expect(market.connect(user).update(0, POSITION, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                nextMaker: 0,
                nextLong: POSITION,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: ORACLE_VERSION,
                maker: 0,
                long: 0,
                short: 0,
                makerNext: POSITION,
                longNext: POSITION,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL)

              await expect(market.connect(user).update(0, POSITION, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, POSITION, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await market.connect(user).settle(user.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 2,
                maker: 0,
                long: POSITION,
                short: 0,
                nextMaker: 0,
                nextLong: POSITION,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 2,
                maker: POSITION,
                long: POSITION,
                short: 0,
                makerNext: POSITION,
                longNext: POSITION,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(2), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position (next version)', async () => {
              await market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await expect(market.connect(user).update(0, POSITION, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 2, 0, POSITION, 0, COLLATERAL)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 2,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                nextMaker: 0,
                nextLong: POSITION,
                nextShort: 0,
                collateral: COLLATERAL,
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 2,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                makerNext: POSITION,
                longNext: POSITION,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(2), {
                makerValue: { _value: 0 },
                longValue: { _value: 0 },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens a second position and settles (next version)', async () => {
              // rate * elapsed * utilization * maker * price
              // ( 0.1 * 10^6 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 7020
              const EXPECTED_FUNDING = BigNumber.from(7020)
              const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
              const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)

              await market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await expect(market.connect(user).update(0, POSITION, 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 2, 0, POSITION, 0, COLLATERAL)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await market.connect(user).settle(user.address)
              await market.connect(user).settle(userB.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 3,
                maker: 0,
                long: POSITION,
                short: 0,
                nextMaker: 0,
                nextLong: POSITION,
                nextShort: 0,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING),
                reward: 0,
                liquidation: false,
              })
              expectAccountEq(await market.accounts(userB.address), {
                latestVersion: 3,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE).sub(8), // loss of precision
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 3,
                maker: POSITION,
                long: POSITION,
                short: 0,
                makerNext: POSITION,
                longNext: POSITION,
                shortNext: 0,
              })
              expectVersionEq(await market.versions(3), {
                makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(10) },
                longValue: { _value: EXPECTED_FUNDING.div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles later', async () => {
              // rate * elapsed * utilization * maker * price
              // ( 0.1 * 10^6 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 7020
              const EXPECTED_FUNDING = BigNumber.from('7020')
              const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
              const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)

              await expect(market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, POSITION.div(2), 0, COLLATERAL)

              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await market.connect(user).settle(user.address)
              await market.connect(user).settle(userB.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 3,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                nextMaker: 0,
                nextLong: POSITION.div(2),
                nextShort: 0,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING),
                reward: 0,
                liquidation: false,
              })
              expectAccountEq(await market.accounts(userB.address), {
                latestVersion: 3,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE).sub(8), // loss of precision
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 3,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                makerNext: POSITION,
                longNext: POSITION.div(2),
                shortNext: 0,
              })
              expectVersionEq(await market.versions(3), {
                makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(10) },
                longValue: { _value: EXPECTED_FUNDING.div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('opens the position and settles later with fee', async () => {
              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerFee = parse6decimal('0.01')
              await market.updateParameter(marketParameter)

              const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

              // rate * elapsed * utilization * maker * price
              // ( 0.1 * 10^6 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 7020
              const EXPECTED_FUNDING = ethers.BigNumber.from('7020')
              const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
              const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)

              await dsu.mock.transferFrom
                .withArgs(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
                .returns(true)
              await expect(market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 1, 0, POSITION.div(2), 0, COLLATERAL)

              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await market.connect(user).settle(user.address)
              await market.connect(user).settle(userB.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 3,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                nextMaker: 0,
                nextLong: POSITION.div(2),
                nextShort: 0,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING),
                reward: 0,
                liquidation: false,
              })
              expectAccountEq(await market.accounts(userB.address), {
                latestVersion: 3,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITH_FEE).sub(8), // loss of precision
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 3,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                makerNext: POSITION,
                longNext: POSITION.div(2),
                shortNext: 0,
              })
              expectVersionEq(await market.versions(3), {
                makerValue: { _value: EXPECTED_FUNDING_WITH_FEE.div(10) },
                longValue: { _value: EXPECTED_FUNDING.div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
              await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

              await market.connect(user).settle(user.address)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerFee = parse6decimal('0.01')
              await market.updateParameter(marketParameter)

              const TAKER_FEE = parse6decimal('6.15') // position * taker fee * price

              // rate * elapsed * utilization * maker * price
              // ( 0.1 * 10^6 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 7020
              const EXPECTED_FUNDING = ethers.BigNumber.from('7020')
              const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
              const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE)

              await dsu.mock.transferFrom
                .withArgs(user.address, market.address, COLLATERAL.add(TAKER_FEE).mul(1e12))
                .returns(true)
              await expect(market.connect(user).update(0, POSITION.div(2), 0, COLLATERAL))
                .to.emit(market, 'Updated')
                .withArgs(user.address, 2, 0, POSITION.div(2), 0, COLLATERAL)

              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
              await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

              await market.connect(user).settle(user.address)
              await market.connect(user).settle(userB.address)

              expectAccountEq(await market.accounts(user.address), {
                latestVersion: 4,
                maker: 0,
                long: POSITION.div(2),
                short: 0,
                nextMaker: 0,
                nextLong: POSITION.div(2),
                nextShort: 0,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING),
                reward: 0,
                liquidation: false,
              })
              expectAccountEq(await market.accounts(userB.address), {
                latestVersion: 4,
                maker: POSITION,
                long: 0,
                short: 0,
                nextMaker: POSITION,
                nextLong: 0,
                nextShort: 0,
                collateral: COLLATERAL.add(TAKER_FEE.add(EXPECTED_FUNDING_WITH_FEE)).sub(8), // loss of precision
                reward: 0,
                liquidation: false,
              })
              expectPositionEq(await market.position(), {
                latestVersion: 4,
                maker: POSITION,
                long: POSITION.div(2),
                short: 0,
                makerNext: POSITION,
                longNext: POSITION.div(2),
                shortNext: 0,
              })
              expectVersionEq(await market.versions(4), {
                makerValue: { _value: TAKER_FEE.add(EXPECTED_FUNDING_WITH_FEE).div(10) },
                longValue: { _value: EXPECTED_FUNDING.div(5).mul(-1) },
                shortValue: { _value: 0 },
                makerReward: { _value: 0 },
                longReward: { _value: 0 },
                shortReward: { _value: 0 },
              })
            })
            //TODO: check fees
          })

          context('close', async () => {
            beforeEach(async () => {
              await market.connect(userB).openMake(POSITION.mul(2))
              await market.connect(user).openTake(POSITION)
            })

            it('closes the position partially', async () => {
              await expect(market.connect(user).closeTake(POSITION.div(2)))
                .to.emit(market, 'TakeClosed')
                .withArgs(user.address, 1, POSITION.div(2))

              expect(await market.isClosed(user.address)).to.equal(false)
              expect(await market['maintenance(address)'](user.address)).to.equal(0)
              expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
              expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 1,
                openPosition: { maker: 0, taker: POSITION.div(2) },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
              expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 1,
                openPosition: { maker: POSITION.mul(2), taker: POSITION.div(2) },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
              expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
              expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
            })

            it('closes the position', async () => {
              await expect(market.connect(user).closeTake(POSITION))
                .to.emit(market, 'TakeClosed')
                .withArgs(user.address, 1, POSITION)

              expect(await market.isClosed(user.address)).to.equal(true)
              expect(await market['maintenance(address)'](user.address)).to.equal(0)
              expect(await market.maintenanceNext(user.address)).to.equal(0)
              expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 1,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
              expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 1,
                openPosition: { maker: POSITION.mul(2), taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
              expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
              expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
            })

            context('settles first', async () => {
              beforeEach(async () => {
                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
                await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

                await market.connect(user).settle()
                await market.connect(user).settleAccount(user.address)
              })

              it('closes the position', async () => {
                await expect(market.connect(user).closeTake(POSITION))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 2, POSITION)

                expect(await market.isClosed(user.address)).to.equal(false)
                expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 2,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: POSITION },
                })
                expect(await market['latestVersion()']()).to.equal(2)
                expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 2,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: POSITION },
                })
                expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
                expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
                expect(await market['latestVersion(address)'](user.address)).to.equal(2)
              })

              it('closes the position and settles', async () => {
                // rate * elapsed * utilization * maker * price
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
                const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
                const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
                const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

                await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
                await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

                await expect(market.connect(user).closeTake(POSITION))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 2, POSITION)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

                expect(await market['latestVersion()']()).to.equal(3)
                expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expectPositionEq(await market.valueAtVersion(3), {
                  maker: EXPECTED_FUNDING_WITH_FEE.div(20),
                  taker: EXPECTED_FUNDING.div(10).mul(-1),
                })
                expectPositionEq(await market.shareAtVersion(3), {
                  maker: utils.parseEther('180'),
                  taker: utils.parseEther('360'),
                })

                await expect(market.connect(user).settleAccount(user.address))
                  .to.emit(market, 'AccountSettle')
                  .withArgs(user.address, 3, 3)

                expect(await market.isClosed(user.address)).to.equal(true)
                expect(await market['maintenance(address)'](user.address)).to.equal(0)
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expect(await market['latestVersion(address)'](user.address)).to.equal(3)
              })

              it('closes a second position (same version)', async () => {
                await market.connect(user).closeTake(POSITION.div(2))

                await expect(market.connect(user).closeTake(POSITION.div(2)))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 2, POSITION.div(2))

                expect(await market.isClosed(user.address)).to.equal(false)
                expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 2,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: POSITION },
                })
                expect(await market['latestVersion()']()).to.equal(2)
                expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 2,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: POSITION },
                })
                expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
                expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
                expect(await market['latestVersion(address)'](user.address)).to.equal(2)
              })

              it('closes a second position and settles (same version)', async () => {
                // rate * elapsed * utilization * maker * price
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
                const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
                const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
                const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

                await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
                await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

                await market.connect(user).closeTake(POSITION.div(2))

                await expect(market.connect(user).closeTake(POSITION.div(2)))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 2, POSITION.div(2))

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

                expect(await market['latestVersion()']()).to.equal(3)
                expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expectPositionEq(await market.valueAtVersion(3), {
                  maker: EXPECTED_FUNDING_WITH_FEE.div(20),
                  taker: EXPECTED_FUNDING.div(10).mul(-1),
                })
                expectPositionEq(await market.shareAtVersion(3), {
                  maker: utils.parseEther('180'),
                  taker: utils.parseEther('360'),
                })

                await expect(market.connect(user).settleAccount(user.address))
                  .to.emit(market, 'AccountSettle')
                  .withArgs(user.address, 3, 3)

                expect(await market.isClosed(user.address)).to.equal(true)
                expect(await market['maintenance(address)'](user.address)).to.equal(0)
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expect(await market['latestVersion(address)'](user.address)).to.equal(3)
              })

              it('closes a second position (next version)', async () => {
                // rate * elapsed * utilization * maker * price
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
                const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
                const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
                const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

                await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
                await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

                await market.connect(user).closeTake(POSITION.div(2))

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await expect(market.connect(user).closeTake(POSITION.div(2)))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 3, POSITION.div(2))

                expect(await market.isClosed(user.address)).to.equal(false)
                expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.div(2) })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 3,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: POSITION.div(2) },
                })
                expect(await market['latestVersion()']()).to.equal(3)
                expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
                expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.div(2) })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 3,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: POSITION.div(2) },
                })
                expectPositionEq(await market.valueAtVersion(3), {
                  maker: EXPECTED_FUNDING_WITH_FEE.div(20),
                  taker: EXPECTED_FUNDING.div(10).mul(-1),
                })
                expectPositionEq(await market.shareAtVersion(3), {
                  maker: utils.parseEther('180'),
                  taker: utils.parseEther('360'),
                })
                expect(await market['latestVersion(address)'](user.address)).to.equal(3)
              })

              it('closes a second position and settles (next version)', async () => {
                // rate * elapsed * utilization * maker * price
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.25 * 20 * 123 = 7020547944372000
                const EXPECTED_FUNDING_1 = ethers.BigNumber.from('14041095888744000')
                const EXPECTED_FUNDING_2 = ethers.BigNumber.from('7020547944372000')
                const EXPECTED_FUNDING_FEE_1 = EXPECTED_FUNDING_1.div(10)
                const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
                const EXPECTED_FUNDING_WITH_FEE_1 = EXPECTED_FUNDING_1.sub(EXPECTED_FUNDING_FEE_1) // maker funding
                const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2) // maker funding

                await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE_1).returns()
                await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE_2).returns()
                await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_1.mul(-1)).returns()
                await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_2.mul(-1)).returns()

                await market.connect(user).closeTake(POSITION.div(2))

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

                await expect(market.connect(user).closeTake(POSITION.div(2)))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 3, POSITION.div(2))

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
                await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

                await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

                expect(await market['latestVersion()']()).to.equal(4)
                expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expectPositionEq(await market.valueAtVersion(3), {
                  maker: EXPECTED_FUNDING_WITH_FEE_1.div(20),
                  taker: EXPECTED_FUNDING_1.div(10).mul(-1),
                })
                expectPositionEq(await market.valueAtVersion(4), {
                  maker: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2).div(20),
                  taker: EXPECTED_FUNDING_1.div(10).add(EXPECTED_FUNDING_2.div(5)).mul(-1),
                })
                expectPositionEq(await market.shareAtVersion(4), {
                  maker: utils.parseEther('360'),
                  taker: utils.parseEther('1080'),
                })

                await expect(market.connect(user).settleAccount(user.address))
                  .to.emit(market, 'AccountSettle')
                  .withArgs(user.address, 4, 4)

                expect(await market.isClosed(user.address)).to.equal(true)
                expect(await market['maintenance(address)'](user.address)).to.equal(0)
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expect(await market['latestVersion(address)'](user.address)).to.equal(4)
              })

              it('closes the position and settles later', async () => {
                // rate * elapsed * utilization * maker * price
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
                const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
                const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
                const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

                await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
                await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

                await expect(market.connect(user).closeTake(POSITION))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 2, POSITION)

                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
                await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

                await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

                expect(await market['latestVersion()']()).to.equal(4)
                expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
                expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expectPositionEq(await market.valueAtVersion(4), {
                  maker: EXPECTED_FUNDING_WITH_FEE.div(20),
                  taker: EXPECTED_FUNDING.div(10).mul(-1),
                })
                expectPositionEq(await market.shareAtVersion(4), {
                  maker: utils.parseEther('360'),
                  taker: utils.parseEther('360'),
                })

                await expect(market.connect(user).settleAccount(user.address))
                  .to.emit(market, 'AccountSettle')
                  .withArgs(user.address, 3, 4)

                expect(await market.isClosed(user.address)).to.equal(true)
                expect(await market['maintenance(address)'](user.address)).to.equal(0)
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expect(await market['latestVersion(address)'](user.address)).to.equal(4)
              })

              it('closes the position and settles later', async () => {
                await market.updateTakerFee(utils.parseEther('0.01'))

                const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

                // rate * elapsed * utilization * maker * price
                // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
                const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
                const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
                const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

                await collateral.mock.settleMarket.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
                await collateral.mock.settleAccount
                  .withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1))
                  .returns()

                await expect(market.connect(user).closeTake(POSITION))
                  .to.emit(market, 'TakeClosed')
                  .withArgs(user.address, 2, POSITION)

                await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

                await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
                await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
                await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
                await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

                await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

                expect(await market['latestVersion()']()).to.equal(4)
                expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
                expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
                expectPrePositionEq(await market['pre()'](), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expectPositionEq(await market.valueAtVersion(4), {
                  maker: EXPECTED_FUNDING_WITH_FEE.div(20),
                  taker: EXPECTED_FUNDING.div(10).mul(-1),
                })
                expectPositionEq(await market.shareAtVersion(4), {
                  maker: utils.parseEther('360'),
                  taker: utils.parseEther('360'),
                })

                await expect(market.connect(user).settleAccount(user.address))
                  .to.emit(market, 'AccountSettle')
                  .withArgs(user.address, 3, 4)

                expect(await market.isClosed(user.address)).to.equal(true)
                expect(await market['maintenance(address)'](user.address)).to.equal(0)
                expect(await market.maintenanceNext(user.address)).to.equal(0)
                expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
                expectPrePositionEq(await market['pre(address)'](user.address), {
                  oracleVersion: 0,
                  openPosition: { maker: 0, taker: 0 },
                  closePosition: { maker: 0, taker: 0 },
                })
                expect(await market['latestVersion(address)'](user.address)).to.equal(4)
              })

              it('reverts if underflow', async () => {
                await expect(market.connect(user).closeTake(POSITION.mul(2))).to.be.revertedWith(
                  'MarketOverClosedError()',
                )
              })

              it('reverts if in liquidation', async () => {
                await market.connect(collateralSigner).closeAll(user.address)
                await expect(market.connect(user).closeTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
              })

              it('reverts if paused', async () => {
                await factory.mock.paused.withArgs().returns(true)
                await expect(market.connect(user).closeTake(POSITION)).to.be.revertedWith('PausedError()')
              })
            })
          })
        })

        describe('#closeAll', async () => {
          it('closes maker side', async () => {
            await market.connect(user).openMake(POSITION)

            await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
            await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
            await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
            await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

            await market.connect(user).settle()
            await market.connect(user).settleAccount(user.address)

            await market.connect(user).openMake(POSITION)

            await market.connect(collateralSigner).closeAll(user.address)

            expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 2,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: POSITION, taker: 0 },
            })

            expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 2,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: POSITION, taker: 0 },
            })
            expect(await market.isLiquidating(user.address)).to.equal(true)
            expect(await market['maintenance(address)'](user.address)).to.equal(0)
          })

          it('closes taker side', async () => {
            await market.connect(userB).openMake(POSITION.mul(2))
            await market.connect(user).openTake(POSITION)

            await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
            await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
            await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
            await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

            await market.connect(user).settle()
            await market.connect(user).settleAccount(user.address)

            await market.connect(user).openTake(POSITION)

            await market.connect(collateralSigner).closeAll(user.address)

            expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 2,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: POSITION },
            })

            expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 2,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: POSITION },
            })
            expect(await market.isLiquidating(user.address)).to.equal(true)
            expect(await market['maintenance(address)'](user.address)).to.equal(0)
          })

          it('reverts if already initialized', async () => {
            await expect(market.connect(user).closeAll(user.address)).to.be.revertedWith(`NotCollateralError()`)
          })
        })

        context('invariant violations', async () => {
          it('reverts if can liquidate', async () => {
            await dsu.mock.transferFrom.withArgs(user.address, market.address, utils.parseEther('500')).returns(true)
            await expect(
              market.connect(user).update(parse6decimal('1000'), 0, 0, parse6decimal('500')),
            ).to.be.revertedWith('MarketInsufficientCollateralError()')
          })

          it('reverts if paused', async () => {
            await factory.mock.parameter.withArgs().returns({
              protocolFee: parse6decimal('0.50'),
              minFundingFee: parse6decimal('0.10'),
              liquidationFee: parse6decimal('0.50'),
              minCollateral: parse6decimal('500'),
              paused: true,
            })
            await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL)).to.be.revertedWith('PausedError()')
          })

          it('reverts if over maker limit', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.makerLimit = POSITION.div(2)
            await market.updateParameter(marketParameter)
            await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL)).to.be.revertedWith(
              'MarketMakerOverLimitError()',
            )
          })

          it('reverts if closed', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(marketParameter)
            await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL)).to.be.revertedWith(
              'MarketClosedError()',
            )
          })

          it('reverts if taker > maker', async () => {
            const socialization = utils.parseEther('0.5')
            await expect(market.connect(user).openTake(POSITION.mul(4))).to.be.revertedWith(
              `MarketInsufficientLiquidityError(${socialization})`,
            )
          })

          it('reverts if in liquidation', async () => {
            await market.connect(collateralSigner).closeAll(user.address)
            await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
          })

          it('reverts if paused', async () => {
            await factory.mock.paused.withArgs().returns(true)
            await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('PausedError()')
          })

          it('reverts if closed', async () => {
            await market.updateClosed(true)
            await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketClosedError()')
          })

          //TODO: more revert states?
        })

        context('#settle / #settleAccount', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 10 * 123 = 7020547945205480
          const EXPECTED_FUNDING = 7020547944372000
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING / 10
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING - EXPECTED_FUNDING_FEE // maker funding

          beforeEach(async () => {
            await market.connect(user).openMake(POSITION)
            await market.connect(userB).openTake(POSITION.div(2))

            await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
            await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
            await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
            await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

            await market.connect(user).settle()
            await market.connect(user).settleAccount(user.address)
            await market.connect(user).settleAccount(userB.address)
          })

          it('same price same rate settle', async () => {
            await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
            await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
            await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

            await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
            await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
            await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
            await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

            await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

            expect(await market['latestVersion()']()).to.equal(3)
            expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expectPositionEq(await market.valueAtVersion(3), {
              maker: EXPECTED_FUNDING_WITH_FEE / 10,
              taker: (-1 * EXPECTED_FUNDING) / 5,
            })
            expectPositionEq(await market.shareAtVersion(3), {
              maker: utils.parseEther('0.1').mul(3600),
              taker: utils.parseEther('0.2').mul(3600),
            })

            await expect(market.connect(user).settleAccount(user.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(user.address, 3, 3)

            expect(await market.isClosed(user.address)).to.equal(false)
            expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
            expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
            expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](user.address)).to.equal(3)

            await expect(market.connect(userB).settleAccount(userB.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(userB.address, 3, 3)

            expect(await market.isClosed(userB.address)).to.equal(false)
            expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
            expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
            expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre(address)'](userB.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
          })

          it('same price same timestamp settle', async () => {
            await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
            await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
            await collateral.mock.settleAccount
              .withArgs(userB.address, -1 * (EXPECTED_FUNDING - EXPECTED_FUNDING_FEE))
              .returns()

            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              version: 3,
            }
            await oracle.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
            await oracle.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
            await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
            await oracle.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

            await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

            expect(await market['latestVersion()']()).to.equal(3)
            expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expectPositionEq(await market.valueAtVersion(3), {
              maker: 0,
              taker: 0,
            })
            expectPositionEq(await market.shareAtVersion(3), {
              maker: 0,
              taker: 0,
            })

            await expect(market.connect(user).settleAccount(user.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(user.address, 3, 3)

            expect(await market.isClosed(user.address)).to.equal(false)
            expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
            expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
            expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](user.address)).to.equal(3)

            await expect(market.connect(userB).settleAccount(userB.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(userB.address, 3, 3)

            expect(await market.isClosed(userB.address)).to.equal(false)
            expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
            expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
            expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre(address)'](userB.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
          })

          it('lower price same rate settle', async () => {
            const EXPECTED_POSITION = utils.parseEther('2').mul(5) // maker pnl

            await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
            await collateral.mock.settleAccount
              .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
              .returns()
            await collateral.mock.settleAccount
              .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
              .returns()

            const oracleVersionLowerPrice = {
              price: utils.parseEther('121'),
              timestamp: TIMESTAMP + 7200,
              version: 3,
            }
            await oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
            await oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
            await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
            await oracle.mock.sync.withArgs().returns(oracleVersionLowerPrice)

            await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

            expect(await market['latestVersion()']()).to.equal(3)
            expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expectPositionEq(await market.valueAtVersion(3), {
              maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
              taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
            })
            expectPositionEq(await market.shareAtVersion(3), {
              maker: utils.parseEther('0.1').mul(3600),
              taker: utils.parseEther('0.2').mul(3600),
            })

            await expect(market.connect(user).settleAccount(user.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(user.address, 3, 3)

            expect(await market.isClosed(user.address)).to.equal(false)
            expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('605'))
            expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('605'))
            expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](user.address)).to.equal(3)

            await expect(market.connect(userB).settleAccount(userB.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(userB.address, 3, 3)

            expect(await market.isClosed(userB.address)).to.equal(false)
            expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
            expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
            expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre(address)'](userB.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_POSITION = utils.parseEther('-2').mul(5) // maker pnl

            await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
            await collateral.mock.settleAccount
              .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
              .returns()
            await collateral.mock.settleAccount
              .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
              .returns()

            const oracleVersionHigherPrice = {
              price: utils.parseEther('125'),
              timestamp: TIMESTAMP + 7200,
              version: 3,
            }
            await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
            await oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
            await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
            await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

            await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

            expect(await market['latestVersion()']()).to.equal(3)
            expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expectPositionEq(await market.valueAtVersion(3), {
              maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
              taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
            })
            expectPositionEq(await market.shareAtVersion(3), {
              maker: utils.parseEther('0.1').mul(3600),
              taker: utils.parseEther('0.2').mul(3600),
            })

            await expect(market.connect(user).settleAccount(user.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(user.address, 3, 3)

            expect(await market.isClosed(user.address)).to.equal(false)
            expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('625'))
            expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('625'))
            expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](user.address)).to.equal(3)

            await expect(market.connect(userB).settleAccount(userB.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(userB.address, 3, 3)

            expect(await market.isClosed(userB.address)).to.equal(false)
            expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
            expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
            expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre(address)'](userB.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
          })

          it('same price negative rate settle', async () => {
            await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
            await collateral.mock.settleAccount.withArgs(user.address, -1 * EXPECTED_FUNDING).returns()
            await collateral.mock.settleAccount.withArgs(userB.address, EXPECTED_FUNDING_WITH_FEE).returns()

            await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
            await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
            await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
            await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

            await market.updateUtilizationCurve({
              minRate: utils.parseEther('0.10').mul(-1),
              maxRate: utils.parseEther('0.10').mul(-1),
              targetRate: utils.parseEther('0.10').mul(-1),
              targetUtilization: utils.parseEther('1'),
            })

            await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

            expect(await market['latestVersion()']()).to.equal(3)
            expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre()'](), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expectPositionEq(await market.valueAtVersion(3), {
              maker: (-1 * EXPECTED_FUNDING) / 10,
              taker: EXPECTED_FUNDING_WITH_FEE / 5,
            })
            expectPositionEq(await market.shareAtVersion(3), {
              maker: utils.parseEther('0.1').mul(3600),
              taker: utils.parseEther('0.2').mul(3600),
            })

            await expect(market.connect(user).settleAccount(user.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(user.address, 3, 3)

            expect(await market.isClosed(user.address)).to.equal(false)
            expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
            expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
            expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
            expectPrePositionEq(await market['pre(address)'](user.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](user.address)).to.equal(3)

            await expect(market.connect(userB).settleAccount(userB.address))
              .to.emit(market, 'AccountSettle')
              .withArgs(userB.address, 3, 3)

            expect(await market.isClosed(userB.address)).to.equal(false)
            expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
            expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
            expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
            expectPrePositionEq(await market['pre(address)'](userB.address), {
              oracleVersion: 0,
              openPosition: { maker: 0, taker: 0 },
              closePosition: { maker: 0, taker: 0 },
            })
            expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
          })

          context('socialized', async () => {
            it('with socialization to zero', async () => {
              await market.connect(collateralSigner).closeAll(user.address)

              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
              await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
              await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
              await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

              expect(await market['latestVersion()']()).to.equal(4)
              expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
              expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(3), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(3), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(3600),
              })
              expectPositionEq(await market.valueAtVersion(4), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(4), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(7200),
              })

              await expect(market.connect(user).settleAccount(user.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(user.address, 3, 4)

              expect(await market.isClosed(user.address)).to.equal(true)
              expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
              expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
              expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](user.address)).to.equal(4)

              await expect(market.connect(userB).settleAccount(userB.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userB.address, 4, 4)

              expect(await market.isClosed(userB.address)).to.equal(false)
              expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
              expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
              expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre(address)'](userB.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userB.address)).to.equal(4)
            })

            it('with partial socialization', async () => {
              await market.connect(userC).openMake(POSITION.div(4))
              await market.connect(collateralSigner).closeAll(user.address)

              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

              await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
              await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
              await collateral.mock.settleAccount
                .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
                .returns()

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
              await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

              expect(await market['latestVersion()']()).to.equal(4)
              expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
              expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(3), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(3), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(3600),
              })
              expectPositionEq(await market.valueAtVersion(4), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5,
                taker: -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10),
              })
              expectPositionEq(await market.shareAtVersion(4), {
                maker: utils.parseEther('0.5').mul(3600),
                taker: utils.parseEther('0.2').mul(7200),
              })

              await expect(market.connect(user).settleAccount(user.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(user.address, 3, 4)

              expect(await market.isClosed(user.address)).to.equal(true)
              expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
              expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
              expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](user.address)).to.equal(4)

              await expect(market.connect(userB).settleAccount(userB.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userB.address, 4, 4)

              expect(await market.isClosed(userB.address)).to.equal(false)
              expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
              expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
              expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre(address)'](userB.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userB.address)).to.equal(4)

              await expect(market.connect(userC).settleAccount(userC.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userC.address, 3, 4)

              expect(await market.isClosed(userC.address)).to.equal(false)
              expect(await market['maintenance(address)'](userC.address)).to.equal(utils.parseEther('153.75'))
              expect(await market.maintenanceNext(userC.address)).to.equal(utils.parseEther('153.75'))
              expectPositionEq(await market.position(userC.address), { maker: POSITION.div(4), taker: 0 })
              expectPrePositionEq(await market['pre(address)'](userC.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userC.address)).to.equal(4)
            })

            it('with socialization to zero (price change)', async () => {
              await market.connect(collateralSigner).closeAll(user.address)

              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
              await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
              await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

              const oracleVersionHigherPrice = {
                price: utils.parseEther('125'),
                timestamp: TIMESTAMP + 10800,
                version: 4,
              }
              await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
              await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
              await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
              await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

              expect(await market['latestVersion()']()).to.equal(4)
              expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
              expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(3), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(3), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(3600),
              })
              expectPositionEq(await market.valueAtVersion(4), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(4), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(7200),
              })

              await expect(market.connect(user).settleAccount(user.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(user.address, 3, 4)

              expect(await market.isClosed(user.address)).to.equal(true)
              expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
              expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
              expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](user.address)).to.equal(4)

              await expect(market.connect(userB).settleAccount(userB.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userB.address, 4, 4)

              expect(await market.isClosed(userB.address)).to.equal(false)
              expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
              expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
              expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre(address)'](userB.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userB.address)).to.equal(4)
            })

            it('with partial socialization (price change)', async () => {
              const EXPECTED_POSITION = utils.parseEther('-2').mul(5).div(2) // maker pnl

              await market.connect(userC).openMake(POSITION.div(4))
              await market.connect(collateralSigner).closeAll(user.address)

              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

              await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
              await collateral.mock.settleAccount
                .withArgs(userC.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE / 2))
                .returns()
              await collateral.mock.settleAccount
                .withArgs(userB.address, EXPECTED_POSITION.add(BigNumber.from(EXPECTED_FUNDING).mul(3).div(2)).mul(-1))
                .returns()

              const oracleVersionHigherPrice = {
                price: utils.parseEther('125'),
                timestamp: TIMESTAMP + 10800,
                version: 4,
              }
              await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
              await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
              await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
              await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

              expect(await market['latestVersion()']()).to.equal(4)
              expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
              expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(3), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(3), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(3600),
              })
              const MAKER_FUNDING = EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5
              const TAKER_FUNDING = -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10)
              const MAKER_POSITION = EXPECTED_POSITION.mul(2).div(5)
              const TAKER_POSITION = EXPECTED_POSITION.div(-5)
              expectPositionEq(await market.valueAtVersion(4), {
                maker: MAKER_POSITION.add(MAKER_FUNDING),
                taker: TAKER_POSITION.add(TAKER_FUNDING),
              })
              expectPositionEq(await market.shareAtVersion(4), {
                maker: utils.parseEther('0.5').mul(3600),
                taker: utils.parseEther('0.2').mul(7200),
              })

              await expect(market.connect(user).settleAccount(user.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(user.address, 3, 4)

              expect(await market.isClosed(user.address)).to.equal(true)
              expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
              expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
              expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](user.address)).to.equal(4)

              await expect(market.connect(userB).settleAccount(userB.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userB.address, 4, 4)

              expect(await market.isClosed(userB.address)).to.equal(false)
              expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
              expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
              expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre(address)'](userB.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userB.address)).to.equal(4)

              await expect(market.connect(userC).settleAccount(userC.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userC.address, 3, 4)

              expect(await market.isClosed(userC.address)).to.equal(false)
              expect(await market['maintenance(address)'](userC.address)).to.equal(utils.parseEther('156.25'))
              expect(await market.maintenanceNext(userC.address)).to.equal(utils.parseEther('156.25'))
              expectPositionEq(await market.position(userC.address), { maker: POSITION.div(4), taker: 0 })
              expectPrePositionEq(await market['pre(address)'](userC.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userC.address)).to.equal(4)
            })
          })

          context('closed market', async () => {
            it('zeroes PnL and fees (price change)', async () => {
              await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
              await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
              await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

              await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
              await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
              await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
              await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

              await expect(market.connect(owner).updateClosed(true))
                .to.emit(market, 'ClosedUpdated')
                .withArgs(true, 3)
                .to.emit(market, 'Settle')
                .withArgs(3, 3)
              expect(await market.closed()).to.be.true

              await expect(market.connect(user).settleAccount(user.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(user.address, 3, 3)
              await expect(market.connect(userB).settleAccount(userB.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userB.address, 3, 3)

              const oracleVersionHigherPrice_0 = {
                price: utils.parseEther('125'),
                timestamp: TIMESTAMP + 10800,
                version: 4,
              }
              const oracleVersionHigherPrice_1 = {
                price: utils.parseEther('128'),
                timestamp: TIMESTAMP + 10800,
                version: 5,
              }
              await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_0)
              await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice_0)
              await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_0).returns()

              await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_1)
              await oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice_1)
              await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_1).returns()
              await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice_1)

              await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(5, 5)

              expect(await market['latestVersion()']()).to.equal(5)
              expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
              expectPositionEq(await market.positionAtVersion(5), { maker: POSITION, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre()'](), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expectPositionEq(await market.valueAtVersion(3), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(3), {
                maker: utils.parseEther('0.1').mul(3600),
                taker: utils.parseEther('0.2').mul(3600),
              })
              expectPositionEq(await market.valueAtVersion(5), {
                maker: EXPECTED_FUNDING_WITH_FEE / 10,
                taker: (-1 * EXPECTED_FUNDING) / 5,
              })
              expectPositionEq(await market.shareAtVersion(5), {
                maker: utils.parseEther('0.1').mul(7200),
                taker: utils.parseEther('0.2').mul(7200),
              })

              await expect(market.connect(user).settleAccount(user.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(user.address, 5, 5)

              expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
              expectPrePositionEq(await market['pre(address)'](user.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](user.address)).to.equal(5)

              await expect(market.connect(userB).settleAccount(userB.address))
                .to.emit(market, 'AccountSettle')
                .withArgs(userB.address, 5, 5)

              expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
              expectPrePositionEq(await market['pre(address)'](userB.address), {
                oracleVersion: 0,
                openPosition: { maker: 0, taker: 0 },
                closePosition: { maker: 0, taker: 0 },
              })
              expect(await market['latestVersion(address)'](userB.address)).to.equal(5)
            })
          })

          it('reverts if paused', async () => {
            await factory.mock.paused.withArgs().returns(true)
            await expect(market.connect(user).settle()).to.be.revertedWith('PausedError()')
          })

          it('reverts if paused', async () => {
            await factory.mock.paused.withArgs().returns(true)
            await expect(market.connect(user).settleAccount(user.address)).to.be.revertedWith('PausedError()')
          })
        })

        //TODO: liquidiation
        //TODO: shortfall
        //TODO: socialization
      })

      // TODO: short market
      // TODO: long contract payoff market
      // TODO: short contract payoff market
      // TODO: reward
    })

    describe('#settle', async () => {
      it('credits the account', async () => {
        await expect(collateral.connect(marketSigner).settleAccount(user.address, 101))
          .to.emit(collateral, 'AccountSettle')
          .withArgs(market.address, user.address, 101, 0)
        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(101)
        expect(await collateral['collateral(address)'](market.address)).to.equal(0)
      })

      context('negative credit', async () => {
        it('doesnt create a shortfall', async () => {
          await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
          await collateral.depositTo(user.address, market.address, 100)

          await expect(collateral.connect(marketSigner).settleAccount(user.address, -99))
            .to.emit(collateral, 'AccountSettle')
            .withArgs(market.address, user.address, -99, 0)

          expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(1)
          expect(await collateral['collateral(address)'](market.address)).to.equal(100)
          expect(await collateral.shortfall(market.address)).to.equal(0)
        })

        it('creates a shortfall', async () => {
          await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
          await collateral.depositTo(user.address, market.address, 100)

          await expect(collateral.connect(marketSigner).settleAccount(user.address, -101))
            .to.emit(collateral, 'AccountSettle')
            .withArgs(market.address, user.address, -101, 1)

          expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(0)
          expect(await collateral['collateral(address)'](market.address)).to.equal(100)
          expect(await collateral.shortfall(market.address)).to.equal(1)
        })
      })

      it('reverts if not market', async () => {
        await factory.mock.isMarket.withArgs(user.address).returns(false)

        await expect(collateral.connect(user).settleAccount(user.address, 101)).to.be.revertedWith(
          `NotMarketError("${user.address}")`,
        )
      })
    })

    describe('#claimFee', async () => {
      beforeEach(async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.depositTo(user.address, market.address, 100)

        await factory.mock['treasury()'].returns(treasuryA.address)
        await factory.mock['treasury(address)'].withArgs(market.address).returns(treasuryB.address)
        await factory.mock.protocolFee.returns(utils.parseEther('0.1'))

        await collateral.connect(marketSigner).settleMarket(90)
      })

      it('claims fee', async () => {
        await token.mock.transfer.withArgs(treasuryA.address, 9).returns(true)
        await token.mock.transfer.withArgs(treasuryB.address, 81).returns(true)

        await expect(collateral.connect(treasuryA).claimFee())
          .to.emit(collateral, 'FeeClaim')
          .withArgs(treasuryA.address, 9)

        await expect(collateral.connect(treasuryB).claimFee())
          .to.emit(collateral, 'FeeClaim')
          .withArgs(treasuryB.address, 81)

        expect(await collateral.fees(treasuryA.address)).to.equal(0)
        expect(await collateral.fees(treasuryB.address)).to.equal(0)
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.returns(true)
        await expect(collateral.connect(treasuryB).claimFee()).to.be.revertedWith('PausedError()')
      })
    })

    describe('#claimReward', async () => {
      beforeEach(async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.depositTo(user.address, market.address, 100)

        await factory.mock['treasury()'].returns(treasuryA.address)
        await factory.mock['treasury(address)'].withArgs(market.address).returns(treasuryB.address)
        await factory.mock.protocolFee.returns(utils.parseEther('0.1'))

        await collateral.connect(marketSigner).settleMarket(90)
      })

      it('claims fee', async () => {
        await token.mock.transfer.withArgs(treasuryA.address, 9).returns(true)
        await token.mock.transfer.withArgs(treasuryB.address, 81).returns(true)

        await expect(collateral.connect(treasuryA).claimFee())
          .to.emit(collateral, 'FeeClaim')
          .withArgs(treasuryA.address, 9)

        await expect(collateral.connect(treasuryB).claimFee())
          .to.emit(collateral, 'FeeClaim')
          .withArgs(treasuryB.address, 81)

        expect(await collateral.fees(treasuryA.address)).to.equal(0)
        expect(await collateral.fees(treasuryB.address)).to.equal(0)
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.returns(true)
        await expect(collateral.connect(treasuryB).claimFee()).to.be.revertedWith('PausedError()')
      })
    })
  })
})
