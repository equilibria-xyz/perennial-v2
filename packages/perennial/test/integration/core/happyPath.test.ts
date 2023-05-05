import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, INITIAL_VERSION } from '../helpers/setupHelpers'
import {
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
} from '../../../../common/testutil/types'
import { ChainlinkOracle__factory, Market__factory } from '../../../types/generated'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'

//TODO: short tests

describe('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('creates a market', async () => {
    const { owner, factory, treasuryB, payoffProvider, chainlinkOracle, dsu, rewardToken } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: rewardToken.address,
    }
    const parameter = {
      maintenance: parse6decimal('0.3'),
      fundingFee: parse6decimal('0.1'),
      takerFee: 0,
      makerFee: 0,
      positionFee: 0,
      makerLiquidity: parse6decimal('0.2'),
      makerLimit: parse6decimal('1'),
      closed: true,
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      makerRewardRate: 0,
      longRewardRate: 0,
      shortRewardRate: 0,
      oracle: chainlinkOracle.address,
      payoff: {
        provider: payoffProvider.address,
        short: false,
      },
    }
    const marketAddress = await factory.callStatic.createMarket(definition, parameter)
    await expect(factory.createMarket(definition, parameter)).to.emit(factory, 'MarketCreated')
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).acceptOwner()
    await market.connect(owner).updateTreasury(treasuryB.address)
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 1, POSITION, 0, 0, COLLATERAL)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(user.address)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
  })

  it('opens multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION.div(2), 0, 0, COLLATERAL)

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 1, POSITION, 0, 0, COLLATERAL)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(user.address)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
  })

  it('closes a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 1, 0, 0, 0, COLLATERAL)

    // User state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
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

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await market.connect(user).update(user.address, POSITION.div(2), 0, 0, COLLATERAL)

    await expect(market.connect(user).update(user.address, 0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 1, 0, 0, 0, COLLATERAL)

    // User state
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
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
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION + 1, 0, POSITION_B, 0, COLLATERAL)

    // User State
    expectLocalEq(await market.locals(user.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.positions(userB.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(userB.address)

    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: '16',
      marketFee: '17',
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 1,
      version: INITIAL_VERSION + 2,
      maker: POSITION,
      long: POSITION_B,
      short: 0,
    })

    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249431')),
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.positions(userB.address), {
      id: 1,
      version: INITIAL_VERSION + 2,
      maker: 0,
      long: POSITION_B,
      short: 0,
    })
  })

  it('opens multiple take positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(userB.address, 0, POSITION_B.div(2), 0, COLLATERAL)

    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION + 1, 0, POSITION_B, 0, COLLATERAL)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.positions(userB.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      makerReward: { _value: 0 },
      longReward: { _value: 0 },
      shortReward: { _value: 0 },
    })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(userB.address)

    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: '16',
      marketFee: '17',
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 1,
      version: INITIAL_VERSION + 2,
      maker: POSITION,
      long: POSITION_B,
      short: 0,
    })
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249431')),
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: POSITION_B,
      short: 0,
    })
    expectPositionEq(await market.positions(userB.address), {
      id: 1,
      version: INITIAL_VERSION + 2,
      maker: 0,
      long: POSITION_B,
      short: 0,
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

    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL)

    await expect(market.connect(userB).update(userB.address, 0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION + 1, 0, 0, 0, COLLATERAL)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(userB.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
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

    await expect(market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(userB.address, 0, POSITION_B, 0, COLLATERAL)
    await market.connect(userB).update(userB.address, POSITION_B.div(2), 0, 0, COLLATERAL)

    await expect(market.connect(userB).update(userB.address, 0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION + 1, 0, 0, 0, COLLATERAL)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      currentId: 1,
      collateral: COLLATERAL,
      reward: 0,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(userB.address, 1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(userB.address), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 1,
      protocolFee: 0,
      marketFee: 0,
    })
    expectPositionEq(await market.pendingPosition(1), {
      id: 1,
      version: INITIAL_VERSION + 1,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 0,
      version: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION), {
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

    await market.settle(user.address)
    await market.settle(user.address)
  })

  it('disables actions when paused', async () => {
    const { factory, pauser, user } = instanceVars
    const market = await createMarket(instanceVars)

    await expect(factory.connect(pauser).updatePaused(true)).to.emit(factory, 'ParameterUpdated')
    await expect(market.connect(user.address).update(user.address, 0, 0, 0, parse6decimal('1000'))).to.be.revertedWith(
      'PausedError()',
    )
    await expect(market.connect(user.address).settle(user.address)).to.be.revertedWith('PausedError()')
  })

  it('delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const incentizesOn = true

    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle, payoffProvider } = instanceVars

    const parameter = {
      maintenance: parse6decimal('0.3'),
      fundingFee: parse6decimal('0.1'),
      takerFee: positionFeesOn ? parse6decimal('0.001') : 0,
      makerFee: positionFeesOn ? parse6decimal('0.0005') : 0,
      positionFee: positionFeesOn ? parse6decimal('0.1') : 0,
      makerLiquidity: parse6decimal('0.2'),
      makerLimit: parse6decimal('1'),
      closed: false,
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      makerRewardRate: incentizesOn ? parse6decimal('0.01') : 0,
      longRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      shortRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      oracle: chainlinkOracle.address,
      payoff: {
        provider: payoffProvider.address,
        short: false,
      },
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    await market.connect(user).update(user.address, POSITION.div(3), 0, 0, COLLATERAL)
    await market.connect(userB).update(userB.address, 0, POSITION.div(3), 0, COLLATERAL) // 0 -> 1

    await chainlink.next()
    await chainlink.next()

    await market.connect(user).update(user.address, POSITION.div(2), 0, 0, COLLATERAL) // 2 -> 3
    await market.connect(userB).update(userB.address, 0, POSITION.div(2), 0, COLLATERAL)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL.sub(1))) // 4 -> 5
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 5, POSITION, 0, 0, COLLATERAL.sub(1))

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: 3,
      collateral: COLLATERAL.sub(1),
      reward: '24669998',
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, 3), {
      id: 3,
      version: INITIAL_VERSION + 5,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: 2,
      version: INITIAL_VERSION + 4,
      maker: POSITION.div(2),
      long: 0,
      short: 0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 3,
      protocolFee: '9578',
      marketFee: '9580',
    })
    expectPositionEq(await market.pendingPosition(3), {
      id: 3,
      version: INITIAL_VERSION + 5,
      maker: POSITION,
      long: POSITION.div(2),
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: 2,
      version: INITIAL_VERSION + 4,
      maker: POSITION.div(2),
      long: POSITION.div(2),
      short: 0,
    })
    expectVersionEq(await market.versions(INITIAL_VERSION + 4), {
      makerValue: { _value: '-362547683639' },
      longValue: { _value: '362096873938' },
      shortValue: { _value: 0 },
      makerReward: { _value: '606836363635' },
      longReward: { _value: '60683636363' },
      shortReward: { _value: 0 },
    })
  })

  it.skip('multi-delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const incentizesOn = true
    const delay = 5
    const sync = true

    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, userB, dsu, chainlink, payoffProvider } = instanceVars

    const chainlinkOracle = await new ChainlinkOracle__factory(owner).deploy(
      chainlink.feedRegistry.address,
      CHAINLINK_CUSTOM_CURRENCIES.ETH,
      CHAINLINK_CUSTOM_CURRENCIES.USD,
      delay,
    )
    const parameter = {
      maintenance: parse6decimal('0.3'),
      fundingFee: parse6decimal('0.1'),
      takerFee: positionFeesOn ? parse6decimal('0.001') : 0,
      makerFee: positionFeesOn ? parse6decimal('0.0005') : 0,
      positionFee: positionFeesOn ? parse6decimal('0.1') : 0,
      makerLiquidity: parse6decimal('0.2'),
      makerLimit: parse6decimal('1'),
      closed: false,
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      makerRewardRate: incentizesOn ? parse6decimal('0.01') : 0,
      longRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      shortRewardRate: incentizesOn ? parse6decimal('0.001') : 0,
      oracle: chainlinkOracle.address,
      payoff: {
        provider: payoffProvider.address,
        short: false,
      },
    }

    const market = await createMarket(instanceVars, 'Squeeth', 'SQTH', chainlinkOracle)
    await market.updateParameter(parameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    for (let i = 0; i < delay; i++) {
      await market.connect(user).update(user.address, POSITION.sub(delay - i), 0, 0, COLLATERAL)
      await market.connect(userB).update(userB.address, 0, POSITION.sub(delay - i), 0, COLLATERAL) // 0 -> 1

      await chainlink.next()
    }

    // ensure all pending can settle
    for (let i = 0; i < delay - 1; i++) await chainlink.next()
    if (sync) await chainlink.next()

    const currentVersion = delay + delay + delay - (sync ? 0 : 1)
    const latestVersion = delay + delay - (sync ? 0 : 1)

    await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL.sub(1))) // 2 -> 4
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + currentVersion, POSITION, 0, 0, COLLATERAL.sub(1))

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      currentId: delay + 1,
      collateral: COLLATERAL.sub(1),
      reward: (await market.locals(user.address)).reward,
      liquidation: 0,
    })
    expectPositionEq(await market.pendingPositions(user.address, delay + 1), {
      id: delay + 1,
      version: INITIAL_VERSION + currentVersion,
      maker: POSITION,
      long: 0,
      short: 0,
    })
    expectPositionEq(await market.positions(user.address), {
      id: delay,
      version: INITIAL_VERSION + latestVersion,
      maker: POSITION.sub(1),
      long: 0,
      short: 0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: delay + 1,
      protocolFee: (await market.global()).protocolFee,
      marketFee: (await market.global()).marketFee,
    })
    expectPositionEq(await market.pendingPosition(delay + 1), {
      id: delay + 1,
      version: INITIAL_VERSION + currentVersion,
      maker: POSITION,
      long: POSITION.sub(1),
      short: 0,
    })
    expectPositionEq(await market.position(), {
      id: delay,
      version: INITIAL_VERSION + latestVersion,
      maker: POSITION.sub(1),
      long: POSITION.sub(1),
      short: 0,
    })
  })
})
