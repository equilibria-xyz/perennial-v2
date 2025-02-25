import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, ContractTransaction, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle } from '../helpers/setupHelpers'
import {
  DEFAULT_CHECKPOINT,
  DEFAULT_POSITION,
  DEFAULT_LOCAL,
  DEFAULT_ORDER,
  expectOrderEq,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  parse6decimal,
  expectCheckpointEq,
  DEFAULT_GLOBAL,
  DEFAULT_GUARANTEE,
  expectGuaranteeEq,
} from '../../../../common/testutil/types'
import { IMargin, Market, Verifier__factory } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  AccountPositionProcessedEventObject,
  IntentStruct,
  PositionProcessedEventObject,
} from '../../../types/generated/contracts/Market'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { signIntent } from '../../helpers/erc712'

export const UNDERLYING_PRICE = utils.parseEther('3374.655169')

export const PRICE = parse6decimal('113.882975')
export const PRICE_1 = parse6decimal('113.796498')
export const PRICE_2 = parse6decimal('115.046259')
export const TIMESTAMP_0 = 1631112429
export const TIMESTAMP_1 = 1631112904
export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631115371
export const TIMESTAMP_5 = 1631118731

const RISK_PARAMS = {
  synBook: {
    d0: 0,
    d1: 0,
    d2: 0,
    d3: 0,
    scale: parse6decimal('10'),
  },
  makerLimit: parse6decimal('20'),
  utilizationCurve: {
    minRate: 0,
    maxRate: 0,
    targetRate: 0,
    targetUtilization: 0,
  },
  pController: {
    k: BigNumber.from('1099511627775'),
    min: 0,
    max: 0,
  },
}
const MARKET_PARAMS = {
  fundingFee: parse6decimal('0.1'),
  interestFee: parse6decimal('0.2'),
  riskFee: parse6decimal('0.571428'),
}

