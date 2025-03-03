import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

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
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { IntentStruct, TakeStruct, RiskParameterStruct, FillStruct } from '../../../types/generated/contracts/Market'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import {
  signAccessUpdateBatch,
  signFill,
  signIntent,
  signTake,
  signOperatorUpdate,
  signSignerUpdate,
} from '../../helpers/erc712'

export const TIMESTAMP_0 = 1631112429
export const TIMESTAMP_1 = 1631112904
export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631115371
export const TIMESTAMP_5 = 1631118731

export const UNDERLYING_PRICE = utils.parseEther('3374.655169')

export const PRICE_0 = parse6decimal('113.882975')
export const PRICE_1 = parse6decimal('113.796498')
export const PRICE_2 = parse6decimal('115.046259')
export const PRICE_3 = parse6decimal('116.284753')
export const PRICE_4 = parse6decimal('117.462552')

const COMMON_PROTOTYPE = '(address,address,address,uint256,uint256,uint256)'
const INTENT_PROTOTYPE = `(int256,int256,uint256,uint256,address,address,uint256,${COMMON_PROTOTYPE})`
const MARKET_UPDATE_FILL_PROTOTYPE = `update((${INTENT_PROTOTYPE},${COMMON_PROTOTYPE}),bytes,bytes)`
const MARKET_UPDATE_TAKE_PROTOTYPE = `update((int256,address,${COMMON_PROTOTYPE}),bytes)`
const MARKET_UPDATE_TAKER_DELTA_PROTOTYPE = 'update(address,int256,int256,address)'
const MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE = 'update(address,int256,int256,int256,address)'

