import { expect } from 'chai'
import 'hardhat'
import { constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, INITIAL_VERSION } from '../helpers/setupHelpers'
import { expectPositionEq, parse6decimal } from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'

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
      positionFee: 0,
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

    await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION, 0, 0, COLLATERAL)

    // Check user is in the correct state
    expect((await market.accounts(user.address)).maker).to.equal(0)
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(POSITION)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Check global state
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: 0,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), {
      maker: POSITION,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: 0,
      shortNext: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address)).maker).to.equal(POSITION)
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(POSITION)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION + 1)
  })

  it('opens multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)
    await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)

    await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION, 0, 0, COLLATERAL)

    // Check user is in the correct state
    expect((await market.accounts(user.address)).maker).to.equal(0)
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(POSITION)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Check global state
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: 0,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longReward._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), {
      maker: POSITION,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: 0,
      shortNext: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address)).maker).to.equal(POSITION)
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(POSITION)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION + 1)
  })

  it('closes a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, 0, 0, 0, COLLATERAL)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address)).maker).to.equal(0)
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(0)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Global State
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: 0,
      longNext: 0,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longReward._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)
  })

  it('closes multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)

    await expect(market.connect(user).update(0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, 0, 0, 0, COLLATERAL)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address)).maker).to.equal(0)
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(0)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Global State
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: 0,
      longNext: 0,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longReward._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)
  })

  it('opens a long position', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await expect(market.connect(userB).update(0, POSITION_B, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, POSITION_B, 0, COLLATERAL)

    // User State
    expect((await market.accounts(userB.address)).maker).to.equal(0)
    expect((await market.accounts(userB.address)).long).to.equal(0)
    expect((await market.accounts(userB.address)).short).to.equal(0)
    expect((await market.accounts(userB.address)).nextMaker).to.equal(0)
    expect((await market.accounts(userB.address)).nextLong).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).nextShort).to.equal(0)
    expect((await market.accounts(userB.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Global State
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: POSITION_B,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      maker: POSITION,
      long: POSITION_B,
      short: 0,
      makerNext: POSITION,
      longNext: POSITION_B,
      shortNext: 0,
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address)).maker).to.equal(0)
    expect((await market.accounts(userB.address)).long).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).short).to.equal(0)
    expect((await market.accounts(userB.address)).nextMaker).to.equal(0)
    expect((await market.accounts(userB.address)).nextLong).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).nextShort).to.equal(0)
    expect((await market.accounts(userB.address)).latestVersion).to.equal(INITIAL_VERSION + 2)
  })

  it('opens multiple take positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(0, POSITION_B.div(2), 0, COLLATERAL)

    await expect(market.connect(userB).update(0, POSITION_B, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, POSITION_B, 0, COLLATERAL)

    // User State
    expect((await market.accounts(userB.address)).maker).to.equal(0)
    expect((await market.accounts(userB.address)).long).to.equal(0)
    expect((await market.accounts(userB.address)).short).to.equal(0)
    expect((await market.accounts(userB.address)).nextMaker).to.equal(0)
    expect((await market.accounts(userB.address)).nextLong).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).nextShort).to.equal(0)
    expect((await market.accounts(userB.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Global State
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: POSITION_B,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longReward._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      maker: POSITION,
      long: POSITION_B,
      short: 0,
      makerNext: POSITION,
      longNext: POSITION_B,
      shortNext: 0,
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address)).maker).to.equal(0)
    expect((await market.accounts(userB.address)).long).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).short).to.equal(0)
    expect((await market.accounts(userB.address)).nextMaker).to.equal(0)
    expect((await market.accounts(userB.address)).nextLong).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).nextShort).to.equal(0)
    expect((await market.accounts(userB.address)).latestVersion).to.equal(INITIAL_VERSION + 2)
  })

  it('closes a long position', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(userB).update(0, POSITION_B, 0, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(0, POSITION_B, 0, COLLATERAL)

    await expect(market.connect(userB).update(0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, 0, 0, COLLATERAL)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address)).maker).to.equal(0)
    expect((await market.accounts(userB.address)).long).to.equal(0)
    expect((await market.accounts(userB.address)).short).to.equal(0)
    expect((await market.accounts(userB.address)).nextMaker).to.equal(0)
    expect((await market.accounts(userB.address)).nextLong).to.equal(0)
    expect((await market.accounts(userB.address)).nextShort).to.equal(0)
    expect((await market.accounts(userB.address)).latestVersion).to.equal(INITIAL_VERSION)
    // Global State
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: 0,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longReward._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)
  })

  it('closes multiple long positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(userB).update(0, POSITION_B, 0, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(0, POSITION_B, 0, COLLATERAL)
    await market.connect(userB).update(POSITION_B.div(2), 0, 0, COLLATERAL)

    await expect(market.connect(userB).update(0, 0, 0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, 0, 0, COLLATERAL)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address)).maker).to.equal(0)
    expect((await market.accounts(userB.address)).long).to.equal(0)
    expect((await market.accounts(userB.address)).short).to.equal(0)
    expect((await market.accounts(userB.address)).nextMaker).to.equal(0)
    expect((await market.accounts(userB.address)).nextLong).to.equal(0)
    expect((await market.accounts(userB.address)).nextShort).to.equal(0)
    expect((await market.accounts(userB.address)).latestVersion).to.equal(INITIAL_VERSION)

    // Global State
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: 0,
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version.makerValue._value).to.equal(0)
    expect(version.longValue._value).to.equal(0)
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal(0)
    expect(version.longReward._value).to.equal(0)
    expect(version.shortReward._value).to.equal(0)
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
    await expect(market.update(0, 0, 0, parse6decimal('1000'))).to.be.revertedWith('PausedError()')
    await expect(market.settle(user.address)).to.be.revertedWith('PausedError()')
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
      positionFee: positionFeesOn ? parse6decimal('0.1') : 0,
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

    await market.connect(user).update(POSITION.div(3), 0, 0, COLLATERAL)
    await market.connect(userB).update(0, POSITION.div(3), 0, COLLATERAL)

    await chainlink.next()
    await chainlink.next()

    await market.connect(user).update(POSITION.div(2), 0, 0, COLLATERAL)
    await market.connect(userB).update(0, POSITION.div(2), 0, COLLATERAL)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(market.connect(user).update(POSITION, 0, 0, COLLATERAL.sub(1)))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 4, POSITION, 0, 0, COLLATERAL.sub(1))

    // Check user is in the correct state
    expect((await market.accounts(user.address)).maker).to.equal(POSITION.div(2))
    expect((await market.accounts(user.address)).long).to.equal(0)
    expect((await market.accounts(user.address)).short).to.equal(0)
    expect((await market.accounts(user.address)).nextMaker).to.equal(POSITION)
    expect((await market.accounts(user.address)).nextLong).to.equal(0)
    expect((await market.accounts(user.address)).nextShort).to.equal(0)
    expect((await market.accounts(user.address)).latestVersion).to.equal(INITIAL_VERSION + 4)

    // Check global state
    expect((await market.position()).latestVersion).to.equal(INITIAL_VERSION + 4)
    expectPositionEq(await market.position(), {
      maker: POSITION.div(2),
      long: POSITION.div(2),
      short: 0,
      makerNext: POSITION,
      longNext: POSITION.div(2),
      shortNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION + 4)
    expect(version.makerValue._value).to.equal('-360678818790')
    expect(version.longValue._value).to.equal('362096873938')
    expect(version.shortValue._value).to.equal(0)
    expect(version.makerReward._value).to.equal('606836363635')
    expect(version.longReward._value).to.equal('60683636363')
    expect(version.shortReward._value).to.equal(0)
  })
})