describe('Fees', () => {
  let instanceVars: InstanceVars
  let market: Market
  let margin: IMargin

  const nextWithConstantPrice = async () => {
    return instanceVars.chainlink.nextWithPriceModification(() => UNDERLYING_PRICE)
  }

  const fixture = async () => {
    const instanceVars = await deployProtocol()
    const marketFactoryParams = await instanceVars.marketFactory.parameter()
    await instanceVars.marketFactory.updateParameter({ ...marketFactoryParams, maxFee: parse6decimal('0.9') })
    return instanceVars
  }

  // parse useful events from a settle or update transaction
  async function getOrderProcessingEvents(
    tx: ContractTransaction,
  ): Promise<[Array<AccountPositionProcessedEventObject>, Array<PositionProcessedEventObject>]> {
    const txEvents = (await tx.wait()).events
    if (txEvents) {
      const accountProcessEvents: Array<AccountPositionProcessedEventObject> = txEvents
        .filter(e => e.event === 'AccountPositionProcessed')
        .map(e => e.args as unknown as AccountPositionProcessedEventObject)
      const positionProcessEvents: Array<PositionProcessedEventObject> = txEvents
        .filter(e => e.event === 'PositionProcessed')
        .map(e => e.args as unknown as PositionProcessedEventObject)
      return [accountProcessEvents, positionProcessEvents]
    } else {
      throw new Error('Transaction had no events to process')
    }
  }

  beforeEach(async () => {
    instanceVars = await loadFixture(fixture)
    instanceVars.chainlink.updateParams(BigNumber.from(0), parse6decimal('0.3'))
    await instanceVars.chainlink.reset()
    market = await createMarket(instanceVars, RISK_PARAMS, MARKET_PARAMS)
    margin = instanceVars.margin
  })

  describe('trade fees', () => {
    beforeEach(async () => {
      const marketParameter = await market.parameter()
      await market.updateParameter({
        ...marketParameter,
        takerFee: parse6decimal('0.025'),
        makerFee: parse6decimal('0.05'),
      })
    })

    it('charges maker trade fees', async () => {
      const POSITION = parse6decimal('10')
      const COLLATERAL = parse6decimal('1000')
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)

      await expect(
        market
          .connect(user)
          ['update(address,int256,int256,int256,address)'](
            user.address,
            POSITION,
            0,
            COLLATERAL,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          user.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_1,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // Settle the market with a new oracle version
      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const expectedMakerFee = parse6decimal('56.941490') // = 3374.655169**2 * 0.0001 * (0.05)

      expect(accountProcessEvent?.accumulationResult.tradeFee).to.equal(expectedMakerFee)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL.sub(expectedMakerFee))
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedMakerFee,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: POSITION,
      })

      // Check global post-settlement state
      const expectedOracleFee = BigNumber.from('17082446') // = (56941487) * 0.3
      const expectedRiskFee = BigNumber.from('22776572') // = (56941487) * 0.4
      const expectedProtocolFee = BigNumber.from('17082469') // = 56941487 - 17082446 - 22776572
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
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

    it('charges taker trade fees', async () => {
      const marketParams = { ...(await market.parameter()) }
      marketParams.makerFee = BigNumber.from('0')
      await market.updateParameter(marketParams)

      const MAKER_POSITION = parse6decimal('10')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)

      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          MAKER_POSITION,
          0,
          COLLATERAL,
          constants.AddressZero,
        )
      await expect(
        market
          .connect(userB)
          ['update(address,int256,int256,int256,address)'](
            userB.address,
            0,
            LONG_POSITION,
            COLLATERAL,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userB.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_1,
            orders: 1,
            longPos: LONG_POSITION,
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const processEvent: PositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'PositionProcessed',
      )?.args as unknown as PositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedTakerFee = parse6decimal('2.847074') // = 3374.655169**2 * 0.00001 * (0.025)

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(processEvent.accumulationResult.tradeFee).to.eq(expectedTakerFee)

      const expectedOracleFee = BigNumber.from('854122') // = (2847074) * 0.3
      const expectedRiskFee = BigNumber.from('1138828') // = (2847074) * 0.4
      const expectedProtocolFee = BigNumber.from('854124') // = 2847074 - 854122 - 1138829

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 2,
        longPos: LONG_POSITION,
        makerPos: MAKER_POSITION,
        collateral: COLLATERAL.mul(2),
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: MAKER_POSITION,
        long: LONG_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL.sub(expectedTakerFee))
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        longPos: LONG_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedTakerFee,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        long: LONG_POSITION,
      })
    })
  })

  describe('impact fees', () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const { userB, userC, userD, dsu } = instanceVars

      // setup initial positions + skew
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL)
      await dsu.connect(userD).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userD).deposit(userD.address, COLLATERAL)

      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)
      await market
        .connect(userC)
        ['update(address,int256,int256,int256,address)'](userC.address, 0, POSITION, COLLATERAL, constants.AddressZero)

      await dsu.connect(userD).approve(market.address, COLLATERAL.mul(1e12))
      await market
        .connect(userD)
        ['update(address,int256,int256,int256,address)'](
          userD.address,
          0,
          -POSITION.div(2),
          COLLATERAL,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, userB)
      await settle(market, userC)
      await settle(market, userD)

      const riskParameter = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParameter,
        synBook: {
          ...riskParameter.synBook,
          d0: parse6decimal('0.001'),
          d1: parse6decimal('0.002'),
          d2: parse6decimal('0.004'),
          d3: parse6decimal('0.008'),
        },
      })
    })

    it('charges price impact on make open', async () => {
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await expect(
        market
          .connect(user)
          ['update(address,int256,int256,int256,address)'](
            user.address,
            POSITION,
            0,
            COLLATERAL,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          user.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // skew -0.5 -> -.25, price 3374.655169^2/100000, exposure +2.5
      const expectedPriceImpact = parse6decimal('0.025953')

      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      expect(accountProcessEvent?.accumulationResult.spread).to.equal(expectedPriceImpact)

      await settle(market, userB)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL.sub(expectedPriceImpact))
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION,
      })
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
        COLLATERAL.add(expectedPriceImpact).sub(3),
      )
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        collateral: COLLATERAL.add(expectedPriceImpact).sub(3),
      })

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: 0,
        riskFee: 0,
        oracleFee: 0,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION.mul(2),
        long: POSITION,
        short: POSITION.div(2),
      })
    })

    it('charges price impact on make close', async () => {
      const { user, userB, dsu } = instanceVars

      await expect(
        market
          .connect(userB)
          ['update(address,int256,int256,int256,address)'](
            userB.address,
            -POSITION.div(2),
            0,
            0,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userB.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            makerNeg: POSITION.div(2),
            collateral: 0,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // skew -0.5 -> -0.75, price 3374.655169^2/100000, exposure -2.5
      const expectedPriceImpact = parse6decimal('0.417423')

      await nextWithConstantPrice()
      const tx = await settle(market, userB)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      expect(accountProcessEvent?.accumulationResult.spread).to.equal(expectedPriceImpact)

      // check user state
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 2,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
        COLLATERAL.sub(3), // impact fee is returned to existing maker minus dust
      )
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerNeg: POSITION.div(2),
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        collateral: COLLATERAL.add(expectedPriceImpact.sub(3)),
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION.div(2),
      })

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerNeg: POSITION.div(2),
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION.div(2),
        long: POSITION,
        short: POSITION.div(2),
      })
    })

    it('charges price impact on long open', async () => {
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await expect(
        market
          .connect(user)
          ['update(address,int256,int256,int256,address)'](
            user.address,
            0,
            POSITION.div(2),
            COLLATERAL,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          user.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            longPos: POSITION.div(2),
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // skew 0.5 -> 1.0, price 3374.655169^2/100000, exposure +5
      const expectedPriceImpact = parse6decimal('2.44374')

      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      expect(accountProcessEvent?.accumulationResult.spread).to.equal(expectedPriceImpact)

      await settle(market, userB)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL.sub(expectedPriceImpact))
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longPos: POSITION.div(2),
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: POSITION.div(2),
      })
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
        COLLATERAL.add(expectedPriceImpact).sub(10),
      )
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        collateral: COLLATERAL.add(expectedPriceImpact).sub(10),
      })

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: 0,
        riskFee: 0,
        oracleFee: 0,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longPos: POSITION.div(2),
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION,
        long: POSITION.mul(3).div(2),
        short: POSITION.div(2),
      })
    })

    it('charges price impact on long close', async () => {
      const { userB, userC } = instanceVars

      await expect(
        market
          .connect(userC)
          ['update(address,int256,int256,int256,address)'](
            userC.address,
            0,
            -POSITION.div(2),
            0,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userC.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            longNeg: POSITION.div(2),
            collateral: 0,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // skew 0.5 -> 0.0, price 3374.655169^2/100000, exposure 5
      const expectedPriceImpact = parse6decimal('0.166080')

      await nextWithConstantPrice()
      const tx = await settle(market, userC)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      expect(accountProcessEvent?.accumulationResult.spread).to.equal(expectedPriceImpact)

      await settle(market, userB)

      // check user state
      expectLocalEq(await market.locals(userC.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 2,
      })
      expect(await margin.isolatedBalances(userC.address, market.address)).to.equal(COLLATERAL.sub(expectedPriceImpact))
      expectOrderEq(await market.pendingOrders(userC.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longNeg: POSITION.div(2),
      })
      expectCheckpointEq(await market.checkpoints(userC.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.positions(userC.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: POSITION.div(2),
      })
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL.add(expectedPriceImpact))
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        collateral: COLLATERAL.add(expectedPriceImpact),
      })

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longNeg: POSITION.div(2),
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION,
        long: POSITION.div(2),
        short: POSITION.div(2),
      })
    })

    it('charges price impact on short open', async () => {
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await expect(
        market
          .connect(user)
          ['update(address,int256,int256,int256,address)'](
            user.address,
            0,
            -POSITION.div(2),
            COLLATERAL,
            constants.AddressZero,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          user.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            shortPos: POSITION.div(2),
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // skew 0.5 -> 0.0, price 3374.655169^2/100000, exposure +5
      const expectedPriceImpact = parse6decimal('0.166080')

      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      expect(accountProcessEvent?.accumulationResult.spread).to.equal(expectedPriceImpact)

      await settle(market, userB)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL.sub(expectedPriceImpact))
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortPos: POSITION.div(2),
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        short: POSITION.div(2),
      })
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(COLLATERAL.add(expectedPriceImpact))
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        transfer: COLLATERAL,
      })

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: 0,
        riskFee: 0,
        oracleFee: 0,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortPos: POSITION.div(2),
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION,
        long: POSITION,
        short: POSITION,
      })
    })

    it('charges price impact on short close', async () => {
      const { userB, userD } = instanceVars

      await expect(
        market
          .connect(userD)
          ['update(address,int256,int256,int256,address)'](userD.address, 0, POSITION.div(2), 0, constants.AddressZero),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userD.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            shortNeg: POSITION.div(2),
            collateral: 0,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      // skew 0.5 -> 1.0, price 3374.655169^2/100000, exposure 5
      const expectedPriceImpact = parse6decimal('2.44374')

      await nextWithConstantPrice()
      const tx = await settle(market, userD)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      expect(accountProcessEvent?.accumulationResult.spread).to.equal(expectedPriceImpact)

      await settle(market, userB)

      // check user state
      expectLocalEq(await market.locals(userD.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 2,
      })
      expect(await margin.isolatedBalances(userD.address, market.address)).to.equal(COLLATERAL.sub(expectedPriceImpact))
      expectOrderEq(await market.pendingOrders(userD.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortNeg: POSITION.div(2),
      })
      expectCheckpointEq(await market.checkpoints(userD.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedPriceImpact,
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.positions(userD.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        short: 0,
      })
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
        COLLATERAL.add(expectedPriceImpact).sub(10),
      )
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        collateral: COLLATERAL.add(expectedPriceImpact).sub(10),
      })

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortNeg: POSITION.div(2),
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION,
        long: POSITION,
        short: 0,
      })
    })
  })

  describe('settlement fee', () => {
    const MAKER_POSITION = parse6decimal('10')
    const SHORT_POSITION = parse6decimal('1')
    const LONG_POSITION = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const { user, userB, userC, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL)

      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          MAKER_POSITION,
          0,
          COLLATERAL,
          constants.AddressZero,
        )
      await nextWithConstantPrice()
      await settle(market, user)

      instanceVars.chainlink.updateParams(parse6decimal('1.23'), instanceVars.chainlink.oracleFee)
    })

    it('charges settlement fee for maker', async () => {
      await market
        .connect(instanceVars.user)
        ['update(address,int256,int256,int256,address)'](
          instanceVars.user.address,
          MAKER_POSITION,
          0,
          0,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const tx = await settle(market, instanceVars.user)

      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedSettlementFee = parse6decimal('1.23')
      expect(accountProcessEvent.accumulationResult.settlementFee).to.equal(expectedSettlementFee)

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        oracleFee: expectedSettlementFee,
        latestPrice: PRICE,
      })
    })

    it('charges settlement fee for taker', async () => {
      const { userB, userC } = instanceVars
      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](
          userB.address,
          0,
          LONG_POSITION,
          COLLATERAL,
          constants.AddressZero,
        )
      await market
        .connect(userC)
        ['update(address,int256,int256,int256,address)'](
          userC.address,
          0,
          -SHORT_POSITION,
          COLLATERAL,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const txB = await settle(market, userB)
      const txC = await settle(market, userC)

      const accountProcessEventB: AccountPositionProcessedEventObject = (await txB.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const accountProcessEventC: AccountPositionProcessedEventObject = (await txC.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedSettlementFee = parse6decimal('1.23')
      expect(accountProcessEventB.accumulationResult.settlementFee).to.equal(expectedSettlementFee.div(2))
      expect(accountProcessEventC.accumulationResult.settlementFee).to.equal(expectedSettlementFee.div(2))

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        oracleFee: expectedSettlementFee,
        latestPrice: PRICE,
      })
    })
  })

  describe('interest fee', () => {
    const MAKER_POSITION = parse6decimal('10')
    const SHORT_POSITION = parse6decimal('1')
    const LONG_POSITION = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParams,
        utilizationCurve: {
          minRate: parse6decimal('0.01'),
          maxRate: parse6decimal('0.01'),
          targetRate: parse6decimal('0.01'),
          targetUtilization: parse6decimal('1'),
        },
      })

      const { user, userB, userC, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL)

      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          MAKER_POSITION,
          0,
          COLLATERAL,
          constants.AddressZero,
        )
      await nextWithConstantPrice()
      await settle(market, user)
    })

    it('charges interest fee for long position', async () => {
      const { userB } = instanceVars

      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](
          userB.address,
          0,
          LONG_POSITION,
          COLLATERAL,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const [accountProcessEvents, positionProcessEvents] = await getOrderProcessingEvents(tx)

      // payoffPrice = 3374.655169**2 * 0.00001 = 113.882975
      const expectedInterest = BigNumber.from('177') // payoffPrice * 0.01 * 4912 seconds / 365 days
      const expectedInterestFee = BigNumber.from('35') // expectedInterest * .2

      const accumulatedInterest = accountProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.collateral),
        BigNumber.from(0),
      )
      const accumulatedInterestFee = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.interestFee),
        BigNumber.from(0),
      )
      const accumulatedInterestMaker = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.interestFee.add(e.accumulationResult.interestMaker)),
        BigNumber.from(0),
      )
      expect(accumulatedInterest).to.equal(expectedInterest.mul(-1))
      expect(accumulatedInterestFee).to.equal(expectedInterestFee)
      expect(accumulatedInterestMaker).to.equal(expectedInterest)
    })

    it('charges interest fee for short position', async () => {
      const { userB } = instanceVars

      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](
          userB.address,
          0,
          SHORT_POSITION.mul(-1),
          COLLATERAL,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const [accountProcessEvents, positionProcessEvents] = await getOrderProcessingEvents(tx)

      // payoffPrice = 3374.655169**2 * 0.00001 = 113.882975
      const expectedInterest = BigNumber.from('177') // payoffPrice * 0.01 * 4912 seconds / 365 days
      const expectedInterestFee = BigNumber.from('35') // expectedInterest * .2

      const accumulatedInterest = accountProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.collateral),
        BigNumber.from(0),
      )
      const accumulatedInterestFee = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.interestFee),
        BigNumber.from(0),
      )
      const accumulatedInterestMaker = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.interestFee.add(e.accumulationResult.interestMaker)),
        BigNumber.from(0),
      )
      expect(accumulatedInterest).to.equal(expectedInterest.mul(-1))
      expect(accumulatedInterestFee).to.equal(expectedInterestFee)
      expect(accumulatedInterestMaker).to.equal(expectedInterest)
    })
  })

  describe('funding fee', () => {
    const MAKER_POSITION = parse6decimal('10')
    const SHORT_POSITION = parse6decimal('1')
    const LONG_POSITION = parse6decimal('1')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const riskParameter = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParameter,
        synBook: {
          ...riskParameter.synBook,
          scale: parse6decimal('1'),
        },
        pController: {
          k: parse6decimal('10'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
      })

      const { user, userB, userC, dsu } = instanceVars

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL)

      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          MAKER_POSITION,
          0,
          COLLATERAL,
          constants.AddressZero,
        )
      await nextWithConstantPrice()
      await settle(market, user)
    })

    it('charges funding fee for long position', async () => {
      const { userB } = instanceVars

      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](
          userB.address,
          0,
          LONG_POSITION,
          COLLATERAL,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const [accountProcessEvents, positionProcessEvents] = await getOrderProcessingEvents(tx)

      const expectedFunding = BigNumber.from('21259')
      const expectedFundingFee = expectedFunding.div(10)
      const expectedFundingWithFee = expectedFunding.add(expectedFundingFee.div(2))

      const accumulatedFunding = accountProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.collateral),
        BigNumber.from(0),
      )
      const accumulatedFundingFee = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.fundingFee),
        BigNumber.from(0),
      )
      const accumulatedFundingMaker = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.fundingFee.add(e.accumulationResult.fundingMaker)),
        BigNumber.from(0),
      )
      expect(accumulatedFunding).to.equal(expectedFundingWithFee.mul(-1).sub(1)) // precision loss
      expect(accumulatedFundingFee).to.equal(expectedFundingFee)
      expect(accumulatedFundingMaker).to.equal(expectedFundingWithFee.add(1)) // precision loss
    })

    it('charges funding fee for short position', async () => {
      const { userB } = instanceVars

      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](
          userB.address,
          0,
          SHORT_POSITION.mul(-1),
          COLLATERAL,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const [accountProcessEvents, positionProcessEvents] = await getOrderProcessingEvents(tx)

      const expectedFunding = BigNumber.from('21259')
      const expectedFundingFee = expectedFunding.div(10)
      const expectedFundingWithFee = expectedFunding.add(expectedFundingFee.div(2))

      const accumulatedFunding = accountProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.collateral),
        BigNumber.from(0),
      )
      const accumulatedFundingFee = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.fundingFee),
        BigNumber.from(0),
      )
      const accumulatedFundingMaker = positionProcessEvents.reduce(
        (acc: BigNumber, e) => acc.add(e.accumulationResult.fundingFee.add(e.accumulationResult.fundingMaker)),
        BigNumber.from(0),
      )
      expect(accumulatedFunding).to.equal(expectedFundingWithFee.mul(-1))
      expect(accumulatedFundingFee).to.equal(expectedFundingFee)
      expect(accumulatedFundingMaker).to.equal(expectedFundingWithFee)
    })
  })

  describe('referral fees', () => {
    const COLLATERAL = parse6decimal('600')
    const POSITION = parse6decimal('3')

    beforeEach(async () => {
      const { owner, user, userB, userC, userD, dsu, marketFactory } = instanceVars
      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL.mul(2))
      await dsu.connect(userD).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userD).deposit(userD.address, COLLATERAL)

      const riskParameter = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParameter,
        synBook: {
          ...riskParameter.synBook,
          scale: parse6decimal('1'),
        },
      })

      const marketParameter = await market.parameter()
      await market.updateParameter({
        ...marketParameter,
        takerFee: parse6decimal('0.025'),
        makerFee: parse6decimal('0.05'),
      })

      // set default referral fee
      const protocolParameters = await marketFactory.parameter()
      await expect(
        marketFactory.connect(owner).updateParameter({
          ...protocolParameters,
          referralFee: parse6decimal('0.12'),
        }),
      ).to.emit(marketFactory, 'ParameterUpdated')
      expect((await marketFactory.parameter()).referralFee).to.equal(parse6decimal('0.12'))

      // override referral fee for user
      await expect(marketFactory.connect(owner).updateReferralFee(user.address, parse6decimal('0.15')))
        .to.emit(marketFactory, 'ReferralFeeUpdated')
        .withArgs(user.address, parse6decimal('0.15'))
    })

    it('charges user referral fee for maker position', async () => {
      const { user, userB, dsu } = instanceVars

      // userB creates a maker position, referred by user
      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, user.address)
      const expectedReferral = parse6decimal('0.15').mul(3) // referralFee * position
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
        makerReferral: expectedReferral,
      })
      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)

      // ensure the proper amount of the base fee is claimable by the referrer
      // makerFee = position * makerFee * price = 3 * 0.05 * 113.882975 = 17.082446
      // referralFee = makerFee * referral / makerPos = 17.082446 * 0.45 / 3 = 2.562366
      const expectedClaimable = parse6decimal('2.562367')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
      })
      expect(await margin.claimables(user.address)).to.equal(expectedClaimable)
      await expect(margin.connect(user).claim(user.address, user.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, user.address, expectedClaimable)

      // Ensure user is not able to claim fees twice
      const userBalanceBefore = await dsu.balanceOf(user.address)
      await expect(margin.connect(user).claim(user.address, user.address))
      expect(await dsu.balanceOf(user.address)).to.equals(userBalanceBefore)
    })

    it('charges default referral fee for taker position', async () => {
      const { user, userB, userC } = instanceVars

      // user creates a non-referred maker position to facilitate a taker order
      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          POSITION.mul(2),
          0,
          COLLATERAL.mul(2),
          constants.AddressZero,
        )

      // userC creates a short position referred by userB
      await market
        .connect(userC)
        ['update(address,int256,int256,int256,address)'](
          userC.address,
          0,
          POSITION.mul(-1),
          COLLATERAL.mul(2),
          userB.address,
        )
      const expectedReferral = parse6decimal('0.12').mul(3) // referralFee * position
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 2,
        makerPos: POSITION.mul(2),
        shortPos: POSITION,
        collateral: COLLATERAL.mul(4),
        takerReferral: expectedReferral,
      })
      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)
      await settle(market, userC)

      // ensure the proper amount of the base fee is claimable by the referrer
      // takerFee = position * takerFee * price = 3 * 0.025 * 113.882975 = 8.541223
      // referralFee = takerFeeLinear * referral / takerPos =  8.541223 * 0.36 / 3 = 1.024946
      const expectedClaimable = parse6decimal('1.024947')
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
      })
      expect(await margin.claimables(userB.address)).to.equal(expectedClaimable)
      await expect(margin.connect(userB).claim(userB.address, userB.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(userB.address, userB.address, expectedClaimable)
    })

    it('handles a change in user referral fee', async () => {
      const { owner, user, userB, marketFactory } = instanceVars

      // revert if referral fee is more than 1
      await expect(
        marketFactory.connect(owner).updateReferralFee(user.address, parse6decimal('1.5')),
      ).to.be.revertedWithCustomError(marketFactory, 'MarketFactoryInvalidReferralFeeError')

      // increase referral fee for user
      await expect(marketFactory.connect(owner).updateReferralFee(user.address, parse6decimal('0.17')))
        .to.emit(marketFactory, 'ReferralFeeUpdated')
        .withArgs(user.address, parse6decimal('0.17'))

      // userB creates a maker position, referred by user
      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, user.address)
      const expectedReferral = parse6decimal('0.17').mul(3) // referralFee * position
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
        makerReferral: expectedReferral,
      })
      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)

      // ensure the proper amount of the base fee is claimable by the referrer
      // makerFee = position * makerFee * price = 3 * 0.05 * 113.882975 = 17.082446
      // referralFee = makerFee * referral / makerPos =  17.082446 * 0.51 / 3 = 2.904015
      const expectedClaimable = parse6decimal('2.904015')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
      })
      expect(await margin.claimables(user.address)).to.equal(expectedClaimable)
      await expect(margin.connect(user).claim(user.address, user.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, user.address, expectedClaimable)
    })

    it('handles referral fee for multiple orders', async () => {
      const { user, userB, userC, userD } = instanceVars

      // user creates a maker position order referred by userB
      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          POSITION.mul(2),
          0,
          COLLATERAL.mul(2),
          userB.address,
        )
      // userC creates a long position referred by user
      await market
        .connect(userC)
        ['update(address,int256,int256,int256,address)'](userC.address, 0, POSITION, COLLATERAL.mul(2), user.address)
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 2,
        makerPos: POSITION.mul(2),
        longPos: POSITION,
        collateral: COLLATERAL.mul(4),
        makerReferral: parse6decimal('0.12').mul(6), // defaultReferralFee * position = 0.72
        takerReferral: parse6decimal('0.15').mul(3), // userReferralFee * position    = 0.45
      })

      // settle all users
      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)
      await settle(market, userC)

      // userB claims the maker referral fee at the default rate
      // makerFee = position * makerFee * price = 6 * 0.05 * 113.882975 = 34.164892
      // referralFee = makerFee * referral / makerPos = 34.164892 * 0.72 / 6 = 4.099787
      const expectedClaimableMakerReferral = parse6decimal('4.099787')
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
      })
      expect(await margin.claimables(userB.address)).to.equal(expectedClaimableMakerReferral)
      await expect(margin.connect(userB).claim(userB.address, userB.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(userB.address, userB.address, expectedClaimableMakerReferral)

      // user should be able to claim the taker referral fee at the user rate
      // takerFee = position * takerFee * price = 3 * 0.025 * 113.882975 = 8.541223
      // referralFee = takerFee * referral / takerPos =  8.541223 * 0.45 / 3 = 1.281183
      let expectedClaimableTakerReferral = parse6decimal('1.281183')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.claimables(user.address)).to.equal(expectedClaimableTakerReferral)
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('1165.835106'))

      // userD creates a short position referred by user
      await market
        .connect(userD)
        ['update(address,int256,int256,int256,address)'](
          userD.address,
          0,
          POSITION.mul(2).div(3).mul(-1),
          COLLATERAL,
          user.address,
        )
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortPos: POSITION.mul(2).div(3),
        collateral: COLLATERAL,
        takerReferral: parse6decimal('0.15').mul(2), // userReferralFee * position = 0.30
      })

      // settle relevant users
      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userD)

      // user claims both taker referral fees
      // takerFee = position * takerFee * price = 2 * 0.025 * 113.882975 = 5.694148
      // referralFee = takerFee * referral / takerPos =  5.694148 * 0.30 / 2 = 0.854122
      expectedClaimableTakerReferral = expectedClaimableTakerReferral.add(parse6decimal('0.854122'))
      expect(await margin.claimables(user.address)).to.equal(expectedClaimableTakerReferral)
      await expect(margin.connect(user).claim(user.address, user.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, user.address, expectedClaimableTakerReferral)
    })

    it('allows for a new referrer on new orders', async () => {
      const { user, userB, userC } = instanceVars

      // user creates a non-referred maker position to facilitate a taker order
      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](
          user.address,
          POSITION.mul(2),
          0,
          COLLATERAL.mul(2),
          constants.AddressZero,
        )

      // userC creates a short position referred by userB
      await market
        .connect(userC)
        ['update(address,int256,int256,int256,address)'](
          userC.address,
          0,
          POSITION.mul(-1),
          COLLATERAL.mul(2),
          userB.address,
        )
      const currentId = (await market.locals(userC.address)).currentId
      const expectedReferral = parse6decimal('0.12').mul(3) // referralFee * position
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 2,
        makerPos: POSITION.mul(2),
        shortPos: POSITION,
        collateral: COLLATERAL.mul(4),
        takerReferral: expectedReferral,
      })
      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)
      await settle(market, userC) // update userC to clear values
      expect(await market.orderReferrers(userC.address, currentId)).to.equal(userB.address)
      expect((await market.locals(userC.address)).currentId).to.equal(currentId)

      // ensure the proper amount of the base fee is claimable by the referrer
      // takerFee = position * takerFee * price = 3 * 0.025 * 113.882975 = 8.541223
      // referralFee = takerFeeLinear * referral / takerPos =  8.541223 * 0.36 / 3 = 1.024946
      const expectedClaimable = parse6decimal('1.024947')
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
      })
      expect(await margin.claimables(userB.address)).to.equal(expectedClaimable)
      await expect(margin.connect(userB).claim(userB.address, userB.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(userB.address, userB.address, expectedClaimable)

      // userC closes a short position referred by user
      await market.connect(userC).close(userC.address, false, user.address)

      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)
      await settle(market, userC)

      // ensure the proper amount of the base fee is claimable by the referrer
      // takerFee = position * linearFee * price = 3 * 0.025 * 113.882975 = 8.541223
      // referralFee = takerFee * referral / takerPos =  8.541223 * 0.45 / 3 = 1.281183
      const expectedCloseClaimable = parse6decimal('1.281183')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.claimables(user.address)).to.equal(expectedCloseClaimable)
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('1165.835106'))
      await expect(margin.connect(user).claim(user.address, user.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, user.address, expectedCloseClaimable)
      expect(await market.orderReferrers(userC.address, currentId.add(1))).to.equal(user.address)

      await nextWithConstantPrice()
      // userC opens a short position referred by no one
      await market.connect(userC).close(userC.address, false, constants.AddressZero)
      await nextWithConstantPrice()
      expect(await market.orderReferrers(userC.address, currentId.add(2))).to.equal(constants.AddressZero)
    })
  })

  describe('claim fee', async () => {
    beforeEach(async () => {
      const riskParameter = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParameter,
        synBook: {
          ...riskParameter.synBook,
          scale: parse6decimal('1'),
        },
      })

      const marketParameter = await market.parameter()
      await market.updateParameter({
        ...marketParameter,
        takerFee: parse6decimal('0.025'),
        makerFee: parse6decimal('0.05'),
      })
    })

    it('claim protocol, risk and oracle fee', async () => {
      const COLLATERAL = parse6decimal('600')
      const POSITION = parse6decimal('3')
      const { owner, oracle, coordinator, user, dsu } = instanceVars
      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))

      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      await nextWithConstantPrice()
      await settle(market, user)

      const expectedProtocolFee = parse6decimal('5.124741')
      const expectedOracleFee = parse6decimal('5.124733')
      const expectedRiskFee = parse6decimal('6.832972')

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        oracleFee: expectedOracleFee,
        riskFee: expectedRiskFee,
        latestPrice: parse6decimal('113.882975'),
      })

      // revert when user tries to claim protocol fee
      await expect(market.connect(user).claimFee(owner.address)).to.be.revertedWithCustomError(
        market,
        'MarketNotOperatorError',
      )

      // claim protocol fee
      await expect(market.connect(owner).claimFee(owner.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(owner.address, owner.address, expectedProtocolFee)

      // claim oracle fee
      const oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
      await expect(market.connect(oracleSigner).claimFee(oracle.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(oracle.address, oracle.address, expectedOracleFee)

      // claim risk fee
      await expect(market.connect(coordinator).claimFee(coordinator.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(coordinator.address, coordinator.address, expectedRiskFee)
    })

    it('claim protocol fee from insurance fund', async () => {
      const COLLATERAL = parse6decimal('600')
      const POSITION = parse6decimal('3')
      const { owner, user, marketFactory, dsu, insuranceFund } = instanceVars
      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(2).mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL.mul(2))

      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      await nextWithConstantPrice()
      await settle(market, user)

      const expectedProtocolFee = parse6decimal('5.124741')
      const expectedOracleFee = parse6decimal('5.124733')
      const expectedRiskFee = parse6decimal('6.832972')

      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        oracleFee: expectedOracleFee,
        riskFee: expectedRiskFee,
        latestPrice: parse6decimal('113.882975'),
      })

      // set insurance fund as operator for market factory owner
      await marketFactory.connect(owner).updateOperator(insuranceFund.address, true)

      // revert when user tries to claim protocol fee
      await expect(market.connect(user).claimFee(owner.address)).to.be.revertedWithCustomError(
        market,
        'MarketNotOperatorError',
      )

      // claim protocol fee
      const balanceBefore = await dsu.balanceOf(owner.address)
      await expect(insuranceFund.connect(owner).claim(market.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(owner.address, insuranceFund.address, expectedProtocolFee)
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(insuranceFund.address, owner.address, expectedProtocolFee)
      expect(await dsu.balanceOf(owner.address)).to.equal(balanceBefore.add(expectedProtocolFee.mul(1e12)))
    })
  })

  describe('intent order fee exclusion', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('10000')

    beforeEach(async () => {
      const { userB, dsu } = instanceVars

      const riskParameter = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParameter,
        synBook: {
          ...riskParameter.synBook,
          d0: parse6decimal('0.001'),
          d1: parse6decimal('0.002'),
          d2: parse6decimal('0.004'),
          d3: parse6decimal('0.008'),
        },
      })

      const marketParameter = await market.parameter()
      await market.updateParameter({
        ...marketParameter,
        takerFee: parse6decimal('0.025'),
        makerFee: parse6decimal('0.05'),
      })

      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)

      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

      await nextWithConstantPrice()
      await settle(market, userB)
    })

    it('opens long position and another intent order and settles later with fee', async () => {
      const { owner, user, userB, userC, userD, marketFactory, dsu, chainlink } = instanceVars

      // userC allowed to interact with user's account
      await marketFactory.connect(user).updateOperator(userC.address, true)

      const protocolParameter = { ...(await marketFactory.parameter()) }
      protocolParameter.referralFee = parse6decimal('0.20')

      await marketFactory.updateParameter(protocolParameter)

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, 0, 0, COLLATERAL, constants.AddressZero)

      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL)
      await market
        .connect(userC)
        ['update(address,int256,int256,int256,address)'](userC.address, 0, 0, COLLATERAL, constants.AddressZero)

      await dsu.connect(userD).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userD).deposit(userD.address, COLLATERAL)
      await market
        .connect(userD)
        ['update(address,int256,int256,int256,address)'](userD.address, 0, POSITION, COLLATERAL, constants.AddressZero)

      const intent = {
        amount: POSITION.div(2),
        price: PRICE.add(0.5e6),
        fee: parse6decimal('0.5'),
        originator: userC.address,
        solver: owner.address,
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

      const verifier = Verifier__factory.connect(await market.verifier(), owner)

      const signature = await signIntent(user, verifier, intent)

      await market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature)

      console.log(5)
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
        notional: POSITION.div(2).mul(PRICE.add(0.5e6)).div(1e6), // loss of precision
        longPos: POSITION.div(2),
        orderReferral: parse6decimal('1.0'),
        solverReferral: parse6decimal('0.5'),
      })
      expectOrderEq(await market.pending(), {
        ...DEFAULT_ORDER,
        orders: 3,
        collateral: COLLATERAL.mul(3),
        longPos: POSITION.mul(3).div(2),
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

      await chainlink.next()

      await market.settle(user.address)
      await market.settle(userB.address)
      await market.settle(userC.address)
      await market.settle(userD.address)

      const PRICE_IMPACT = parse6decimal('6.135790') // skew 0 -> 1, price_2, exposure +10
      const EXPECTED_PNL = parse6decimal('3.31642') // position * (price_2 - (price_1 + 0.5))
      const TRADE_FEE_A = parse6decimal('14.380785') // position * (0.025) * price_2

      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(user.address, market.address)).to.equal(
        COLLATERAL.add(EXPECTED_PNL).sub(TRADE_FEE_A),
      ) // loss of precision

      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: POSITION.div(2),
      })
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longPos: POSITION.div(2),
        takerReferral: POSITION.div(2).mul(2).div(10),
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: TRADE_FEE_A,
        transfer: COLLATERAL,
        collateral: EXPECTED_PNL,
      })

      const TRADE_FEE_B = parse6decimal('56.941490') // position * 0.05 * price

      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(
        COLLATERAL.sub(TRADE_FEE_B).add(PRICE_IMPACT),
      ) // loss of precision
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: POSITION,
      })
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        collateral: COLLATERAL.sub(TRADE_FEE_B).add(PRICE_IMPACT),
      })

      // no trade fee deducted for userC for intent order
      expectLocalEq(await market.locals(userC.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.claimables(userC.address)).to.equal(TRADE_FEE_A.div(10).add(1)) // loss of precision
      expect(await margin.isolatedBalances(userC.address, market.address)).to.equal(COLLATERAL.sub(EXPECTED_PNL))
      expectPositionEq(await market.positions(userC.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        short: POSITION.div(2),
      })
      expectOrderEq(await market.pendingOrders(userC.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortPos: POSITION.div(2),
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userC.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        transfer: COLLATERAL,
        collateral: -EXPECTED_PNL,
      })

      const TRADE_FEE_D = parse6decimal('28.761564') // position * (0.025) * price_2
      expectLocalEq(await market.locals(userD.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
      })
      expect(await margin.isolatedBalances(userD.address, market.address)).to.equal(
        COLLATERAL.sub(TRADE_FEE_D).sub(PRICE_IMPACT).sub(16),
      ) // loss of precision
      expectPositionEq(await market.positions(userD.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: POSITION,
      })
      expectOrderEq(await market.pendingOrders(userD.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longPos: POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userD.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: PRICE_IMPACT.add(TRADE_FEE_D).add(16), // loss of precision
        transfer: COLLATERAL,
      })
    })

    // FIXME: Failing here with arithmetic underflow in position.updateClose() in _accumulateSpread()
    it.skip('intent order fee exclusion with zero cross', async () => {
      const { owner, user, userB, userC, marketFactory, verifier, dsu, chainlink } = instanceVars

      const protocolParameter = { ...(await marketFactory.parameter()) }
      protocolParameter.referralFee = parse6decimal('0.20')

      await marketFactory.updateParameter(protocolParameter)

      const POSITION = parse6decimal('10')
      const COLLATERAL = parse6decimal('10000')

      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](userB.address, POSITION, 0, COLLATERAL, constants.AddressZero)

      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await market
        .connect(user)
        ['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, constants.AddressZero)

      await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userC).deposit(userC.address, COLLATERAL)
      await market
        .connect(userC)
        ['update(address,int256,int256,address)'](userC.address, 0, COLLATERAL, constants.AddressZero)

      const intent: IntentStruct = {
        amount: POSITION.div(4).mul(-1),
        price: PRICE.add(2),
        fee: parse6decimal('0.5'),
        originator: userC.address,
        solver: owner.address,
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

      const intent2: IntentStruct = {
        amount: POSITION.div(2),
        price: PRICE.add(2),
        fee: parse6decimal('0.5'),
        originator: userC.address,
        solver: owner.address,
        collateralization: parse6decimal('0.01'),
        common: {
          account: user.address,
          signer: user.address,
          domain: market.address,
          nonce: 1,
          group: 0,
          expiry: constants.MaxUint256,
        },
      }

      const signature1 = await signIntent(user, verifier, intent)
      const signature2 = await signIntent(user, verifier, intent2)

      await market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent, signature1)

      await market
        .connect(userC)
        [
          'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
        ](userC.address, intent2, signature2)

      expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
        ...DEFAULT_GUARANTEE,
        orders: 4,
        longPos: POSITION.div(2),
        longNeg: POSITION.div(4),
        shortPos: POSITION.div(2),
        shortNeg: POSITION.div(4),
        takerFee: POSITION.div(4).mul(3),
        orderReferral: parse6decimal('1.5'),
      })
      expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
        ...DEFAULT_GUARANTEE,
        orders: 2,
        notional: POSITION.div(4).mul(PRICE).div(1e6).add(6), // loss of precision
        longPos: POSITION.div(4),
        shortNeg: POSITION.div(4),
        shortPos: POSITION.div(4),
        orderReferral: parse6decimal('1.5'),
        solverReferral: parse6decimal('0.75'),
      })
      expectOrderEq(await market.pending(), {
        ...DEFAULT_ORDER,
        orders: 5,
        collateral: COLLATERAL.mul(3),
        makerPos: POSITION,
        longPos: POSITION.div(2),
        longNeg: POSITION.div(4),
        shortPos: POSITION.div(2),
        shortNeg: POSITION.div(4),
        takerReferral: parse6decimal('1.5'),
      })
      expectOrderEq(await market.pendings(user.address), {
        ...DEFAULT_ORDER,
        orders: 2,
        collateral: COLLATERAL,
        longPos: POSITION.div(4),
        shortPos: POSITION.div(4),
        shortNeg: POSITION.div(4),
        takerReferral: parse6decimal('1.5'),
      })
      expectOrderEq(await market.pendings(userC.address), {
        ...DEFAULT_ORDER,
        orders: 2,
        collateral: COLLATERAL,
        longPos: POSITION.div(4),
        longNeg: POSITION.div(4),
        shortPos: POSITION.div(4),
      })

      await chainlink.next()
      await chainlink.next()

      await market.settle(user.address)
      await market.settle(userB.address)
      await market.settle(userC.address)

      const EXPECTED_PNL = POSITION.div(4).mul(PRICE.add(2).sub(PRICE_1)).div(1e6) // position * price change
      const TRADE_FEE_A = parse6decimal('21.336843') // position * (0.025) * price_1

      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(EXPECTED_PNL).sub(TRADE_FEE_A).sub(6), // loss of precision
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        long: POSITION.div(4),
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
      })
      const TRADE_FEE_B = parse6decimal('56.898250') // position * 0.05 * price_1
      const MAKER_LINEAR_FEE = parse6decimal('102.416848') // position * 0.09 * price_1
      const MAKER_PROPORTIONAL_FEE = parse6decimal('91.037198') // position * 0.08 * price_1
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(TRADE_FEE_B).sub(MAKER_LINEAR_FEE).sub(MAKER_PROPORTIONAL_FEE).sub(4), // loss of precision
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: POSITION,
      })
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
      })

      // no trade fee deducted for userC for intent order
      expectLocalEq(await market.locals(userC.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.add(EXPECTED_PNL).add(1), // loss of precision
        claimable: TRADE_FEE_A.div(10).add(1), // loss of precision
      })
      expectPositionEq(await market.positions(userC.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        short: POSITION.div(4),
      })
      expectCheckpointEq(await market.checkpoints(userC.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
      })
    })
  })
})
