import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, ContractTransaction, utils } from 'ethers'
const { AddressZero } = constants

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
import { Market, Verifier__factory } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  AccountPositionProcessedEventObject,
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
  takerFee: {
    linearFee: parse6decimal('0.05'),
    proportionalFee: parse6decimal('0.06'),
    adiabaticFee: parse6decimal('0.14'),
    scale: parse6decimal('1'),
  },
  makerFee: {
    linearFee: parse6decimal('0.09'),
    proportionalFee: parse6decimal('0.08'),
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
  makerFee: parse6decimal('0.05'),
  takerFee: parse6decimal('0.025'),
}

describe('Fees', () => {
  let instanceVars: InstanceVars
  let market: Market

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
    const txEvents = (await tx.wait()).events!
    const accountProcessEvents: Array<AccountPositionProcessedEventObject> = txEvents
      .filter(e => e.event === 'AccountPositionProcessed')
      .map(e => e.args as unknown as AccountPositionProcessedEventObject)
    const positionProcessEvents: Array<PositionProcessedEventObject> = txEvents
      .filter(e => e.event === 'PositionProcessed')
      .map(e => e.args as unknown as PositionProcessedEventObject)
    return [accountProcessEvents, positionProcessEvents]
  }

  beforeEach(async () => {
    instanceVars = await loadFixture(fixture)
    instanceVars.chainlink.updateParams(BigNumber.from(0), parse6decimal('0.3'))
    await instanceVars.chainlink.reset()
    market = await createMarket(instanceVars, undefined, RISK_PARAMS, MARKET_PARAMS)
  })

  describe('position fees', () => {
    it('charges make fees on open', async () => {
      const POSITION = parse6decimal('10')
      const COLLATERAL = parse6decimal('1000')
      const { user, dsu } = instanceVars

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
      const expectedMakerLinear = parse6decimal('102.494680') // = 3374.655169**2 * 0.0001 * (0.09)
      const expectedMakerProportional = parse6decimal('91.106380') // = 3374.655169**2 * 0.0001 * (0.08)

      expect(accountProcessEvent?.accumulationResult.tradeFee).to.equal(expectedMakerFee)
      expect(accountProcessEvent?.accumulationResult.offset).to.equal(
        expectedMakerLinear.add(expectedMakerProportional),
      )

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedMakerFee).sub(expectedMakerLinear).sub(expectedMakerProportional),
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
        tradeFee: expectedMakerFee.add(expectedMakerLinear).add(expectedMakerProportional),
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: POSITION,
      })

      // Check global post-settlement state (no existing makers so all fees go to protocol/market)
      const expectedOracleFee = BigNumber.from('75162763') // = (250542544) * 0.3
      const expectedRiskFee = BigNumber.from('100216917') // = (250542544) * 0.4
      const expectedProtocolFee = BigNumber.from('75162864') // = 250542544 - 75162763 - 100217017
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
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

    it('charges make fees on close', async () => {
      const riskParams = { ...(await market.riskParameter()) }
      const previousRiskParams = { ...riskParams }
      const riskParamsMakerFee = { ...riskParams.makerFee }
      riskParamsMakerFee.linearFee = BigNumber.from('0')
      riskParamsMakerFee.proportionalFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

      const marketParams = { ...(await market.parameter()) }
      const previousMarketParams = { ...marketParams }
      marketParams.makerFee = BigNumber.from('0')
      await market.updateParameter(marketParams)

      const POSITION = parse6decimal('10')
      const COLLATERAL = parse6decimal('1000')
      const { user, dsu } = instanceVars

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
            makerPos: POSITION,
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, user)

      await market.updateRiskParameter(previousRiskParams)
      await market.updateParameter(previousMarketParams)
      await market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

      // Settle the market with a new oracle version
      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const expectedMakerFee = parse6decimal('56.941490') // = 3374.655169**2 * 0.0001 * (0.05)
      const expectedMakerLinear = parse6decimal('102.494680') // = 3374.655169**2 * 0.0001 * (0.09)
      const expectedMakerProportional = parse6decimal('91.106380') // = 3374.655169**2 * 0.0001 * (0.08)

      expect(accountProcessEvent?.accumulationResult.tradeFee).to.equal(expectedMakerFee)
      expect(accountProcessEvent?.accumulationResult.offset).to.equal(
        expectedMakerLinear.add(expectedMakerProportional),
      )

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedMakerFee).sub(10), // Maker gets part of their fee refunded since they were an exisiting maker
      })
      expectOrderEq(await market.pendingOrders(user.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerNeg: POSITION,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedMakerFee.add(expectedMakerLinear).add(expectedMakerProportional),
        collateral: COLLATERAL.add(expectedMakerLinear).add(expectedMakerProportional).sub(10),
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      // Check global post-settlement state. Existing makers so protocol only gets 50% of fees
      const expectedOracleFee = BigNumber.from('17082446') // = (56941487) * 0.3
      const expectedRiskFee = BigNumber.from('22776572') // = (56941487) * 0.4
      const expectedProtocolFee = BigNumber.from('17082469') // = 56941487 - 17082446 - 22776594
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        makerNeg: POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })
    })

    it('charges take fees on long open', async () => {
      const riskParams = { ...(await market.riskParameter()) }
      const riskParamsMakerFee = { ...riskParams.makerFee }
      riskParamsMakerFee.linearFee = BigNumber.from('0')
      riskParamsMakerFee.proportionalFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

      const marketParams = { ...(await market.parameter()) }
      marketParams.makerFee = BigNumber.from('0')
      await market.updateParameter(marketParams)

      const MAKER_POSITION = parse6decimal('10')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(
        market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            LONG_POSITION,
            0,
            COLLATERAL,
            false,
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
      const expectedTakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedTakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedtakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(accountProcessEventLong.accumulationResult.offset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedtakerAdiabatic),
      )

      expect(processEvent.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(processEvent.accumulationResult.tradeOffset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedtakerAdiabatic),
      )
      expect(processEvent.accumulationResult.tradeOffsetMaker).to.eq(0)
      expect(processEvent.accumulationResult.tradeOffsetMarket).to.eq(
        expectedTakerLinear.add(expectedTakerProportional),
      )

      const expectedOracleFee = BigNumber.from('4612260') // = (15374200) * 0.3
      const expectedRiskFee = BigNumber.from('6149673') // = (15374200) * 0.4
      const expectedProtocolFee = BigNumber.from('4612267') // = 15374200 - 4612260 - 6149680

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
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
        collateral: COLLATERAL.sub(expectedTakerFee)
          .sub(expectedTakerLinear)
          .sub(expectedTakerProportional)
          .sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        longPos: LONG_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedTakerFee.add(expectedTakerLinear).add(expectedTakerProportional).add(expectedtakerAdiabatic),
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        long: LONG_POSITION,
      })
    })

    it('charges take fees on long open, distributes to existing makes', async () => {
      const riskParams = { ...(await market.riskParameter()) }
      const riskParamsMakerFee = { ...riskParams.makerFee }
      riskParamsMakerFee.linearFee = BigNumber.from('0')
      riskParamsMakerFee.proportionalFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

      const marketParams = { ...(await market.parameter()) }
      marketParams.makerFee = BigNumber.from('0')
      await market.updateParameter(marketParams)

      const MAKER_POSITION = parse6decimal('10')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)

      // Settle maker to give them portion of fees
      await nextWithConstantPrice()
      await settle(market, user)

      await expect(
        market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            LONG_POSITION,
            0,
            COLLATERAL,
            false,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userB.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
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
      const expectedTakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedTakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedTakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(accountProcessEventLong.accumulationResult.offset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedTakerAdiabatic),
      )

      expect(processEvent.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(processEvent.accumulationResult.tradeOffset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedTakerAdiabatic),
      )
      expect(processEvent.accumulationResult.tradeOffsetMaker).to.eq(expectedTakerLinear.add(expectedTakerProportional))
      expect(processEvent.accumulationResult.tradeOffsetMarket).to.eq(0)

      const expectedOracleFee = BigNumber.from('854122') // = (2847074) * 0.3
      const expectedRiskFee = BigNumber.from('1138828') // = (2847074) * 0.4
      const expectedProtocolFee = BigNumber.from('854124') // = 2847074 - 854122 - 1138829

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longPos: LONG_POSITION,
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
        long: LONG_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedTakerFee)
          .sub(expectedTakerLinear)
          .sub(expectedTakerProportional)
          .sub(expectedTakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longPos: LONG_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedTakerFee.add(expectedTakerLinear).add(expectedTakerProportional).add(expectedTakerAdiabatic),
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: LONG_POSITION,
      })

      const txMaker = await settle(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = expectedTakerLinear.add(expectedTakerProportional).sub(16)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: MAKER_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })
    })

    it('charges take fees on long close', async () => {
      const riskParams = await market.riskParameter()
      const marketParams = await market.parameter()
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market.updateParameter({
        ...marketParams,
        fundingFee: BigNumber.from('0'),
        makerFee: 0,
        takerFee: 0,
      })

      const MAKER_POSITION = parse6decimal('10')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(
        market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            LONG_POSITION,
            0,
            COLLATERAL,
            false,
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
      await settle(market, userB)
      await settle(market, user)

      // Re-enable fees for close, disable skew and impact for ease of calculation
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market.updateParameter({
        ...marketParams,
        fundingFee: BigNumber.from('0'),
        makerFee: 0,
      })

      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)

      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedTakerFee = parse6decimal('2.847074') // = 3374.655169**2 * 0.00001 * (0.025)
      const expectedTakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedTakerProportional = 0
      const expectedTakerAdiabatic = 0

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(accountProcessEventLong.accumulationResult.offset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedTakerAdiabatic),
      )

      const expectedOracleFee = BigNumber.from('854122') // = (2847074) * 0.3
      const expectedRiskFee = BigNumber.from('1138828') // = (2847074) * 0.4
      const expectedProtocolFee = BigNumber.from('854124') // = 2847074 - 854122 - 1138829

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longNeg: LONG_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedTakerFee)
          .sub(expectedTakerLinear)
          .sub(expectedTakerProportional)
          .sub(expectedTakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        longNeg: LONG_POSITION,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedTakerFee.add(expectedTakerLinear).add(expectedTakerProportional).add(expectedTakerAdiabatic),
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      const txMaker = await settle(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = expectedTakerLinear.add(expectedTakerProportional).sub(8)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: MAKER_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })
    })

    it('charges take fees on short open', async () => {
      const riskParams = { ...(await market.riskParameter()) }
      const riskParamsMakerFee = { ...riskParams.makerFee }
      riskParamsMakerFee.linearFee = BigNumber.from('0')
      riskParamsMakerFee.proportionalFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

      const marketParams = { ...(await market.parameter()) }
      marketParams.makerFee = BigNumber.from('0')
      await market.updateParameter(marketParams)

      const MAKER_POSITION = parse6decimal('10')
      const SHORT_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(
        market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userB.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_1,
            orders: 1,
            shortPos: SHORT_POSITION,
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
      const expectedTakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedTakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedtakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(accountProcessEventLong.accumulationResult.offset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedtakerAdiabatic),
      )

      expect(processEvent.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(processEvent.accumulationResult.tradeOffset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedtakerAdiabatic),
      )
      expect(processEvent.accumulationResult.tradeOffsetMaker).to.eq(0)
      expect(processEvent.accumulationResult.tradeOffsetMarket).to.eq(
        expectedTakerLinear.add(expectedTakerProportional),
      )

      const expectedOracleFee = BigNumber.from('4612260') // = (15374200) * 0.3
      const expectedRiskFee = BigNumber.from('6149673') // = (15374200) * 0.4
      const expectedProtocolFee = BigNumber.from('4612267') // = 15374200 - 4612260 - 6149680

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 1,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 2,
        makerPos: MAKER_POSITION,
        shortPos: SHORT_POSITION,
        collateral: COLLATERAL.mul(2),
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: MAKER_POSITION,
        short: SHORT_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedTakerFee)
          .sub(expectedTakerLinear)
          .sub(expectedTakerProportional)
          .sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        shortPos: SHORT_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedTakerFee.add(expectedTakerLinear).add(expectedTakerProportional).add(expectedtakerAdiabatic),
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        short: SHORT_POSITION,
      })
    })

    it('charges take fees on short open, distributes to existing makes', async () => {
      const riskParams = { ...(await market.riskParameter()) }
      const riskParamsMakerFee = { ...riskParams.makerFee }
      riskParamsMakerFee.linearFee = BigNumber.from('0')
      riskParamsMakerFee.proportionalFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

      const marketParams = { ...(await market.parameter()) }
      marketParams.makerFee = BigNumber.from('0')
      await market.updateParameter(marketParams)

      const MAKER_POSITION = parse6decimal('10')
      const SHORT_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)

      // Settle maker to give them portion of fees
      await nextWithConstantPrice()
      await settle(market, user)

      await expect(
        market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userB.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_2,
            orders: 1,
            shortPos: SHORT_POSITION,
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
      const expectedTakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedTakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedTakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(accountProcessEventLong.accumulationResult.offset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedTakerAdiabatic),
      )

      expect(processEvent.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(processEvent.accumulationResult.tradeOffset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedTakerAdiabatic),
      )
      expect(processEvent.accumulationResult.tradeOffsetMaker).to.eq(expectedTakerLinear.add(expectedTakerProportional))
      expect(processEvent.accumulationResult.tradeOffsetMarket).to.eq(0)

      const expectedOracleFee = BigNumber.from('854122') // = (2847074) * 0.3
      const expectedRiskFee = BigNumber.from('1138828') // = (2847074) * 0.4
      const expectedProtocolFee = BigNumber.from('854124') // = 2847074 - 854122 - 1138829

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortPos: SHORT_POSITION,
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
        short: SHORT_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedTakerFee)
          .sub(expectedTakerLinear)
          .sub(expectedTakerProportional)
          .sub(expectedTakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortPos: SHORT_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        short: SHORT_POSITION,
      })

      const txMaker = await settle(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = expectedTakerLinear.add(expectedTakerProportional).sub(16)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: MAKER_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })
    })

    it('charges take fees on short close', async () => {
      const riskParams = await market.riskParameter()
      const marketParams = await market.parameter()
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market.updateParameter({
        ...marketParams,
        fundingFee: BigNumber.from('0'),
        makerFee: 0,
        takerFee: 0,
      })

      const MAKER_POSITION = parse6decimal('10')
      const SHORT_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(
        market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          ),
      )
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userB.address,
          {
            ...DEFAULT_ORDER,
            timestamp: TIMESTAMP_1,
            orders: 1,
            shortPos: SHORT_POSITION,
            collateral: COLLATERAL,
            invalidation: 1,
          },
          { ...DEFAULT_GUARANTEE },
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await settle(market, userB)
      await settle(market, user)

      // Re-enable fees for close, disable skew and impact for ease of calculation
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market.updateParameter({
        ...marketParams,
        fundingFee: BigNumber.from('0'),
        makerFee: 0,
      })
      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)

      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedTakerFee = parse6decimal('2.847074') // = 3374.655169**2 * 0.00001 * (0.025)
      const expectedTakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedTakerProportional = 0
      const expectedTakerAdiabatic = 0

      expect(accountProcessEventLong.accumulationResult.tradeFee).to.eq(expectedTakerFee)
      expect(accountProcessEventLong.accumulationResult.offset).to.eq(
        expectedTakerLinear.add(expectedTakerProportional).add(expectedTakerAdiabatic),
      )

      const expectedOracleFee = BigNumber.from('854122') // = (2847074) * 0.3
      const expectedRiskFee = BigNumber.from('1138828') // = (2847074) * 0.4
      const expectedProtocolFee = BigNumber.from('854124') // = 2847074 - 854122 - 1138829

      // Global State
      expectGlobalEq(await market.global(), {
        ...DEFAULT_GLOBAL,
        currentId: 2,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        latestPrice: PRICE,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortNeg: SHORT_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedTakerFee)
          .sub(expectedTakerLinear)
          .sub(expectedTakerProportional)
          .sub(expectedTakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
        orders: 1,
        shortNeg: SHORT_POSITION,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
        tradeFee: expectedTakerFee.add(expectedTakerLinear).add(expectedTakerProportional).add(expectedTakerAdiabatic),
        collateral: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      const txMaker = await settle(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = expectedTakerLinear.add(expectedTakerProportional).sub(8)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: MAKER_POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
        ...DEFAULT_CHECKPOINT,
        transfer: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })
    })

    describe('proportional fee', () => {
      const MAKER_POSITION = parse6decimal('10')
      const SHORT_POSITION = parse6decimal('1')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')

      beforeEach(async () => {
        const riskParams = { ...(await market.riskParameter()) }
        const marketParams = { ...(await market.parameter()) }
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: {
            ...riskParams.makerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
          },
          takerFee: {
            ...riskParams.takerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: parse6decimal('0.01'),
            adiabaticFee: BigNumber.from('0'),
          },
        })
        await market.updateParameter({
          ...marketParams,
          makerFee: 0,
          takerFee: 0,
        })

        const { user, userB, userC, dsu } = instanceVars

        await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
        await nextWithConstantPrice()
        await settle(market, user)
      })

      it('charges skew fee for changing skew', async () => {
        const { userB, userC } = instanceVars

        // Bring skew from 0 to 100% -> total skew change of 100%
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          )

        await nextWithConstantPrice()
        const txShort = await settle(market, userB)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await txShort.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await txShort.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortProportionalFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        expect(accountProcessEventShort.accumulationResult.offset).to.equal(expectedShortProportionalFee)
        expect(
          positionProcessEventShort.accumulationResult.tradeOffsetMaker.add(
            positionProcessEventShort.accumulationResult.tradeOffsetMarket,
          ),
        ).to.equal(expectedShortProportionalFee)

        // Bring skew from -100% to +50% -> total skew change of 150%
        await market
          .connect(userC)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userC.address,
            0,
            LONG_POSITION.mul(2),
            0,
            COLLATERAL,
            false,
          )

        await nextWithConstantPrice()
        const txLong = await settle(market, userC)
        const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventLong: PositionProcessedEventObject = (await txLong.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedLongProportionalFee = BigNumber.from('4555319') // = 3374.655169**2 / 100000 * 2 * 200% * 0.01

        expect(accountProcessEventLong.accumulationResult.offset).to.within(
          expectedLongProportionalFee,
          expectedLongProportionalFee.add(10),
        )
        expect(
          positionProcessEventLong.accumulationResult.tradeOffsetMaker.add(
            positionProcessEventLong.accumulationResult.tradeOffsetMarket,
          ),
        ).to.equal(expectedLongProportionalFee)
      })
    })

    describe('adiabatic fee', () => {
      const MAKER_POSITION = parse6decimal('10')
      const SHORT_POSITION = parse6decimal('1')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')

      beforeEach(async () => {
        const riskParams = { ...(await market.riskParameter()) }
        const marketParams = { ...(await market.parameter()) }
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: {
            ...riskParams.makerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
          },
          takerFee: {
            ...riskParams.takerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
            adiabaticFee: parse6decimal('0.02'),
          },
        })
        await market.updateParameter({
          ...marketParams,
          makerFee: 0,
          takerFee: 0,
        })

        const { user, userB, userC, dsu } = instanceVars

        await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
        await nextWithConstantPrice()
        await settle(market, user)
      })

      it('charges taker impact fee for changing skew (short)', async () => {
        const { userB } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          )

        await nextWithConstantPrice()
        const tx = await settle(market, userB)
        const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEvent: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortAdiabaticFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        expect(accountProcessEvent.accumulationResult.offset).to.equal(expectedShortAdiabaticFee)
      })

      it('charges taker impact fee for changing skew (long)', async () => {
        const { userB } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)

        await nextWithConstantPrice()
        const tx = await settle(market, userB)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortAdiabaticFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        expect(accountProcessEventShort.accumulationResult.offset).to.equal(expectedShortAdiabaticFee)
      })

      it('refunds taker position fee for negative impact', async () => {
        const { userB, userC } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          )

        await nextWithConstantPrice()
        await settle(market, userB)

        // Enable position fee to test refund
        const riskParams = await market.riskParameter()
        await market.updateRiskParameter({
          ...riskParams,
          takerFee: {
            ...riskParams.takerFee,
            linearFee: parse6decimal('0.01'),
            adiabaticFee: parse6decimal('0.02'),
          },
        })
        // Bring skew from -100% to 0% -> total impact change of -100%
        await market
          .connect(userC)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, LONG_POSITION, 0, COLLATERAL, false)

        await nextWithConstantPrice()
        const tx = await settle(market, userC)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortLinearFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        const expectedShortAdiabaticFee = BigNumber.from('-1138829') // = 3374.655169**2 * -0.00001 * 100% * 0.01
        expect(accountProcessEventShort.accumulationResult.offset).to.equal(
          expectedShortLinearFee.add(expectedShortAdiabaticFee),
        )
      })

      it('refunds taker position fee for negative impact (negative fees)', async () => {
        const { userB, userC } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userB.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
          )

        await nextWithConstantPrice()
        await settle(market, userB)

        // Enable position fee to test refund
        const riskParams = await market.riskParameter()
        await market.updateRiskParameter({
          ...riskParams,
          takerFee: {
            ...riskParams.takerFee,
            linearFee: parse6decimal('0.01'),
            adiabaticFee: parse6decimal('0.04'),
          },
        })
        // Bring skew from -100% to 0% -> total impact change of -100%
        await market
          .connect(userC)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, LONG_POSITION, 0, COLLATERAL, false)

        await nextWithConstantPrice()
        const tx = await settle(market, userC)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortLinearFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        const expectedShortAdiabaticFee = BigNumber.from('-2277659') // = 3374.655169**2 *-0.00001 * 100% * 0.02
        expect(accountProcessEventShort.accumulationResult.offset).to.equal(
          expectedShortLinearFee.add(expectedShortAdiabaticFee),
        )
      })
    })

    describe('settlement fee', () => {
      const MAKER_POSITION = parse6decimal('10')
      const SHORT_POSITION = parse6decimal('1')
      const LONG_POSITION = parse6decimal('1')
      const COLLATERAL = parse6decimal('1000')

      beforeEach(async () => {
        const riskParams = await market.riskParameter()
        const marketParams = await market.parameter()
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: {
            ...riskParams.makerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
          },
          takerFee: {
            ...riskParams.takerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
            adiabaticFee: BigNumber.from('0'),
          },
        })
        await market.updateParameter({
          ...marketParams,
          makerFee: 0,
          takerFee: 0,
        })

        const { user, userB, userC, dsu } = instanceVars

        await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
        await nextWithConstantPrice()
        await settle(market, user)

        await market.updateParameter({
          ...marketParams,
          makerFee: 0,
          takerFee: 0,
        })
        instanceVars.chainlink.updateParams(parse6decimal('1.23'), instanceVars.chainlink.oracleFee)
      })

      it('charges settlement fee for maker', async () => {
        await market
          .connect(instanceVars.user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            instanceVars.user.address,
            MAKER_POSITION.mul(2),
            0,
            0,
            0,
            false,
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
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)
        await market
          .connect(userC)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userC.address,
            0,
            0,
            SHORT_POSITION,
            COLLATERAL,
            false,
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
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
        utilizationCurve: {
          minRate: parse6decimal('0.01'),
          maxRate: parse6decimal('0.01'),
          targetRate: parse6decimal('0.01'),
          targetUtilization: parse6decimal('1'),
        },
      })

      const { user, userB, userC, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await nextWithConstantPrice()
      await settle(market, user)
    })

    it('charges interest fee for long position', async () => {
      const { userB } = instanceVars

      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)

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
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

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
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
        pController: {
          k: parse6decimal('10'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
      })

      const { user, userB, userC, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await nextWithConstantPrice()
      await settle(market, user)
    })

    it('charges funding fee for long position', async () => {
      const { userB } = instanceVars

      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)

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
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

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
      await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userC).approve(market.address, COLLATERAL.mul(2).mul(1e12))
      await dsu.connect(userD).approve(market.address, COLLATERAL.mul(1e12))

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
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          userB.address,
          POSITION,
          0,
          0,
          COLLATERAL,
          false,
          user.address,
        )
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
        claimable: expectedClaimable,
      })
      await expect(market.connect(user).claimFee(user.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, user.address, expectedClaimable)

      const userBalanceBefore = await dsu.balanceOf(user.address)

      // Ensure user is not able to claim fees twice
      await expect(market.connect(user).claimFee(user.address))

      expect(await dsu.balanceOf(user.address)).to.equals(userBalanceBefore)
    })

    it('charges default referral fee for taker position', async () => {
      const { user, userB, userC } = instanceVars

      // user creates a non-referred maker position to facilitate a taker order
      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          user.address,
          POSITION.mul(2),
          0,
          0,
          COLLATERAL.mul(2),
          false,
        )

      // userC creates a short position referred by userB
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          userC.address,
          0,
          0,
          POSITION,
          COLLATERAL.mul(2),
          false,
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
        claimable: expectedClaimable,
      })
      await expect(market.connect(userB).claimFee(userB.address))
        .to.emit(market, 'FeeClaimed')
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
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          userB.address,
          POSITION,
          0,
          0,
          COLLATERAL,
          false,
          user.address,
        )
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
        claimable: expectedClaimable,
      })
      await expect(market.connect(user).claimFee(user.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, user.address, expectedClaimable)
    })

    it('handles referral fee for multiple orders', async () => {
      const { user, userB, userC, userD } = instanceVars

      // user creates a maker position order referred by userB
      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          user.address,
          POSITION.mul(2),
          0,
          0,
          COLLATERAL.mul(2),
          false,
          userB.address,
        )
      // userC creates a long position referred by user
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          userC.address,
          0,
          POSITION,
          0,
          COLLATERAL.mul(2),
          false,
          user.address,
        )
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
        claimable: expectedClaimableMakerReferral,
      })
      await expect(market.connect(userB).claimFee(userB.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(userB.address, userB.address, expectedClaimableMakerReferral)

      // user should be able to claim the taker referral fee at the user rate
      // takerFee = position * takerFee * price = 3 * 0.025 * 113.882975 = 8.541223
      // referralFee = takerFee * referral / takerPos =  8.541223 * 0.45 / 3 = 1.281183
      let expectedClaimableTakerReferral = parse6decimal('1.281183')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: parse6decimal('1071.540000'),
        claimable: expectedClaimableTakerReferral,
      })

      // userD creates a short position referred by user
      await market
        .connect(userD)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          userD.address,
          0,
          0,
          POSITION.mul(2).div(3),
          COLLATERAL,
          false,
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
      await expect(market.connect(user).claimFee(user.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, user.address, expectedClaimableTakerReferral)
    })

    it('allows for a new referrer on new orders', async () => {
      const { user, userB, userC } = instanceVars

      // user creates a non-referred maker position to facilitate a taker order
      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          user.address,
          POSITION.mul(2),
          0,
          0,
          COLLATERAL.mul(2),
          false,
        )

      // userC creates a short position referred by userB
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          userC.address,
          0,
          0,
          POSITION,
          COLLATERAL.mul(2),
          false,
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
        claimable: expectedClaimable,
      })
      await expect(market.connect(userB).claimFee(userB.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(userB.address, userB.address, expectedClaimable)

      // userC closes a short position referred by user
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](userC.address, 0, 0, 0, 0, false, user.address)

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
        collateral: '1150119246',
        claimable: expectedCloseClaimable,
      })
      await expect(market.connect(user).claimFee(user.address))
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, user.address, expectedCloseClaimable)
      expect(await market.orderReferrers(userC.address, currentId.add(1))).to.equal(user.address)

      await nextWithConstantPrice()
      // userC opens a short position referred by no one
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, 0, false)
      await nextWithConstantPrice()
      expect(await market.orderReferrers(userC.address, currentId.add(2))).to.equal(constants.AddressZero)
    })
  })

  describe('claim fee', async () => {
    it('claim protocol, risk and oracle fee', async () => {
      const COLLATERAL = parse6decimal('600')
      const POSITION = parse6decimal('3')
      const { owner, oracle, coordinator, user, dsu } = instanceVars
      await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))

      await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](
          user.address,
          POSITION,
          0,
          0,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      expectOrderEq(await market.pendingOrder(1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        makerPos: POSITION,
        collateral: COLLATERAL,
      })
      await nextWithConstantPrice()
      await settle(market, user)

      const expectedProtocolFee = parse6decimal('16.809150')
      const expectedOracleFee = parse6decimal('16.809126')
      const expectedRiskFee = parse6decimal('22.412147')

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
  })

  describe('intent order fee exclusion', async () => {
    it('opens long position and another intent order and settles later with fee', async () => {
      const { owner, user, userB, userC, userD, marketFactory, dsu, chainlink } = instanceVars

      // userC allowed to interact with user's account
      await marketFactory.connect(user).updateOperator(userC.address, true)

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

      await dsu.connect(userD).approve(market.address, COLLATERAL.mul(1e12))

      await market
        .connect(userD)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userD.address, 0, POSITION, 0, COLLATERAL, false)

      const intent = {
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
        notional: POSITION.div(2).mul(PRICE.add(2)).div(1e6), // loss of precision
        longPos: POSITION.div(2),
        orderReferral: parse6decimal('1.0'),
        solverReferral: parse6decimal('0.5'),
      })
      expectOrderEq(await market.pending(), {
        ...DEFAULT_ORDER,
        orders: 4,
        collateral: COLLATERAL.mul(4),
        makerPos: POSITION,
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

      const EXPECTED_PNL = POSITION.div(2).mul(PRICE.add(2).sub(PRICE_1)).div(1e6) // position * price change
      const TRADE_FEE_A = parse6decimal('14.224562') // position * (0.025) * price_1

      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(EXPECTED_PNL).sub(TRADE_FEE_A).sub(3), // loss of precision
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        long: POSITION.div(2),
      })
      expectOrderEq(await market.pendingOrders(user.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        longPos: POSITION.div(2),
        takerReferral: POSITION.div(2).mul(2).div(10),
        collateral: COLLATERAL,
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
        collateral: COLLATERAL.add(EXPECTED_PNL),
        claimable: TRADE_FEE_A.div(10).add(1), // loss of precision
      })
      expectPositionEq(await market.positions(userC.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        short: POSITION.div(2),
      })
      expectOrderEq(await market.pendingOrders(userC.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        shortPos: POSITION.div(2),
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userC.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
      })

      const TRADE_FEE_D = parse6decimal('28.449124') // position * (0.025) * price_1
      const TAKER_LINEAR_FEE = parse6decimal('56.898249') // position * 0.05 * price_1
      const TAKER_PROPORITIONAL_FEE = parse6decimal('682.778988') // position * position / scale * 0.06 * price_1
      const TAKER_ADIABATIC_FEE = parse6decimal('796.575485') // position * 0.14 * price_1 * change in position / scale
      expectLocalEq(await market.locals(userD.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: COLLATERAL.sub(TRADE_FEE_D)
          .sub(TAKER_LINEAR_FEE)
          .sub(TAKER_PROPORITIONAL_FEE)
          .sub(TAKER_ADIABATIC_FEE)
          .sub(14), // loss of precision
      })
      expectPositionEq(await market.positions(userD.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        long: POSITION,
      })
      expectOrderEq(await market.pendingOrders(userD.address, 1), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_1,
        orders: 1,
        longPos: POSITION,
        collateral: COLLATERAL,
      })
      expectCheckpointEq(await market.checkpoints(userD.address, TIMESTAMP_2), {
        ...DEFAULT_CHECKPOINT,
      })
    })
  })
})
