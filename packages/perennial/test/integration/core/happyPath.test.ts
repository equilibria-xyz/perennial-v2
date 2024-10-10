import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle, fundWallet } from '../helpers/setupHelpers'
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
  DEFAULT_GLOBAL,
  DEFAULT_GUARANTEE,
  DEFAULT_RISK_PARAMETER,
  DEFAULT_MARKET_PARAMETER,
  expectGuaranteeEq,
} from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { ChainlinkContext } from '../helpers/chainlinkHelpers'
import { IntentStruct, RiskParameterStruct } from '../../../types/generated/contracts/Market'
import {
  signAccessUpdateBatch,
  signIntent,
  signOperatorUpdate,
  signSignerUpdate,
} from '../../../../perennial-verifier/test/helpers/erc712'
import { Verifier__factory } from '../../../../perennial-verifier/types/generated'

export const TIMESTAMP_0 = 1631112429
export const TIMESTAMP_1 = 1631112904
export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631115371
export const TIMESTAMP_5 = 1631118731

export const PRICE_0 = parse6decimal('113.882975')
export const PRICE_1 = parse6decimal('113.796498')
export const PRICE_2 = parse6decimal('115.046259')
export const PRICE_4 = parse6decimal('117.462552')

describe('Happy Path', () => {
  let instanceVars: InstanceVars
  let riskParameter: RiskParameterStruct

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()

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
  })

  it('reverts when market factory is reinitialized', async () => {
    const { marketFactory } = instanceVars
    await expect(marketFactory.initialize())
      .to.be.revertedWithCustomError(marketFactory, 'InitializableAlreadyInitializedError')
      .withArgs(1)
  })

  it('creates a market', async () => {
    const { owner, marketFactory, payoff, oracle, dsu } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      oracle: dsu.address,
      payoff: payoff.address,
    }
    const parameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      riskFee: 0,
      makerFee: 0,
      takerFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      closed: false,
      settle: false,
    }

    // revert when invalid oracle is provided
    await expect(marketFactory.create(definition)).to.be.revertedWithCustomError(
      marketFactory,
      'FactoryInvalidOracleError',
    )

    // update correct oracle address
    definition.oracle = oracle.address
    await expect(marketFactory.create(definition)).to.emit(marketFactory, 'MarketCreated')
    const marketAddress = await marketFactory.markets(oracle.address)

    // revert when creating another market with same oracle
    await expect(marketFactory.create(definition)).to.be.revertedWithCustomError(
      marketFactory,
      'FactoryAlreadyRegisteredError',
    )
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).updateRiskParameter(riskParameter)
    await market.connect(owner).updateParameter(parameter)

    const marketDefinition = {
      token: dsu.address,
      oracle: oracle.address,
    }

    // revert when reinitialized
    await expect(market.connect(owner).initialize(marketDefinition))
      .to.be.revertedWithCustomError(market, 'InitializableAlreadyInitializedError')
      .withArgs(1)
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          collateral: COLLATERAL,
          makerPos: POSITION,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      makerPos: POSITION,
      collateral: COLLATERAL,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      transfer: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestId: 1,
      latestPrice: PRICE_1,
    })
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      makerPos: POSITION,
      collateral: COLLATERAL,
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_1, orders: 1, makerPos: POSITION.div(2) },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
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
      transfer: COLLATERAL,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestId: 1,
      latestPrice: PRICE_1,
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          makerNeg: POSITION,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 2,
      latestId: 1,
      latestPrice: PRICE_1,
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
      price: PRICE_1,
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_2, orders: 1, makerNeg: POSITION.div(2) },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 2,
      latestId: 1,
      latestPrice: PRICE_1,
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
      price: PRICE_1,
    })
  })

  it('opens a long position', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
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
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          collateral: COLLATERAL,
          longPos: POSITION_B,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })

    // One round
    await chainlink.next()

    // Another round
    await chainlink.next()
    await settle(market, userB)

    expectGlobalEq(await market.global(), {
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestId: 1,
      protocolFee: '36',
      latestPrice: PRICE_2,
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
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      long: POSITION_B,
    })

    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249392')),
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
      transfer: COLLATERAL,
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
    riskParameter.makerLimit = parse6decimal('10')
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_1, orders: 1, longPos: POSITION_B.div(2) },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })

    // One round
    await chainlink.next()

    // Another round
    await chainlink.next()
    await settle(market, userB)

    expectGlobalEq(await market.global(), {
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestId: 1,
      protocolFee: '36',
      latestPrice: PRICE_2,
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
      timestamp: TIMESTAMP_2,
      maker: POSITION,
      long: POSITION_B,
    })
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
      collateral: COLLATERAL.add(BigNumber.from('1249392')),
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
      transfer: COLLATERAL,
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          longNeg: POSITION_B,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 2,
      latestId: 1,
      latestPrice: PRICE_1,
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
      price: PRICE_1,
      makerValue: { _value: 0 },
      longValue: { _value: 0 },
      shortValue: { _value: 0 },
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_2, orders: 1, longNeg: POSITION_B.div(2) },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 2,
      latestId: 1,
      latestPrice: PRICE_1,
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
      price: PRICE_1,
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

    await expect(
      market.connect(user)['update(address,int256,int256,address)'](user.address, 0, 0, constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')

    const intent = {
      amount: 0,
      price: 0,
      fee: 0,
      originator: constants.AddressZero,
      solver: constants.AddressZero,
      collateralization: 0,
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: 0,
      },
    }

    await expect(
      market
        .connect(user)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](user.address, intent, '0x'),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')
  })

  it('disables actions when unauthorized access', async () => {
    const { marketFactory, user, oracle, dsu, payoff } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      oracle: oracle.address,
      payoff: payoff.address,
    }

    await expect(marketFactory.connect(user).create(definition)).to.be.revertedWithCustomError(
      marketFactory,
      'OwnableNotOwnerError',
    )

    await expect(
      marketFactory.connect(user).updateParameter(await marketFactory.parameter()),
    ).to.be.revertedWithCustomError(marketFactory, 'OwnableNotOwnerError')

    await expect(
      marketFactory.connect(user).updateReferralFee(user.address, parse6decimal('0.5')),
    ).to.be.revertedWithCustomError(marketFactory, 'OwnableNotOwnerError')

    const market = await createMarket(instanceVars)

    await expect(market.connect(user).updateBeneficiary(user.address)).to.be.revertedWithCustomError(
      market,
      'InstanceNotOwnerError',
    )

    await expect(market.connect(user).updateCoordinator(user.address)).to.be.revertedWithCustomError(
      market,
      'InstanceNotOwnerError',
    )

    await expect(market.connect(user).updateParameter(DEFAULT_MARKET_PARAMETER)).to.be.revertedWithCustomError(
      market,
      'InstanceNotOwnerError',
    )

    await expect(market.connect(user).updateRiskParameter(DEFAULT_RISK_PARAMETER)).to.be.revertedWithCustomError(
      market,
      'MarketNotCoordinatorError',
    )

    await expect(market.connect(user).claimExposure()).to.be.revertedWithCustomError(market, 'InstanceNotOwnerError')
  })

  it('disables update when settle only mode', async () => {
    const { user, owner } = instanceVars
    const market = await createMarket(instanceVars)

    const parameters = { ...(await market.parameter()) }
    parameters.settle = true

    await market.connect(owner).updateParameter(parameters)

    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, parse6decimal('1000'), false),
    ).to.be.revertedWithCustomError(market, 'MarketSettleOnlyError')
  })

  it('opens a long position and settles after max funding', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_1, orders: 1, longPos: POSITION_B, collateral: COLLATERAL },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
    riskParameter.makerLimit = parse6decimal('10')
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_1, orders: 1, shortPos: POSITION_B, collateral: COLLATERAL },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
        adiabaticFee: 0,
        scale: parse6decimal('10000'),
      },
      makerLimit: parse6decimal('100000'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('0.50'),
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
      riskFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      makerFee: positionFeesOn ? parse6decimal('0.2') : 0,
      takerFee: positionFeesOn ? parse6decimal('0.1') : 0,
      closed: false,
      settle: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_5, orders: 1, makerPos: POSITION.div(2), collateral: -1 },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 3,
      latestId: 2,
      collateral: '871368068',
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
      ...DEFAULT_GLOBAL,
      currentId: 3,
      latestId: 2,
      protocolFee: '172527179',
      latestPrice: PRICE_4,
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
      price: PRICE_4,
      makerValue: { _value: '-3538257' },
      longValue: { _value: '3620965' },
      shortValue: { _value: 0 },
    })
  })

  it('owner claims exposure', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION_B, 0, COLLATERAL, false)

    await chainlink.nextWithPriceModification(price => price.mul(10))

    await settle(market, user)

    const riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      takerFee: {
        linearFee: parse6decimal('0.001'),
        proportionalFee: parse6decimal('0.0006'),
        adiabaticFee: parse6decimal('0.0004'),
        scale: parse6decimal('10000'),
      },
      makerFee: {
        linearFee: parse6decimal('0.0005'),
        proportionalFee: parse6decimal('0.0002'),
        adiabaticFee: 0,
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
      riskFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      makerFee: parse6decimal('0.2'),
      takerFee: parse6decimal('0.1'),
      closed: false,
      settle: false,
    }

    await market.updateParameter(parameter)
    await market.updateRiskParameter(riskParameter)

    // ensure exposure is negative
    expect((await market.global()).exposure).to.lt(0)

    await fundWallet(dsu, owner)

    await dsu.connect(owner).approve(market.address, (await market.global()).exposure.mul(-1e12))

    await market.connect(owner).claimExposure()

    expect((await market.global()).exposure).to.equals(0)

    // Update adiabatic fee to 0 to get positive exposure
    riskParameter.takerFee.adiabaticFee = BigNumber.from(0)

    await market.updateRiskParameter(riskParameter)

    // ensure exposure is positive
    expect((await market.global()).exposure).to.gt(0)

    await market.connect(owner).claimExposure()

    expect((await market.global()).exposure).to.equals(0)
  })

  it('opens intent order w/ signer', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu } = instanceVars

    // userC allowed to sign messages for user
    await marketFactory.connect(user).updateSigner(userC.address, true)

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

    await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('1.5'),
      originator: userC.address,
      solver: owner.address,
      collateralization: parse6decimal('0.01'),
      common: {
        account: user.address,
        signer: userC.address,
        domain: market.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    let signature = await signIntent(userC, verifier, intent)

    // revert when fee is greater than 1
    await expect(
      market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.be.revertedWithCustomError(market, 'MarketInvalidIntentFeeError')

    // update fee to 0.5
    intent.fee = parse6decimal('0.5')
    signature = await signIntent(userC, verifier, intent)

    await market
      .connect(userC)
      [
        'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, signature)

    // userC is not allowed to sign messages for user
    await marketFactory.connect(user).updateSigner(userC.address, false)

    intent.common.nonce = 1
    signature = await signIntent(userC, verifier, intent)

    // ensure userC is not able to make transaction for user if not signer
    await expect(
      market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      takerPos: POSITION.div(2),
      takerNeg: POSITION.div(2),
      takerFee: POSITION.div(2),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      takerPos: POSITION.div(2),
      referral: parse6decimal('0.5'),
    })
    expectOrderEq(await market.pending(), {
      ...DEFAULT_ORDER,
      orders: 3,
      collateral: COLLATERAL.mul(3),
      makerPos: POSITION,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
    expectOrderEq(await market.pendings(user.address), {
      ...DEFAULT_ORDER,
      orders: 1,
      collateral: COLLATERAL,
      longPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })

    // update position with incorrect guarantee referrer
    intent.solver = userB.address
    signature = await signIntent(userC, verifier, intent)

    // userC is allowed to sign messages for user
    await marketFactory.connect(user).updateSigner(userC.address, true)

    await expect(
      market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.revertedWithCustomError(market, 'MarketInvalidReferrerError')
  })

  it('updates signer w/ signature and opens intent order', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu } = instanceVars

    const signerUpdate = {
      access: {
        accessor: userC.address,
        approved: true,
      },
      common: {
        account: userC.address,
        signer: user.address,
        domain: marketFactory.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    let signerSignature = await signSignerUpdate(user, verifier, signerUpdate)

    // update signer with incorrect account
    await expect(
      marketFactory.connect(user).updateSignerWithSignature(signerUpdate, signerSignature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    // set correct account
    signerUpdate.common.account = user.address
    signerSignature = await signSignerUpdate(user, verifier, signerUpdate)

    // update signer with correct account
    await marketFactory.connect(user).updateSignerWithSignature(signerUpdate, signerSignature)

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

    await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      originator: userC.address,
      solver: owner.address,
      collateralization: parse6decimal('0.01'),
      common: {
        account: user.address,
        signer: userC.address,
        domain: market.address,
        nonce: 1,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    const intentSignature = await signIntent(userC, verifier, intent)

    await market
      .connect(userC)
      [
        'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, intentSignature)

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      takerPos: POSITION.div(2),
      takerNeg: POSITION.div(2),
      takerFee: POSITION.div(2),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      takerPos: POSITION.div(2),
      referral: parse6decimal('0.5'),
    })
    expectOrderEq(await market.pending(), {
      ...DEFAULT_ORDER,
      orders: 3,
      collateral: COLLATERAL.mul(3),
      makerPos: POSITION,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
    expectOrderEq(await market.pendings(user.address), {
      ...DEFAULT_ORDER,
      orders: 1,
      collateral: COLLATERAL,
      longPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
  })

  it('opens intent order w/ operator', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu } = instanceVars

    // userC allowed to interact with user's account
    await marketFactory.connect(user).updateSigner(userC.address, true)

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

    await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      originator: userC.address,
      solver: owner.address,
      collateralization: parse6decimal('0.01'),
      common: {
        account: user.address,
        signer: userC.address,
        domain: market.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    let signature = await signIntent(userC, verifier, intent)

    await market
      .connect(userC)
      [
        'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, signature)

    // disable userC as operator for user
    await marketFactory.connect(user).updateSigner(userC.address, false)

    intent.common.nonce = 1
    signature = await signIntent(userC, verifier, intent)

    // ensure userC is not able to make transaction if not operator
    await expect(
      market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      takerPos: POSITION.div(2),
      takerNeg: POSITION.div(2),
      takerFee: POSITION.div(2),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      takerPos: POSITION.div(2),
      referral: parse6decimal('0.5'),
    })
    expectOrderEq(await market.pending(), {
      ...DEFAULT_ORDER,
      orders: 3,
      collateral: COLLATERAL.mul(3),
      makerPos: POSITION,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
    expectOrderEq(await market.pendings(user.address), {
      ...DEFAULT_ORDER,
      orders: 1,
      collateral: COLLATERAL,
      longPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
  })

  it('opens a long position w/ operator', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, userB, dsu, marketFactory, verifier } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterTakerFee = { ...riskParameter.takerFee }
    riskParameterTakerFee.scale = parse6decimal('1')
    riskParameter.takerFee = riskParameterTakerFee
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12).mul(2))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

    const operatorUpdate = {
      access: {
        accessor: user.address,
        approved: true,
      },
      common: {
        account: user.address,
        signer: userB.address,
        domain: marketFactory.address,
        nonce: 1,
        group: 1,
        expiry: constants.MaxUint256,
      },
    }

    let operatorUpdateSignature = await signOperatorUpdate(userB, verifier, operatorUpdate)

    // update operator with incorrect account
    await expect(
      marketFactory.updateOperatorWithSignature(operatorUpdate, operatorUpdateSignature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    // set correct account
    operatorUpdate.common.account = userB.address
    operatorUpdateSignature = await signOperatorUpdate(userB, verifier, operatorUpdate)

    // update operator for userB
    await marketFactory.connect(userB).updateOperatorWithSignature(operatorUpdate, operatorUpdateSignature)

    // user opens long position for userB
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          collateral: COLLATERAL,
          longPos: POSITION_B,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })
  })

  it('opens a long position w/ account as extension', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, userB, dsu, marketFactory } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterTakerFee = { ...riskParameter.takerFee }
    riskParameterTakerFee.scale = parse6decimal('1')
    riskParameter.takerFee = riskParameterTakerFee
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12).mul(2))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

    // try to update extension using incorrect owner
    await expect(marketFactory.connect(userB).updateExtension(user.address, true))
      .to.be.revertedWithCustomError(marketFactory, 'OwnableNotOwnerError')
      .withArgs(userB.address)

    // update extension with owner
    await marketFactory.connect(owner).updateExtension(user.address, true)
    // user opens long position for userB
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          collateral: COLLATERAL,
          longPos: POSITION_B,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })
  })

  it('updates account access and opens intent order', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu } = instanceVars

    // userC allowed to sign messages and interact with user account
    await marketFactory
      .connect(user)
      .updateAccessBatch([{ accessor: userC.address, approved: true }], [{ accessor: userC.address, approved: true }])

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12).mul(2))

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      originator: userC.address,
      solver: owner.address,
      collateralization: parse6decimal('0.01'),
      common: {
        account: user.address,
        signer: userC.address,
        domain: market.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    const signature = await signIntent(userC, verifier, intent)

    await market
      .connect(userC)
      [
        'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, signature)

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      takerPos: POSITION.div(2),
      takerNeg: POSITION.div(2),
      takerFee: POSITION.div(2),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      takerPos: POSITION.div(2),
      referral: parse6decimal('0.5'),
    })
    expectOrderEq(await market.pending(), {
      ...DEFAULT_ORDER,
      orders: 3,
      collateral: COLLATERAL.mul(3),
      makerPos: POSITION,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
    expectOrderEq(await market.pendings(user.address), {
      ...DEFAULT_ORDER,
      orders: 1,
      collateral: COLLATERAL,
      longPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
  })

  it('updates account access with signature and opens intent order', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu } = instanceVars

    const accessUpdateBatch = {
      operators: [{ accessor: userC.address, approved: true }],
      signers: [{ accessor: userC.address, approved: true }],
      common: {
        account: userC.address,
        signer: user.address,
        domain: marketFactory.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    let accessUpdateSignature = await signAccessUpdateBatch(user, verifier, accessUpdateBatch)

    // update access for user with incorrect account
    await expect(
      marketFactory.connect(user).updateAccessBatchWithSignature(accessUpdateBatch, accessUpdateSignature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    // set correct account
    accessUpdateBatch.common.account = user.address
    accessUpdateSignature = await signAccessUpdateBatch(user, verifier, accessUpdateBatch)

    // userC allowed to sign messages and interact with user account
    await marketFactory.connect(user).updateAccessBatchWithSignature(accessUpdateBatch, accessUpdateSignature)

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12).mul(2))

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      originator: userC.address,
      solver: owner.address,
      collateralization: parse6decimal('0.01'),
      common: {
        account: user.address,
        signer: userC.address,
        domain: market.address,
        nonce: 1,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    const signature = await signIntent(userC, verifier, intent)

    await market
      .connect(userC)
      [
        'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, signature)

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      takerPos: POSITION.div(2),
      takerNeg: POSITION.div(2),
      takerFee: POSITION.div(2),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      takerPos: POSITION.div(2),
      referral: parse6decimal('0.5'),
    })
    expectOrderEq(await market.pending(), {
      ...DEFAULT_ORDER,
      orders: 3,
      collateral: COLLATERAL.mul(3),
      makerPos: POSITION,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
    expectOrderEq(await market.pendings(user.address), {
      ...DEFAULT_ORDER,
      orders: 1,
      collateral: COLLATERAL,
      longPos: POSITION.div(2),
      takerReferral: parse6decimal('1'),
    })
  })

  it('settle position with invalid oracle version', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
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
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          collateral: COLLATERAL,
          longPos: POSITION_B,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

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
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestPrice: PRICE_0,
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
      price: PRICE_0,
    })

    // Settle after one round with oracle invalid version
    await chainlink.setInvalidVersion()
    await settle(market, userB)

    expectGlobalEq(await market.global(), {
      ...DEFAULT_GLOBAL,
      currentId: 1,
      latestId: 1,
      protocolFee: '0',
      latestPrice: PRICE_1,
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
      timestamp: TIMESTAMP_1,
    })
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
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
      transfer: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
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
      { decimals: 0 },
      delay,
    ).init(BigNumber.from(0), BigNumber.from(0))

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
        adiabaticFee: 0,
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
      riskFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      makerFee: positionFeesOn ? parse6decimal('0.2') : 0,
      takerFee: positionFeesOn ? parse6decimal('0.1') : 0,
      closed: false,
      settle: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)
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
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: await chainlink.oracle.current(),
          orders: 1,
          makerPos: POSITION,
          collateral: -1,
        },
        { ...DEFAULT_GUARANTEE },
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
      ...DEFAULT_GLOBAL,
      currentId: delay + 1,
      latestId: delay,
      protocolFee: (await market.global()).protocolFee,
      riskFee: (await market.global()).riskFee,
      oracleFee: (await market.global()).oracleFee,
      latestPrice: PRICE_0,
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
