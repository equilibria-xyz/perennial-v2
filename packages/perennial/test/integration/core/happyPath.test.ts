import { expect } from 'chai'
import 'hardhat'
import { BigNumber } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle } from '../helpers/setupHelpers'
import {
  DEFAULT_POSITION,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
} from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { ChainlinkContext } from '../helpers/chainlinkHelpers'

export const TIMESTAMP_0 = 1631112429
export const TIMESTAMP_1 = 1631112904
export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631115371
export const TIMESTAMP_5 = 1631118731

describe('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()
  })

  it('creates a market', async () => {
    const { owner, marketFactory, beneficiaryB, payoff, oracle, dsu, rewardToken } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: rewardToken.address,
      oracle: oracle.address,
      payoff: payoff.address,
    }
    const riskParameter = {
      maintenance: parse6decimal('0.3'),
      takerFee: 0,
      takerSkewFee: 0,
      takerImpactFee: 0,
      makerFee: 0,
      makerImpactFee: 0,
      makerLimit: parse6decimal('1'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('0.50'),
      minLiquidationFee: parse6decimal('0'),
      maxLiquidationFee: parse6decimal('1000'),
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      pController: {
        k: parse6decimal('40000'),
        max: parse6decimal('1.20'),
      },
      minMaintenance: parse6decimal('500'),
      virtualTaker: parse6decimal('10000'),
      staleAfter: 7200,
      makerReceiveOnly: false,
    }
    const parameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      oracleFee: 0,
      riskFee: 0,
      positionFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      settlementFee: 0,
      makerRewardRate: 0,
      longRewardRate: 0,
      shortRewardRate: 0,
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
    }
    const marketAddress = await marketFactory.callStatic.create(definition)
    await expect(marketFactory.create(definition)).to.emit(marketFactory, 'MarketCreated')
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).updateRiskParameter(riskParameter)
    await market.connect(owner).updateParameter(parameter)
    await market.connect(owner).updateBeneficiary(beneficiaryB.address)
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
      .to.emit(market, 'Updated')
      .withArgs(user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
  })

  it('opens multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION.div(2), 0, 0, COLLATERAL, false)
    await expect(market.connect(user).update(user.address, POSITION, 0, 0, 0, false))
      .to.emit(market, 'Updated')
      .withArgs(user.address, TIMESTAMP_1, POSITION, 0, 0, 0, false)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
  })

  it('closes a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
      .to.emit(market, 'Updated')
      .withArgs(user.address, TIMESTAMP_1, 0, 0, 0, 0, false)

    // User state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })
  })

  it('closes multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false)

    await expect(market.connect(user).update(user.address, 0, 0, 0, 0, false))
      .to.emit(market, 'Updated')
      .withArgs(user.address, TIMESTAMP_1, 0, 0, 0, 0, false)

    // User state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })
  })

  it('opens a long position', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL, false))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, TIMESTAMP_1, 0, POSITION_B, 0, COLLATERAL, false)

    // User State
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      long: POSITION_B,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
      long: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // One round
    await chainlink.next()

    // Another round
    await chainlink.next()
    await settle(market, userB)

    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: '18',
      riskFee: 0,
      oracleFee: 0,
      donation: '18',
    })
    expectPositionEq(await market.pendingPosition(2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_3,
      maker: POSITION,
      long: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      long: POSITION_B,
    })

    expectLocalEq(await market.locals(userB.address), {
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249392')),
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_3,
      long: POSITION_B,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      long: POSITION_B,
    })
  })

  it('opens multiple take positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await market.connect(userB).update(userB.address, 0, POSITION_B.div(2), 0, COLLATERAL, false)

    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, 0, false))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, TIMESTAMP_1, 0, POSITION_B, 0, 0, false)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      long: POSITION_B,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
      long: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // One round
    await chainlink.next()

    // Another round
    await chainlink.next()
    await settle(market, userB)

    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: '18',
      riskFee: 0,
      oracleFee: 0,
      donation: '18',
    })
    expectPositionEq(await market.pendingPosition(2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_3,
      maker: POSITION,
      long: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      long: POSITION_B,
    })
    expectLocalEq(await market.locals(userB.address), {
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249392')),
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 2), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_3,
      long: POSITION_B,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      long: POSITION_B,
    })
  })

  it('closes a long position', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(
      market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL, false),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL, false)

    await expect(market.connect(userB).update(userB.address, 0, 0, 0, 0, false))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, TIMESTAMP_1, 0, 0, 0, 0, false)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })
  })

  it('closes multiple long positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(
      market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL, false),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL, false)
    await market.connect(userB).update(userB.address, POSITION_B.div(2), 0, 0, 0, false)

    await expect(market.connect(userB).update(userB.address, 0, 0, 0, 0, false))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, TIMESTAMP_1, 0, 0, 0, 0, false)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
      reward: 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      delta: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const market = await createMarket(instanceVars)

    await settle(market, user)
    await settle(market, user)
  })

  it('disables actions when paused', async () => {
    const { marketFactory, pauser, user } = instanceVars
    const market = await createMarket(instanceVars)

    await marketFactory.connect(pauser).pause()
    await expect(
      market.connect(user).update(user.address, 0, 0, 0, parse6decimal('1000'), false),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')
    await expect(settle(market, user)).to.be.revertedWithCustomError(market, 'InstancePausedError')
  })

  it('opens a long position and settles after max funding', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL, false))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, TIMESTAMP_1, 0, POSITION_B, 0, COLLATERAL, false)

    // 50 rounds (120% max)
    for (let i = 0; i < 50; i++) {
      await chainlink.next()
    }
    await settle(market, userB)
    expect((await market.global()).pAccumulator._value).to.eq(parse6decimal('1.20'))

    // one more round
    await chainlink.next()
    await settle(market, userB)
    expect((await market.global()).pAccumulator._value).to.eq(parse6decimal('1.20'))
  })

  it('opens a short position and settles after max funding', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(market.connect(userB).update(userB.address, 0, 0, POSITION_B, COLLATERAL, false))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, TIMESTAMP_1, 0, 0, POSITION_B, COLLATERAL, false)

    // 50 rounds (120% max)
    for (let i = 0; i < 50; i++) {
      await chainlink.next()
    }
    await settle(market, userB)
    expect((await market.global()).pAccumulator._value).to.eq(parse6decimal('-1.20'))

    // one more round
    await chainlink.next()
    await settle(market, userB)
    expect((await market.global()).pAccumulator._value).to.eq(parse6decimal('-1.20'))
  })

  it('delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const incentizesOn = true

    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, oracle, payoff } = instanceVars

    const riskParameter = {
      maintenance: parse6decimal('0.3'),

      takerFee: positionFeesOn ? parse6decimal('0.001') : 0,
      takerSkewFee: positionFeesOn ? parse6decimal('0.0006') : 0,
      takerImpactFee: positionFeesOn ? parse6decimal('0.0004') : 0,
      makerFee: positionFeesOn ? parse6decimal('0.0005') : 0,
      makerImpactFee: positionFeesOn ? parse6decimal('0.0002') : 0,
      makerLimit: parse6decimal('1'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('0.50'),
      minLiquidationFee: parse6decimal('0'),
      maxLiquidationFee: parse6decimal('1000'),
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      pController: {
        k: parse6decimal('40000'),
        max: parse6decimal('1.20'),
      },
      minMaintenance: parse6decimal('500'),
      virtualTaker: parse6decimal('10000'),
      staleAfter: 7200,
      makerReceiveOnly: false,
    }
    const parameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      oracleFee: 0,
      riskFee: 0,
      settlementFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      positionFee: positionFeesOn ? parse6decimal('0.1') : 0,
      makerRewardRate: incentizesOn ? parse6decimal('0.01') : 0,
      longRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      shortRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    await market.connect(user).update(user.address, POSITION.div(3), 0, 0, COLLATERAL, false)
    await market.connect(userB).update(userB.address, 0, POSITION.div(3), 0, COLLATERAL, false) // 0 -> 1

    await chainlink.next()
    await chainlink.next()

    await market.connect(user).update(user.address, POSITION.div(2), 0, 0, 0, false) // 2 -> 3
    await market.connect(userB).update(userB.address, 0, POSITION.div(2), 0, 0, false)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, -1, false)) // 4 -> 5
      .to.emit(market, 'Updated')
      .withArgs(user.address, TIMESTAMP_5, POSITION, 0, 0, -1, false)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: 3,
      latestId: 2,
      collateral: '986127025',
      reward: incentizesOn ? '24669998' : 0,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 3), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_5,
      maker: POSITION,
      fee: '234925',
      delta: COLLATERAL.sub(1),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_4,
      maker: POSITION.div(2),
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 3,
      latestId: 2,
      protocolFee: '267859',
      riskFee: 0,
      oracleFee: 0,
      donation: '267862',
    })
    expectPositionEq(await market.pendingPosition(3), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_5,
      maker: POSITION,
      long: POSITION.div(2),
      fee: '234925',
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_4,
      maker: POSITION.div(2),
      long: POSITION.div(2),
    })
    expectVersionEq(await market.versions(TIMESTAMP_4), {
      makerValue: { _value: '-354909471518' },
      longValue: { _value: '362096873938' },
      shortValue: { _value: 0 },
      makerReward: { _value: incentizesOn ? '606836363635' : 0 },
      longReward: { _value: incentizesOn ? '60683636363' : 0 },
      shortReward: { _value: 0 },
    })
  })

  // uncheck skip to see gas results
  it.skip('multi-delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const incentizesOn = true
    const delay = 5
    const sync = true

    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')

    const chainlink = await new ChainlinkContext(
      CHAINLINK_CUSTOM_CURRENCIES.ETH,
      CHAINLINK_CUSTOM_CURRENCIES.USD,
      delay,
    ).init()
    const instanceVars = await deployProtocol(chainlink)
    const { user, userB, dsu, oracle } = instanceVars

    const riskParameter = {
      maintenance: parse6decimal('0.3'),
      takerFee: positionFeesOn ? parse6decimal('0.001') : 0,
      takerSkewFee: positionFeesOn ? parse6decimal('0.0006') : 0,
      takerImpactFee: positionFeesOn ? parse6decimal('0.0004') : 0,
      makerFee: positionFeesOn ? parse6decimal('0.0005') : 0,
      makerImpactFee: positionFeesOn ? parse6decimal('0.0002') : 0,
      makerLimit: parse6decimal('1'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('0.50'),
      minLiquidationFee: parse6decimal('0'),
      maxLiquidationFee: parse6decimal('1000'),
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      pController: {
        k: parse6decimal('40000'),
        max: parse6decimal('1.20'),
      },
      minMaintenance: parse6decimal('500'),
      virtualTaker: parse6decimal('10000'),
      staleAfter: 100000, // enable long delays for testing
      makerReceiveOnly: false,
    }
    const parameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      oracleFee: 0,
      riskFee: 0,
      settlementFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      positionFee: positionFeesOn ? parse6decimal('0.1') : 0,
      makerRewardRate: incentizesOn ? parse6decimal('0.01') : 0,
      longRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      shortRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    for (let i = 0; i < delay; i++) {
      await market.connect(user).update(user.address, POSITION.sub(delay - i), 0, 0, i == 0 ? COLLATERAL : 0, false)
      await market.connect(userB).update(userB.address, 0, POSITION.sub(delay - i), 0, i == 0 ? COLLATERAL : 0, false)

      await chainlink.next()
    }

    // ensure all pending can settle
    for (let i = 0; i < delay - 1; i++) await chainlink.next()
    if (sync) await chainlink.next()

    // const currentVersion = delay + delay + delay - (sync ? 0 : 1)
    // const latestVersion = delay + delay - (sync ? 0 : 1)

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, -1, false))
      .to.emit(market, 'Updated')
      .withArgs(user.address, await chainlink.oracle.current(), POSITION, 0, 0, -1, false)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: delay + 1,
      latestId: delay,
      collateral: (await market.locals(user.address)).collateral,
      reward: (await market.locals(user.address)).reward,
      protection: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, delay + 1), {
      ...DEFAULT_POSITION,
      timestamp: await chainlink.oracle.current(),
      maker: POSITION,
      fee: (await market.pendingPositions(user.address, delay + 1)).fee,
      delta: COLLATERAL.sub(1),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: (await chainlink.oracle.latest()).timestamp,
      maker: POSITION.sub(1),
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: delay + 1,
      latestId: delay,
      protocolFee: (await market.global()).protocolFee,
      riskFee: (await market.global()).riskFee,
      oracleFee: (await market.global()).oracleFee,
      donation: (await market.global()).donation,
    })
    expectPositionEq(await market.pendingPosition(delay + 1), {
      ...DEFAULT_POSITION,
      timestamp: await chainlink.oracle.current(),
      maker: POSITION,
      long: POSITION.sub(1),
      fee: (await market.pendingPosition(delay + 1)).fee,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: (await chainlink.oracle.latest()).timestamp,
      maker: POSITION.sub(1),
      long: POSITION.sub(1),
    })
  })
})