describe('Happy Path', () => {
  let instanceVars: InstanceVars
  let riskParameter: RiskParameterStruct

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()

    riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      synBook: {
        d0: 0,
        d1: 0,
        d2: 0,
        d3: 0,
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
    const { owner, marketFactory, oracle, dsu } = instanceVars

    const parameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      riskFee: 0,
      makerFee: 0,
      takerFee: 0,
      maxPendingGlobal: 8,
      maxPendingLocal: 8,
      maxPriceDeviation: parse6decimal('0.1'),
      closed: false,
      settle: false,
    }

    // revert when invalid oracle is provided
    await expect(marketFactory.create(dsu.address)).to.be.revertedWithCustomError(
      marketFactory,
      'FactoryInvalidOracleError',
    )

    // update correct oracle address
    await expect(marketFactory.create(oracle.address)).to.emit(marketFactory, 'MarketCreated')
    const marketAddress = await marketFactory.markets(oracle.address)

    // revert when creating another market with same oracle
    await expect(marketFactory.create(oracle.address)).to.be.revertedWithCustomError(
      marketFactory,
      'FactoryAlreadyRegisteredError',
    )
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).updateRiskParameter(riskParameter)
    await market.connect(owner).updateParameter(parameter)

    // revert when reinitialized
    await expect(market.connect(owner).initialize(oracle.address))
      .to.be.revertedWithCustomError(market, 'InitializableAlreadyInitializedError')
      .withArgs(1)
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero),
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
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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

  it('changes isolated balances', async () => {
    const POSITION = parse6decimal('10')
    const { user, dsu, margin, chainlink } = instanceVars

    // user deposits and isolates most of their balance
    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, utils.parseEther('1000'))
    await margin.connect(user).deposit(user.address, parse6decimal('1000'))
    await margin.connect(user).isolate(user.address, market.address, parse6decimal('900'))
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('100'))
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('900'))
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_0), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('900'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // user opens a maker position and settles
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, 0, constants.AddressZero),
    )
    await chainlink.next()
    await settle(market, user)
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('900'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // user increases their isolated balance after settling
    await margin.connect(user).isolate(user.address, market.address, parse6decimal('50'))
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('50'))
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('950'))
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('950'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      timestamp: TIMESTAMP_1,
    })

    // user reduces their position and then decreases their isolated balance
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          parse6decimal('-2'),
          0,
          0,
          constants.AddressZero,
        ),
    )
    await margin.connect(user).isolate(user.address, market.address, parse6decimal('-150'), { gasLimit: 3_000_000 })
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('200'))
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('800'))
    await chainlink.next()
    await settle(market, user)
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('800'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      maker: parse6decimal('8'),
      timestamp: TIMESTAMP_2,
    })
  })

  it('changes isolated balances', async () => {
    const POSITION = parse6decimal('10')
    const { user, dsu, margin, chainlink } = instanceVars

    // user deposits and isolates most of their balance
    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, utils.parseEther('1000'))
    await margin.connect(user).deposit(user.address, parse6decimal('1000'))
    await margin.connect(user).isolate(user.address, market.address, parse6decimal('900'))
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('100'))
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('900'))
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_0), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('900'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // user opens a maker position and settles
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, 0, constants.AddressZero),
    )
    await chainlink.next()
    await settle(market, user)
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('900'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // user increases their isolated balance after settling
    await margin.connect(user).isolate(user.address, market.address, parse6decimal('50'))
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('50'))
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('950'))
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('950'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      maker: POSITION,
      timestamp: TIMESTAMP_1,
    })

    // user reduces their position and then decreases their isolated balance
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          parse6decimal('-2'),
          0,
          0,
          constants.AddressZero,
        ),
    )
    await margin.connect(user).isolate(user.address, market.address, parse6decimal('-150'), { gasLimit: 3_000_000 })
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('200'))
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('800'))
    await chainlink.next()
    await settle(market, user)
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('800'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      maker: parse6decimal('8'),
      timestamp: TIMESTAMP_2,
    })
  })

  it('opens multiple make positions', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](
        user.address,
        POSITION.div(2),
        0,
        COLLATERAL,
        constants.AddressZero,
      )
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION.div(2), 0, 0, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_1, orders: 1, makerPos: POSITION.div(2), invalidation: 1 },
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    const { user, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    await chainlink.next()

    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION.mul(-1), 0, 0, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          makerNeg: POSITION,
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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

  it('closes cross-margin maker position', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, 0, constants.AddressZero)

    await chainlink.next()

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](
        user.address,
        POSITION.div(2).mul(-1),
        0,
        0,
        constants.AddressZero,
      )
    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          POSITION.div(2).mul(-1),
          0,
          0,
          constants.AddressZero,
        ),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_2, orders: 1, makerNeg: POSITION.div(2), invalidation: 1 },
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
    })
    expect(await margin.crossMarginBalances(user.address)).to.equal(COLLATERAL)
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
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
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
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
      COLLATERAL.add(parse6decimal('1.249392')),
    )
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

  it('opens multiple long positions', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION_B.div(2), COLLATERAL, constants.AddressZero)

    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B.div(2), 0, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_1, orders: 1, longPos: POSITION_B.div(2), invalidation: 1 },
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
      COLLATERAL.add(parse6decimal('1.249392')),
    )
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
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero)

    await chainlink.next()

    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B.mul(-1), 0, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          longNeg: POSITION_B,
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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
      makerPreValue: { _value: 0 },
      longPreValue: { _value: 0 },
      shortPreValue: { _value: 0 },
    })
  })

  it('closes multiple long positions', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero)

    await chainlink.next()

    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION_B.div(2).mul(-1), 0, constants.AddressZero)

    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B.div(2).mul(-1), 0, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_2, orders: 1, longNeg: POSITION_B.div(2), invalidation: 1 },
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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

  it('closes long position with close', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION_B, COLLATERAL, constants.AddressZero)

    await chainlink.next()

    // close userB's position
    await expect(market.connect(userB).close(userB.address, false, constants.AddressZero))
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          longNeg: POSITION_B,
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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
      makerPreValue: { _value: 0 },
      longPreValue: { _value: 0 },
      shortPreValue: { _value: 0 },
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
        ['update(address,int256,int256,address)'](user.address, 0, parse6decimal('1000'), constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')

    await expect(settle(market, user)).to.be.revertedWithCustomError(market, 'InstancePausedError')

    await expect(
      market.connect(user)['update(address,int256,int256,address)'](user.address, 0, 0, constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')

    const intent = {
      amount: 0,
      price: 0,
      fee: 0,
      additiveFee: 0,
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
          'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](user.address, intent, '0x'),
    ).to.be.revertedWithCustomError(market, 'InstancePausedError')
  })

  it('disables actions when unauthorized access', async () => {
    const { marketFactory, user, oracle } = instanceVars

    await expect(marketFactory.connect(user).create(oracle.address)).to.be.revertedWithCustomError(
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
  })

  it('disables update when settle only mode', async () => {
    const { user, owner, dsu, margin } = instanceVars
    const market = await createMarket(instanceVars)

    const parameters = { ...(await market.parameter()) }
    parameters.settle = true

    await market.connect(owner).updateParameter(parameters)

    const COLLATERAL = parse6decimal('1000')
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await expect(
      market.connect(user)['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero),
    ).to.be.revertedWithCustomError(market, 'MarketSettleOnlyError')
  })

  it('opens a long position and settles after max funding', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
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
          longPos: POSITION_B,
          collateral: COLLATERAL,
          invalidation: 1,
        },
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
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await expect(
      market
        .connect(userB)
        ['update(address,int256,int256,address)'](userB.address, POSITION_B.mul(-1), COLLATERAL, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          shortPos: POSITION_B,
          collateral: COLLATERAL,
          invalidation: 1,
        },
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
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      synBook: {
        d0: positionFeesOn ? parse6decimal('0.001') : 0,
        d1: positionFeesOn ? parse6decimal('0.002') : 0,
        d2: positionFeesOn ? parse6decimal('0.004') : 0,
        d3: positionFeesOn ? parse6decimal('0.008') : 0,
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
      maxPriceDeviation: parse6decimal('0.1'),
      closed: false,
      settle: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL.mul(2))

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION.div(4), 0, 0, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION.div(4), 0, constants.AddressZero) // 0 -> 1

    await chainlink.next()
    await chainlink.next()

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION.div(4), 0, 0, constants.AddressZero) // 2 -> 3
    await market
      .connect(userB)
      ['update(address,int256,int256,address)'](userB.address, POSITION.div(4), 0, constants.AddressZero)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION.div(2), 0, 0, constants.AddressZero),
    ) // 4 -> 5
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_5,
          orders: 1,
          makerPos: POSITION.div(2),
          invalidation: 1,
        },
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
    })
    expect(await margin.crossMarginBalances(user.address)).to.equal(COLLATERAL.add(parse6decimal('873.007698')))
    expectOrderEq(await market.pendingOrders(user.address, 3), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_5,
      orders: 1,
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
      protocolFee: '172578504',
      latestPrice: PRICE_4,
    })
    expectOrderEq(await market.pendingOrder(3), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_5,
      orders: 1,
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
      makerPreValue: { _value: '-3625478' },
      longPreValue: { _value: '3620966' },
      longPostValue: { _value: '42' },
      shortPreValue: { _value: 0 },
    })
  })

  it('opens intent order w/ signer', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu, margin } = instanceVars

    // userC allowed to sign messages for user
    await marketFactory.connect(user).updateSigner(userC.address, true)

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userC).deposit(userC.address, COLLATERAL)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](userC.address, 0, COLLATERAL, constants.AddressZero)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('1.5'),
      additiveFee: 0,
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
          'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.be.revertedWithCustomError(market, 'MarketInvalidIntentFeeError')

    // update fee to 0.5
    intent.fee = parse6decimal('0.5')
    signature = await signIntent(userC, verifier, intent)

    await market
      .connect(userC)
      [
        'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
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
          'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 2,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerFee: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      longPos: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
      solverReferral: parse6decimal('0.5'),
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
          'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.revertedWithCustomError(market, 'MarketInvalidReferrerError')
  })

  it('updates signer w/ signature and opens intent order', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu, margin } = instanceVars

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

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userC).deposit(userC.address, COLLATERAL)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](userC.address, 0, COLLATERAL, constants.AddressZero)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      additiveFee: 0,
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
        'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, intentSignature)

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 2,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerFee: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      longPos: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
      solverReferral: parse6decimal('0.5'),
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
    const { owner, user, userB, userC, marketFactory, verifier, dsu, margin } = instanceVars

    // userC allowed to interact with user's account
    await marketFactory.connect(user).updateSigner(userC.address, true)

    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await marketFactory.parameter()) }
    protocolParameter.referralFee = parse6decimal('0.20')

    await marketFactory.updateParameter(protocolParameter)

    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userC).deposit(userC.address, COLLATERAL)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](userC.address, 0, COLLATERAL, constants.AddressZero)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      additiveFee: 0,
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
        'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
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
          'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 2,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerFee: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      longPos: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
      solverReferral: parse6decimal('0.5'),
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

  it('fills a delegate-signed short intent with signature', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, userC, userD, dsu, margin, chainlink, marketFactory, verifier } = instanceVars

    const market = await createMarket(instanceVars)
    const NOW = await currentBlockTimestamp()

    // user and userB deposit collateral
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await market.connect(user)[MARKET_UPDATE_TAKER_DELTA_PROTOTYPE](user.address, 0, COLLATERAL, constants.AddressZero)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)
    await market
      .connect(userB)
      [MARKET_UPDATE_TAKER_DELTA_PROTOTYPE](userB.address, 0, COLLATERAL, constants.AddressZero)

    // userC opens a maker position adding liquidity to the market
    await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userC).deposit(userC.address, COLLATERAL)
    await market
      .connect(userC)
      [MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE](userC.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    // userD, a delegated signer for user, signs an intent to open a short position for user
    await marketFactory.connect(user).updateSigner(userD.address, true)
    const intent: IntentStruct = {
      amount: -POSITION.div(4),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      additiveFee: 0,
      originator: constants.AddressZero,
      solver: constants.AddressZero,
      collateralization: parse6decimal('0.03'),
      common: {
        account: user.address,
        signer: userD.address,
        domain: market.address,
        nonce: 0,
        group: 0,
        expiry: NOW + 60,
      },
    }
    const traderSignature = await signIntent(userD, verifier, intent)

    // userB signs a message to fill user's intent order
    const fill: FillStruct = {
      intent: intent,
      common: {
        account: userB.address,
        signer: userB.address,
        domain: market.address,
        nonce: 0,
        group: 0,
        expiry: intent.common.expiry,
      },
    }
    const fillSignature = await signFill(userB, verifier, fill)

    // userC executes the fill
    await expect(market.connect(userC)[MARKET_UPDATE_FILL_PROTOTYPE](fill, traderSignature, fillSignature))
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          shortPos: POSITION.div(4),
        },
        {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: POSITION.div(4),
          notional: -POSITION.div(4).mul(125),
        },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_1,
          orders: 1,
          longPos: POSITION.div(4),
        },
        {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: POSITION.div(4),
          notional: POSITION.div(4).mul(125),
          takerFee: POSITION.div(4),
        },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

    // check user order and guarantee
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      shortPos: POSITION.div(4),
      collateral: COLLATERAL,
    })
    expectGuaranteeEq(await market.guarantees(user.address, 1), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      shortPos: POSITION.div(4),
      notional: -POSITION.div(4).mul(125),
    })

    // check userB order and guarantee
    expectOrderEq(await market.pendingOrders(userB.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      longPos: POSITION.div(4),
      collateral: COLLATERAL,
    })
    expectGuaranteeEq(await market.guarantees(userB.address, 1), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      longPos: POSITION.div(4),
      notional: POSITION.div(4).mul(125),
      takerFee: POSITION.div(4),
    })

    // check market prior to settlement
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 3,
      makerPos: POSITION,
      shortPos: POSITION.div(4),
      longPos: POSITION.div(4),
      collateral: COLLATERAL.mul(3),
    })

    // settle and check the market
    await chainlink.next()
    await settle(market, user)
    await settle(market, userB)
    await settle(market, userC)
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
      long: POSITION.div(4),
      short: POSITION.div(4),
    })

    // check user state
    // priceOverride = (taker * oraclePrice) - (taker * intentPrice) = (-2.5 * 113.796498) - (-2.5 * 125) = 28.008755
    const priceOverride = parse6decimal('28.008755')
    let expectedCollateral = COLLATERAL.add(priceOverride)
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(expectedCollateral)
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      transfer: COLLATERAL,
      collateral: priceOverride,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      short: POSITION.div(4),
    })

    // check userB state
    expectedCollateral = COLLATERAL.sub(priceOverride)
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(expectedCollateral)
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
      transfer: COLLATERAL,
      collateral: priceOverride.mul(-1),
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      long: POSITION.div(4),
    })
  })

  it('opens a long position w/ operator', async () => {
    const POSITION = parse6decimal('10')
    const POSITION_B = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, userB, dsu, margin, marketFactory, verifier } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12).mul(2))
    await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

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
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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
    const { owner, user, userB, dsu, margin, marketFactory } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12).mul(2))
    await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

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
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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

  it('opens, reduces, and closes a long position w/ signed message', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, userB, userC, dsu, margin, marketFactory, verifier, chainlink } = instanceVars
    const market = await createMarket(instanceVars)

    // establish a referral fee
    await expect(marketFactory.connect(owner).updateReferralFee(owner.address, parse6decimal('0.0125')))
      .to.emit(marketFactory, 'ReferralFeeUpdated')
      .withArgs(owner.address, parse6decimal('0.0125'))

    // user opens a maker position adding liquidity to the market
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12).mul(2))
    await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))
    await market
      .connect(user)
      [MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    // userB deposits some collateral
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12).mul(2))
    await margin.connect(userB).deposit(userB.address, COLLATERAL.mul(2))
    await market
      .connect(userB)
      [MARKET_UPDATE_TAKER_DELTA_PROTOTYPE](userB.address, 0, COLLATERAL, constants.AddressZero)

    // settle user's maker position
    await chainlink.next()
    await settle(market, user)

    // userB signs message to open a long position
    const initialPosition = POSITION.mul(2).div(3) // 6.666666
    let message: TakeStruct = {
      amount: initialPosition,
      referrer: owner.address,
      common: {
        account: userB.address,
        signer: userB.address,
        domain: market.address,
        nonce: 2,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }
    let signature = await signTake(userB, verifier, message)

    // userC executes the update
    let expectedTakerReferral = parse6decimal('0.083333') // referralFee * takerAmount = 0.0125 * |initialPosition|
    await expect(market.connect(userC)[MARKET_UPDATE_TAKE_PROTOTYPE](message, signature))
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          longPos: initialPosition,
          takerReferral: expectedTakerReferral,
          invalidation: 1,
        },
        DEFAULT_GUARANTEE,
        constants.AddressZero,
        owner.address, // referrer
        constants.AddressZero,
      )

    // confirm the pending order
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
      orders: 1,
      collateral: 0,
      makerPos: 0,
      longPos: initialPosition,
      takerReferral: expectedTakerReferral,
    })

    // settle userB's long position
    await chainlink.next()
    await settle(market, userB)

    // check userB state
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 2,
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
    expectOrderEq(await market.pendingOrders(userB.address, 3), DEFAULT_ORDER)
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
      collateral: COLLATERAL,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_2,
      long: initialPosition,
    })

    // userB signs message to reduce their long position
    const positionDelta = POSITION.div(-3) // -3.333333
    message = { ...message, amount: positionDelta, common: { ...message.common, nonce: 3 } }
    signature = await signTake(userB, verifier, message)

    // userC again executes the update
    expectedTakerReferral = parse6decimal('0.041666') // referralFee * takerAmount = 0.0125 * |positionDelta|
    await expect(market.connect(userC)[MARKET_UPDATE_TAKE_PROTOTYPE](message, signature))
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_3,
          orders: 1,
          longNeg: positionDelta.mul(-1),
          takerReferral: expectedTakerReferral,
          invalidation: 1,
        },
        DEFAULT_GUARANTEE,
        constants.AddressZero,
        owner.address, // referrer
        constants.AddressZero,
      )

    // settle userB's reduced position and check state
    await chainlink.next()
    await settle(market, userB)
    // pnl = priceDelta * longSocialized = (116.284753-115.046259) * 6.666666 = 8.256626
    // interestLong = -0.003015
    // collateralChange = pnl + interestLong = 8.256626 - 0.003015 = 8.253611
    let collateralChange = parse6decimal('8.253611').sub(12) // loss of precision
    const collateral3 = COLLATERAL.add(collateralChange)
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 3,
      latestId: 3,
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(collateral3)
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_3), {
      ...DEFAULT_CHECKPOINT,
      collateral: collateral3,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_3,
      long: POSITION.div(3),
    })

    // userB signs message to close their position, this time with no referrer
    const currentPosition = (await market.positions(userB.address)).long // 3.333333
    message = {
      ...message,
      amount: currentPosition.mul(-1),
      referrer: constants.AddressZero,
      common: { ...message.common, nonce: 4 },
    }
    signature = await signTake(userB, verifier, message)

    // userC executes the request to close
    await expect(market.connect(userC)[MARKET_UPDATE_TAKE_PROTOTYPE](message, signature))
      .to.emit(market, 'OrderCreated')
      .withArgs(
        userB.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_4,
          orders: 1,
          longNeg: currentPosition,
          invalidation: 1,
        },
        DEFAULT_GUARANTEE,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

    // settle userB's closed position and check state
    await chainlink.next()
    await settle(market, userB)
    // pnl = priceDelta * longSocialized = (117.462552-116.284753) * 3.333333 = 3.925996
    // interestLong = -0.005596
    // collateralChange = pnl + interestLong = 3.925996 - 0.005596 = 3.9204
    collateralChange = parse6decimal('3.9204').sub(4) // loss of precision
    const collateral4 = collateral3.add(collateralChange)
    expectLocalEq(await market.locals(userB.address), {
      ...DEFAULT_LOCAL,
      currentId: 4,
      latestId: 4,
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(collateral4)
    expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_4), {
      ...DEFAULT_CHECKPOINT,
      collateral: collateral4,
    })
    expectPositionEq(await market.positions(userB.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_4,
    })
  })

  it('disables fills with mismatching markets', async () => {
    const POSITION = parse6decimal('10')
    const { user, userB, userC, verifier } = instanceVars

    const market = await createMarket(instanceVars)
    const badMarketAddress = verifier.address

    // trader (user) signs an intent to open a long position
    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      additiveFee: 0,
      originator: constants.AddressZero,
      solver: constants.AddressZero,
      collateralization: parse6decimal('0.01'),
      common: {
        account: user.address,
        signer: user.address,
        domain: market.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }
    const traderSignature = await signIntent(user, verifier, intent)

    const fill: FillStruct = {
      intent: intent,
      common: {
        account: userB.address,
        signer: userB.address,
        domain: badMarketAddress,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }
    const solverSignature = await signFill(userB, verifier, fill)

    // market of the fill (outer) does not match
    await expect(
      market.connect(userC)[MARKET_UPDATE_FILL_PROTOTYPE](fill, traderSignature, solverSignature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidDomainError')

    // market of the intent (inner) does not match
    fill.common.domain = market.address
    fill.intent.common.domain = badMarketAddress
    await expect(
      market.connect(userC)[MARKET_UPDATE_FILL_PROTOTYPE](fill, traderSignature, solverSignature),
    ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidDomainError')
  })

  it('updates account access and opens intent order', async () => {
    const { owner, user, userB, userC, marketFactory, verifier, dsu, margin } = instanceVars

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

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(3).mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await margin.connect(user).deposit(userB.address, COLLATERAL)
    await margin.connect(user).deposit(userC.address, COLLATERAL)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](userC.address, 0, COLLATERAL, constants.AddressZero)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      additiveFee: 0,
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
        'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, signature)

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 2,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerFee: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      longPos: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
      solverReferral: parse6decimal('0.5'),
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
    const { owner, user, userB, userC, marketFactory, verifier, dsu, margin } = instanceVars

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

    await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12).mul(2))
    await margin.connect(userC).deposit(user.address, COLLATERAL)
    await margin.connect(userC).deposit(userC.address, COLLATERAL)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero)

    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    await market
      .connect(userC)
      ['update(address,int256,int256,address)'](userC.address, 0, COLLATERAL, constants.AddressZero)

    const intent: IntentStruct = {
      amount: POSITION.div(2),
      price: parse6decimal('125'),
      fee: parse6decimal('0.5'),
      additiveFee: 0,
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
        'update(address,(int256,int256,uint256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](userC.address, intent, signature)

    expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 2,
      longPos: POSITION.div(2),
      shortPos: POSITION.div(2),
      takerFee: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
    })
    expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
      ...DEFAULT_GUARANTEE,
      orders: 1,
      notional: parse6decimal('625'),
      longPos: POSITION.div(2),
      orderReferral: parse6decimal('1.0'),
      solverReferral: parse6decimal('0.5'),
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
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.makerLimit = parse6decimal('10')
    const riskParameterSynBook = { ...riskParameter.synBook }
    riskParameterSynBook.scale = parse6decimal('1')
    riskParameter.synBook = riskParameterSynBook
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)

    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
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
          invalidation: 1,
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
    })
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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
    })
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL)
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

    const { user, userB, dsu, chainlink, margin } = instanceVars

    // set delay
    chainlink.delay = delay

    const nextWithConstantPrice = async () => {
      return instanceVars.chainlink.nextWithPriceModification(() => UNDERLYING_PRICE)
    }

    const riskParameter = {
      margin: parse6decimal('0.3'),
      maintenance: parse6decimal('0.3'),
      synBook: {
        d0: positionFeesOn ? parse6decimal('0.001') : 0,
        d1: positionFeesOn ? parse6decimal('0.002') : 0,
        d2: positionFeesOn ? parse6decimal('0.004') : 0,
        d3: positionFeesOn ? parse6decimal('0.008') : 0,
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
      staleAfter: 64800, // enable long delays for testing
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
      maxPriceDeviation: parse6decimal('0.1'),
      closed: false,
      settle: false,
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)
    await market.updateRiskParameter(riskParameter)

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL.mul(2))

    await margin.connect(user).isolate(user.address, market.address, COLLATERAL)

    for (let i = 0; i < delay; i++) {
      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          i == 0 ? POSITION : 1,
          0,
          i == 0 ? COLLATERAL : 0,
          constants.AddressZero,
        )
      await market
        .connect(userB)
        ['update(address,int256,int256,address)'](
          userB.address,
          i == 0 ? POSITION : 1,
          i == 0 ? COLLATERAL : 0,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
    }

    // ensure all pending can settle
    for (let i = 0; i < delay - 1; i++) await nextWithConstantPrice()
    if (sync) await nextWithConstantPrice()
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL.mul(2))

    // const currentVersion = delay + delay + delay - (sync ? 0 : 1)
    // const latestVersion = delay + delay - (sync ? 0 : 1)

    await expect(
      market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, 1, 0, -1, constants.AddressZero),
    )
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: await chainlink.oracle.current(),
          orders: 1,
          makerPos: 1,
          collateral: -1,
          invalidation: 1,
        },
        { ...DEFAULT_GUARANTEE },
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: delay + 1,
      latestId: delay,
    })
    expectOrderEq(await market.pendingOrders(user.address, delay + 1), {
      ...DEFAULT_ORDER,
      orders: 1,
      timestamp: await chainlink.oracle.current(),
      collateral: -1,
      makerPos: 1,
    })
    expectCheckpointEq(await market.checkpoints(user.address, delay + 1), {
      ...DEFAULT_CHECKPOINT,
      tradeFee: (await market.checkpoints(user.address, delay + 1)).tradeFee,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: (await chainlink.oracle.latest()).timestamp,
      maker: POSITION.add(delay - 1),
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
      collateral: -1,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: (await chainlink.oracle.latest()).timestamp,
      maker: POSITION.add(delay - 1),
      long: POSITION.add(delay - 1),
    })
  })
})
