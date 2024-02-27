import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants } from 'ethers'
const { AddressZero } = constants

import { InstanceVars, deployProtocol, createMarket, settle } from '../helpers/setupHelpers'
import {
  DEFAULT_ORDER,
  DEFAULT_POSITION,
  DEFAULT_LOCAL,
  DEFAULT_VERSION,
  DEFAULT_CHECKPOINT,
  expectOrderEq,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
  expectCheckpointEq,
} from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { ChainlinkContext } from '../helpers/chainlinkHelpers'
import { RiskParameterStruct } from '../../../types/generated/contracts/Market'

export const TIMESTAMP_0 = 1631112429
export const TIMESTAMP_1 = 1631112904
export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631115371
export const TIMESTAMP_5 = 1631118731

describe('Happy Path', () => {
  let instanceVars: InstanceVars
  let riskParameter: RiskParameterStruct

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()
  })

  it('creates a market', async () => {
    const { owner, marketFactory, beneficiaryB, payoff, oracle, dsu } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      oracle: oracle.address,
      payoff: payoff.address,
    }
    riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      takerFee: {
        linearFee: 0,
        proportionalFee: 0,
        adiabaticFee: 0,
        scale: parse6decimal('10000'),
      },
      makerFee: {
        linearFee: 0,
        proportionalFee: 0,
        adiabaticFee: 0,
        scale: parse6decimal('10000'),
      },
      makerLimit: parse6decimal('1'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('10.00'),
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      pController: {
        k: parse6decimal('40000'),
        min: parse6decimal('-1.20'),
        max: parse6decimal('1.20'),
      },
      minMargin: parse6decimal('500'),
      minMaintenance: parse6decimal('500'),
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
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
      settle: false,
    }
    const marketAddress = await marketFactory.callStatic.create(definition)
    await expect(marketFactory.create(definition)).to.emit(marketFactory, 'MarketCreated')
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).updateRiskParameter(riskParameter)
    await market.connect(owner).updateParameter(beneficiaryB.address, AddressZero, parameter)
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false, constants.AddressZero)
      .to.emit(market, 'OrderCreated')
      .withArgs(user.address, {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        collateral: COLLATERAL,
        makerPos: POSITION,
      })

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
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
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
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
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
  })

  it('opens multiple make positions', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, COLLATERAL, false)
    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, 0, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, TIMESTAMP_1, POSITION, 0, 0, 0, false, constants.AddressZero)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 2,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
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
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 2,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
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
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
  })

  it('closes a make position', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

    await chainlink.next()

    await expect(
      market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, TIMESTAMP_2, 0, 0, 0, 0, false, constants.AddressZero)
      .to.emit(market, 'OrderCreated')
      .withArgs(user.address, {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerNeg: POSITION,
      })

    // User state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 1,
      makerNeg: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      timestamp: TIMESTAMP_1,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 1,
      makerNeg: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      timestamp: TIMESTAMP_1,
    })
    expectVersionEq(await market.versions(TIMESTAMP_1), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
    })
  })

  it('closes multiple make positions', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

    await chainlink.next()

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)
    await expect(
      market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, TIMESTAMP_2, 0, 0, 0, 0, false, constants.AddressZero)

    // User state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 2,
      makerNeg: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      timestamp: TIMESTAMP_1,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 2,
      makerNeg: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      timestamp: TIMESTAMP_1,
    })
    expectVersionEq(await market.versions(TIMESTAMP_1), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
    })
  })

  it('opens a long position', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    const riskParameterTakerFee = { ...riskParameter.takerFee }
    riskParameterTakerFee.scale = parse6decimal('1')
    riskParameter.takerFee = riskParameterTakerFee
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(userB.address, userB.address, TIMESTAMP_1, 0, POSITION_B, 0, COLLATERAL, false, constants.AddressZero)
      .to.emit(market, 'OrderCreated')
      .withArgs(userB.address, {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        collateral: COLLATERAL,
        longPos: POSITION_B,
      })

    // User State
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(userB.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      collateral: COLLATERAL,
      longPos: POSITION_B,
    })
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
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
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 2,
      collateral: COLLATERAL.mul(2),
      makerPos: POSITION,
      longPos: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
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
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_3,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      long: POSITION_B,
    })

    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249392')),
    })
    expectOrderEq(await market.pendingOrders(userB.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_3,
    })
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_3), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      long: POSITION_B,
    })
  })

  it('opens multiple take positions', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    const riskParameterTakerFee = { ...riskParameter.takerFee }
    riskParameterTakerFee.scale = parse6decimal('1')
    riskParameter.takerFee = riskParameterTakerFee
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B.div(2), 0, COLLATERAL, false)

    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, 0, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(userB.address, userB.address, TIMESTAMP_1, 0, POSITION_B, 0, 0, false, constants.AddressZero)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(userB.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 2,
      collateral: COLLATERAL,
      longPos: POSITION_B,
    })
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
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
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 3,
      collateral: COLLATERAL.mul(2),
      makerPos: POSITION,
      longPos: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
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
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_3,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      long: POSITION_B,
    })
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249392')),
    })
    expectOrderEq(await market.pendingOrders(userB.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_3,
    })
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_3), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      long: POSITION_B,
    })
  })

  it('closes a long position', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false)

    await chainlink.next()

    await expect(
      market.connect(userB)['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(userB.address, userB.address, TIMESTAMP_2, 0, 0, 0, 0, false, constants.AddressZero)
      .to.emit(market, 'OrderCreated')
      .withArgs(userB.address, {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longNeg: POSITION_B,
      })

    // User State
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(userB.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 1,
      longNeg: POSITION_B,
    })
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      long: POSITION_B,
      timestamp: TIMESTAMP_1,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 1,
      longNeg: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      long: POSITION_B,
      timestamp: TIMESTAMP_1,
    })
    expectVersionEq(await market.versions(TIMESTAMP_1), {
      ...DEFAULT_VERSION,
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
      liquidationFee: { _value: -riskParameter.liquidationFee },
    })
  })

  it('closes multiple long positions', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false)

    await chainlink.next()

    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B.div(2), 0, 0, false)

    await expect(
      market.connect(userB)['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(userB.address, userB.address, TIMESTAMP_2, 0, 0, 0, 0, false, constants.AddressZero)

    // User State
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(userB.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 2,
      longNeg: POSITION_B,
    })
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      long: POSITION_B,
      timestamp: TIMESTAMP_1,
    })

    // Global State
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
    })
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 2,
      longNeg: POSITION_B,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      long: POSITION_B,
      timestamp: TIMESTAMP_1,
    })
    expectVersionEq(await market.versions(TIMESTAMP_1), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: -riskParameter.liquidationFee },
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
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, parse6decimal('1000'), false),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')
    await expect(settle(market, user)).to.be.revertedWithCustomError(market, 'InstancePausedError')
  })

  it('opens a long position and settles after max funding', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    const riskParameterTakerFee = { ...riskParameter.takerFee }
    riskParameterTakerFee.scale = parse6decimal('1')
    riskParameter.takerFee = riskParameterTakerFee
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(userB.address, userB.address, TIMESTAMP_1, 0, POSITION_B, 0, COLLATERAL, false, constants.AddressZero)

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
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    const riskParameterTakerFee = { ...riskParameter.takerFee }
    riskParameterTakerFee.scale = parse6decimal('1')
    riskParameter.takerFee = riskParameterTakerFee
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, POSITION_B, COLLATERAL, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(userB.address, userB.address, TIMESTAMP_1, 0, 0, POSITION_B, COLLATERAL, false, constants.AddressZero)

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

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, beneficiaryB } = instanceVars

    const riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      takerFee: {
        linearFee: positionFeesOn ? parse6decimal('0.001') : 0,
        proportionalFee: positionFeesOn ? parse6decimal('0.0006') : 0,
        adiabaticFee: positionFeesOn ? parse6decimal('0.0004') : 0,
        scale: parse6decimal('10000'),
      },
      makerFee: {
        linearFee: positionFeesOn ? parse6decimal('0.0005') : 0,
        proportionalFee: positionFeesOn ? parse6decimal('0.0002') : 0,
        adiabaticFee: positionFeesOn ? parse6decimal('0.0003') : 0,
        scale: parse6decimal('10000'),
      },
      makerLimit: parse6decimal('100000'),
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
        min: parse6decimal('-1.20'),
        max: parse6decimal('1.20'),
      },
      minMargin: parse6decimal('500'),
      minMaintenance: parse6decimal('500'),
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
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
      settle: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(beneficiaryB.address, AddressZero, parameter)
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(3), 0, 0, COLLATERAL, false)
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION.div(3), 0, COLLATERAL, false) // 0 -> 1

    await chainlink.next()
    await chainlink.next()

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false) // 2 -> 3
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION.div(2), 0, 0, false)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
    ) // 4 -> 5
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, TIMESTAMP_5, POSITION, 0, 0, -1, false, constants.AddressZero)

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 3,
      latestId: 2,
      collateral: '986141042',
    })
    expectOrderEq(await market.pendingOrders(user.address, 3), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_5,
      orders: 1,
      collateral: -1,
      makerPos: POSITION.div(2),
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_5), {
      ...DEFAULT_CHECKPOINT,
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
      protocolFee: '308688',
      riskFee: 0,
      oracleFee: 0,
      donation: '308690',
    })
    expectOrderEq(await market.pendingOrder(3), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_5,
      orders: 1,
      collateral: -1,
      makerPos: POSITION.div(2),
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_4,
      maker: POSITION.div(2),
      long: POSITION.div(2),
    })
    expectVersionEq(await market.versions(TIMESTAMP_4), {
      ...DEFAULT_VERSION,
      makerValue: { _value: '-3545883' },
      longValue: { _value: '3620965' },
      shortValue: { _value: 0 },
      liquidationFee: { _value: -riskParameter.liquidationFee },
    })
  })

  // uncheck skip to see gas results
  it.skip('multi-delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const delay = 5
    const sync = true

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')

    const chainlink = await new ChainlinkContext(
      CHAINLINK_CUSTOM_CURRENCIES.ETH,
      CHAINLINK_CUSTOM_CURRENCIES.USD,
      undefined,
      delay,
    ).init()

    const instanceVars = await deployProtocol(chainlink)
    const { user, userB, dsu, beneficiaryB, payoff } = instanceVars

    const riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      takerFee: {
        linearFee: positionFeesOn ? parse6decimal('0.001') : 0,
        proportionalFee: positionFeesOn ? parse6decimal('0.0006') : 0,
        adiabaticFee: positionFeesOn ? parse6decimal('0.0004') : 0,
        scale: parse6decimal('10000'),
      },
      makerFee: {
        linearFee: positionFeesOn ? parse6decimal('0.0005') : 0,
        proportionalFee: positionFeesOn ? parse6decimal('0.0002') : 0,
        adiabaticFee: positionFeesOn ? parse6decimal('0.0003') : 0,
        scale: parse6decimal('10000'),
      },
      makerLimit: parse6decimal('100000'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('10.00'),
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      pController: {
        k: parse6decimal('40000'),
        min: parse6decimal('-1.20'),
        max: parse6decimal('1.20'),
      },
      minMargin: parse6decimal('500'),
      minMaintenance: parse6decimal('500'),
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
      makerCloseAlways: false,
      takerCloseAlways: false,
      closed: false,
      settle: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(beneficiaryB.address, AddressZero, parameter)
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    for (let i = 0; i < delay; i++) {
      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          user.address,
          POSITION.sub(delay - i),
          0,
          0,
          i == 0 ? COLLATERAL : 0,
          false,
        )
      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          userB.address,
          0,
          POSITION.sub(delay - i),
          0,
          i == 0 ? COLLATERAL : 0,
          false,
        )

      await chainlink.next()
    }

    // ensure all pending can settle
    for (let i = 0; i < delay - 1; i++) await chainlink.next()
    if (sync) await chainlink.next()

    // const currentVersion = delay + delay + delay - (sync ? 0 : 1)
    // const latestVersion = delay + delay - (sync ? 0 : 1)

    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(
        user.address,
        user.address,
        await chainlink.oracle.current(),
        POSITION,
        0,
        0,
        -1,
        false,
        constants.AddressZero,
      )

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: delay + 1,
      latestId: delay,
      collateral: (await market.locals(user.address)).collateral,
    })
    expectOrderEq(await market.pendingOrders(user.address, delay + 1), {
      ...DEFAULT_ORDER,
      timestamp: await chainlink.oracle.current(),
      makerNeg: 1,
    })
    expectCheckpointEq(await market.checkpoints(user.address, delay + 1), {
      ...DEFAULT_CHECKPOINT,
      tradeFee: (await market.checkpoints(user.address, delay + 1)).tradeFee,
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
    expectOrderEq(await market.pendingOrder(delay + 1), {
      ...DEFAULT_ORDER,
      timestamp: await chainlink.oracle.current(),
      orders: 1,
      makerPos: 1,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: (await chainlink.oracle.latest()).timestamp,
      maker: POSITION.sub(1),
      long: POSITION.sub(1),
    })
  })
})
