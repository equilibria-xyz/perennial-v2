import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, ContractTransaction, utils } from 'ethers'
const { AddressZero } = constants

import { InstanceVars, deployProtocol, createMarket, settle, updateNoOp } from '../helpers/setupHelpers'
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
} from '../../../../common/testutil/types'
import { Market } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  AccountPositionProcessedEventObject,
  PositionProcessedEventObject,
} from '../../../types/generated/contracts/Market'

export const PRICE = utils.parseEther('3374.655169')
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
    adiabaticFee: 0,
    scale: parse6decimal('10'),
  },
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
  oracleFee: parse6decimal('0.3'),
  riskFee: parse6decimal('0.4'),
  positionFee: parse6decimal('0.5'),
}

describe('Fees', () => {
  let instanceVars: InstanceVars
  let market: Market

  const nextWithConstantPrice = async () => {
    return instanceVars.chainlink.nextWithPriceModification(() => PRICE)
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
      .map(e => e.args as AccountPositionProcessedEventObject)
    const positionProcessEvents: Array<PositionProcessedEventObject> = txEvents
      .filter(e => e.event === 'PositionProcessed')
      .map(e => e.args as PositionProcessedEventObject)
    return [accountProcessEvents, positionProcessEvents]
  }

  beforeEach(async () => {
    instanceVars = await loadFixture(fixture)
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
        .to.emit(market, 'Updated')
        .withArgs(user.address, user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false, constants.AddressZero)

      // Settle the market with a new oracle version
      await nextWithConstantPrice()
      const tx = await updateNoOp(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const expectedMakerLinear = parse6decimal('102.494680') // = 3374.655169**2 * 0.0001 * (0.09)
      const expectedMakerProportional = parse6decimal('91.106380') // = 3374.655169**2 * 0.0001 * (0.08)
      const expectedMakerAdiabatic = parse6decimal('0') // = 3374.655169**2 * 0.0001 * (-(1.0 + 0.0) / 2 * 0.0)

      expect(accountProcessEvent?.accumulationResult.linearFee).to.equal(expectedMakerLinear)
      expect(accountProcessEvent?.accumulationResult.proportionalFee).to.equal(expectedMakerProportional)
      expect(accountProcessEvent?.accumulationResult.adiabaticFee).to.equal(expectedMakerAdiabatic)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedMakerLinear).sub(expectedMakerProportional).sub(expectedMakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(user.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
      })
      expectCheckpointEq(await market.checkpoints(user.address, 2), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: POSITION,
      })

      // Check global post-settlement state
      const expectedProtocolFee = BigNumber.from('96800528') // = 193601057 * 1 * 0.5 (no existing makers so all fees go to protocol/market)
      const expectedOracleFee = BigNumber.from('29040158') // = (193601057 - 96800528) * 0.3
      const expectedRiskFee = BigNumber.from('38720211') // = (193601057 - 96800528) * 0.4
      const expectedDonation = BigNumber.from('29040160') // = 193601057 - 96800528 - 29040158 - 38720211
      expectGlobalEq(await market.global(), {
        currentId: 2,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
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

    it('charges make fees on close', async () => {
      const riskParams = { ...(await market.riskParameter()) }
      const previousRiskParams = { ...riskParams }
      const riskParamsMakerFee = { ...riskParams.makerFee }
      riskParamsMakerFee.linearFee = BigNumber.from('0')
      riskParamsMakerFee.proportionalFee = BigNumber.from('0')
      riskParamsMakerFee.adiabaticFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

      const POSITION = parse6decimal('10')
      const COLLATERAL = parse6decimal('1000')
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

      await expect(
        market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
      )
        .to.emit(market, 'Updated')
        .withArgs(user.address, user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false, constants.AddressZero)

      await nextWithConstantPrice()
      await settle(market, user)

      await market.updateRiskParameter(previousRiskParams)
      await market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

      // Settle the market with a new oracle version
      await nextWithConstantPrice()
      const tx = await updateNoOp(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const expectedMakerLinear = parse6decimal('102.494680') // = 3374.655169**2 * 0.0001 * (0.09)
      const expectedMakerProportional = parse6decimal('91.106380') // = 3374.655169**2 * 0.0001 * (0.08)
      const expectedMakerAdiabatic = BigNumber.from('0') // = 3374.655169**2 * 0.0001 * ((1.0 + 0.0) / 2 * 0)

      expect(accountProcessEvent?.accumulationResult.linearFee).to.equal(expectedMakerLinear)
      expect(accountProcessEvent?.accumulationResult.proportionalFee).to.equal(expectedMakerProportional)
      expect(accountProcessEvent?.accumulationResult.adiabaticFee).to.equal(expectedMakerAdiabatic)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.sub(
          expectedMakerLinear.add(expectedMakerProportional).div(2).add(expectedMakerAdiabatic),
        ).sub(10), // Maker gets part of their fee refunded since they were an exisiting maker
      })
      expectOrderEq(await market.pendingOrders(user.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(user.address, 3), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      // Check global post-settlement state. Existing makers so protocol only gets 50% of fees
      const expectedProtocolFee = BigNumber.from('48400264') // = 193601057/2 * 0.5
      const expectedOracleFee = BigNumber.from('14520079') // = (193601057/2 - 48400264) * 0.3
      const expectedRiskFee = BigNumber.from('19360105') // = (193601057/2 - 48400264) * 0.4
      const expectedDonation = BigNumber.from('14520080') // = 193601057/2 - 48400264 - 14520079 - 19360105
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: expectedMakerAdiabatic,
      })
      expectOrderEq(await market.pendingOrder(3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
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
      riskParamsMakerFee.adiabaticFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

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
        .to.emit(market, 'Updated')
        .withArgs(
          userB.address,
          userB.address,
          TIMESTAMP_1,
          0,
          LONG_POSITION,
          0,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const txLong = await updateNoOp(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedtakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedtakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedtakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.linearFee).to.eq(expectedtakerLinear)
      expect(accountProcessEventLong.accumulationResult.proportionalFee).to.eq(expectedtakerProportional)
      expect(accountProcessEventLong.accumulationResult.adiabaticFee).to.eq(expectedtakerAdiabatic)

      const expectedProtocolFee = BigNumber.from('6263563') // = applicable fee / 2
      const expectedOracleFee = BigNumber.from('1879068') // = (12527126 - 6263563) * 0.3
      const expectedRiskFee = BigNumber.from('2505425') // = (12527126 - 6263563) * 0.4
      const expectedDonation = BigNumber.from('1879070') // = 12527126 - 6263563 - 1879068 - 2505425

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 2,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
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
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedtakerLinear).sub(expectedtakerProportional).sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, 2), {
        ...DEFAULT_CHECKPOINT,
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
      riskParamsMakerFee.adiabaticFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

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
      await updateNoOp(market, user)

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
        .to.emit(market, 'Updated')
        .withArgs(
          userB.address,
          userB.address,
          TIMESTAMP_2,
          0,
          LONG_POSITION,
          0,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const txLong = await updateNoOp(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedtakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedtakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedtakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.linearFee).to.eq(expectedtakerLinear)
      expect(accountProcessEventLong.accumulationResult.proportionalFee).to.eq(expectedtakerProportional)
      expect(accountProcessEventLong.accumulationResult.adiabaticFee).to.eq(expectedtakerAdiabatic)

      const expectedProtocolFee = BigNumber.from('3131781') // = application fee * 0.5 * 0.5
      const expectedOracleFee = BigNumber.from('939534') // = (6263563 - 3131781) * 0.3
      const expectedRiskFee = BigNumber.from('1252712') // = (6263563 - 3131781) * 0.4
      const expectedDonation = BigNumber.from('939536') // = 6263563 - 3131781 - 939534 - 1252712

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
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
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedtakerLinear).sub(expectedtakerProportional).sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, 2), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: LONG_POSITION,
      })

      const txMaker = await updateNoOp(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = BigNumber.from('6263550') // = 12527126 - Floor(12527126/2)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(user.address, 3), {
        ...DEFAULT_CHECKPOINT,
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
          adiabaticFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market.updateParameter(AddressZero, AddressZero, {
        ...marketParams,
        fundingFee: BigNumber.from('0'),
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
        .to.emit(market, 'Updated')
        .withArgs(
          userB.address,
          userB.address,
          TIMESTAMP_1,
          0,
          LONG_POSITION,
          0,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await updateNoOp(market, userB)
      await updateNoOp(market, user)

      // Re-enable fees for close, disable skew and impact for ease of calculation
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false)

      await nextWithConstantPrice()
      const txLong = await updateNoOp(market, userB)

      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedtakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedtakerProportional = 0
      const expectedtakerAdiabatic = 0

      expect(accountProcessEventLong.accumulationResult.linearFee).to.eq(expectedtakerLinear)
      expect(accountProcessEventLong.accumulationResult.proportionalFee).to.eq(expectedtakerProportional)
      expect(accountProcessEventLong.accumulationResult.adiabaticFee).to.eq(expectedtakerAdiabatic)

      const expectedProtocolFee = BigNumber.from('1423537') // = 5694148 * 0.5 * 0.5
      const expectedOracleFee = BigNumber.from('427061') // = (2847074 - 1423537) * 0.3
      const expectedRiskFee = BigNumber.from('569414') // = (2847074 - 1423537) * 0.4
      const expectedDonation = BigNumber.from('427062') // = 2847074 - 1423537 - 427061 - 569414

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedtakerLinear).sub(expectedtakerProportional).sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, 3), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      const txMaker = await updateNoOp(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = BigNumber.from('2847070') // = 5694148 - Floor(5694148/2)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(user.address, 3), {
        ...DEFAULT_CHECKPOINT,
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
      riskParamsMakerFee.adiabaticFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

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
        .to.emit(market, 'Updated')
        .withArgs(
          userB.address,
          userB.address,
          TIMESTAMP_1,
          0,
          0,
          SHORT_POSITION,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const txLong = await updateNoOp(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedtakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedtakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedtakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.linearFee).to.eq(expectedtakerLinear)
      expect(accountProcessEventLong.accumulationResult.proportionalFee).to.eq(expectedtakerProportional)
      expect(accountProcessEventLong.accumulationResult.adiabaticFee).to.eq(expectedtakerAdiabatic)

      const expectedProtocolFee = BigNumber.from('6263563') // = applicable fee / 2
      const expectedOracleFee = BigNumber.from('1879068') // = (12527126 - 6263563) * 0.3
      const expectedRiskFee = BigNumber.from('2505425') // = (12527126 - 6263563) * 0.4
      const expectedDonation = BigNumber.from('1879070') // = 12527126 - 6263563 - 1879068 - 2505425

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 2,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
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
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedtakerLinear).sub(expectedtakerProportional).sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_2,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, 2), {
        ...DEFAULT_CHECKPOINT,
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
      riskParamsMakerFee.adiabaticFee = BigNumber.from('0')
      riskParams.makerFee = riskParamsMakerFee
      await market.updateRiskParameter(riskParams)

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
      await updateNoOp(market, user)

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
        .to.emit(market, 'Updated')
        .withArgs(
          userB.address,
          userB.address,
          TIMESTAMP_2,
          0,
          0,
          SHORT_POSITION,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      const txLong = await updateNoOp(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedtakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedtakerProportional = parse6decimal('6.832978') // = 3374.655169**2 * 0.00001 * (0.06)
      const expectedtakerAdiabatic = parse6decimal('7.971808') // = 3374.655169**2 * 0.00001 * (0.07)

      expect(accountProcessEventLong.accumulationResult.linearFee).to.eq(expectedtakerLinear)
      expect(accountProcessEventLong.accumulationResult.proportionalFee).to.eq(expectedtakerProportional)
      expect(accountProcessEventLong.accumulationResult.adiabaticFee).to.eq(expectedtakerAdiabatic)

      const expectedProtocolFee = BigNumber.from('3131781') // = application fee * 0.5 * 0.5
      const expectedOracleFee = BigNumber.from('939534') // = (6263563 - 3131781) * 0.3
      const expectedRiskFee = BigNumber.from('1252712') // = (6263563 - 3131781) * 0.4
      const expectedDonation = BigNumber.from('939536') // = 6263563 - 3131781 - 939534 - 1252712

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
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
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedtakerLinear).sub(expectedtakerProportional).sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 2), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, 2), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        short: SHORT_POSITION,
      })

      const txMaker = await updateNoOp(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = BigNumber.from('6263550') // = 12527126 - Floor(12527126/2)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(user.address, 3), {
        ...DEFAULT_CHECKPOINT,
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
          adiabaticFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market.updateParameter(AddressZero, AddressZero, {
        ...marketParams,
        fundingFee: BigNumber.from('0'),
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
        .to.emit(market, 'Updated')
        .withArgs(
          userB.address,
          userB.address,
          TIMESTAMP_1,
          0,
          0,
          SHORT_POSITION,
          COLLATERAL,
          false,
          constants.AddressZero,
        )

      await nextWithConstantPrice()
      await updateNoOp(market, userB)
      await updateNoOp(market, user)

      // Re-enable fees for close, disable skew and impact for ease of calculation
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: {
          ...riskParams.makerFee,
          linearFee: BigNumber.from('0'),
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
        takerFee: {
          ...riskParams.takerFee,
          proportionalFee: BigNumber.from('0'),
          adiabaticFee: BigNumber.from('0'),
        },
      })
      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false)

      await nextWithConstantPrice()
      const txLong = await updateNoOp(market, userB)

      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedtakerLinear = parse6decimal('5.694148') // = 3374.655169**2 * 0.00001 * (0.05)
      const expectedtakerProportional = 0
      const expectedtakerAdiabatic = 0

      expect(accountProcessEventLong.accumulationResult.linearFee).to.eq(expectedtakerLinear)
      expect(accountProcessEventLong.accumulationResult.proportionalFee).to.eq(expectedtakerProportional)
      expect(accountProcessEventLong.accumulationResult.adiabaticFee).to.eq(expectedtakerAdiabatic)

      const expectedProtocolFee = BigNumber.from('1423537') // = 5694148 * 0.5 * 0.5
      const expectedOracleFee = BigNumber.from('427061') // = (2847074 - 1423537) * 0.3
      const expectedRiskFee = BigNumber.from('569414') // = (2847074 - 1423537) * 0.4
      const expectedDonation = BigNumber.from('427062') // = 2847074 - 1423537 - 427061 - 569414

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
        exposure: 0,
      })
      expectOrderEq(await market.pendingOrder(3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedtakerLinear).sub(expectedtakerProportional).sub(expectedtakerAdiabatic),
      })
      expectOrderEq(await market.pendingOrders(userB.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(userB.address, 3), {
        ...DEFAULT_CHECKPOINT,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      const txMaker = await updateNoOp(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = BigNumber.from('2847070') // = 5694148 - Floor(5694148/2)
      expect(accountProcessEventMaker.accumulationResult.collateral).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
      })
      expectOrderEq(await market.pendingOrders(user.address, 3), {
        ...DEFAULT_ORDER,
        timestamp: TIMESTAMP_3,
      })
      expectCheckpointEq(await market.checkpoints(user.address, 3), {
        ...DEFAULT_CHECKPOINT,
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
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: {
            ...riskParams.makerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
            adiabaticFee: BigNumber.from('0'),
          },
          takerFee: {
            ...riskParams.takerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: parse6decimal('0.01'),
            adiabaticFee: BigNumber.from('0'),
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
        expect(accountProcessEventShort.accumulationResult.proportionalFee).to.equal(expectedShortProportionalFee)
        expect(
          positionProcessEventShort.accumulationResult.positionFeeMaker.add(
            positionProcessEventShort.accumulationResult.positionFeeProtocol,
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

        expect(accountProcessEventLong.accumulationResult.proportionalFee).to.within(
          expectedLongProportionalFee,
          expectedLongProportionalFee.add(10),
        )
        expect(
          positionProcessEventLong.accumulationResult.positionFeeMaker.add(
            positionProcessEventLong.accumulationResult.positionFeeProtocol,
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
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: {
            ...riskParams.makerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
            adiabaticFee: BigNumber.from('0'),
          },
          takerFee: {
            ...riskParams.takerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
            adiabaticFee: parse6decimal('0.02'),
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
        expect(accountProcessEvent.accumulationResult.adiabaticFee).to.equal(expectedShortAdiabaticFee)
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
        expect(accountProcessEventShort.accumulationResult.adiabaticFee).to.equal(expectedShortAdiabaticFee)
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

        const expectedShortAdiabaticFee = BigNumber.from('-1138829') // = 3374.655169**2 * -0.00001 * 100% * 0.01
        expect(accountProcessEventShort.accumulationResult.adiabaticFee).to.equal(expectedShortAdiabaticFee)
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

        const expectedShortAdiabaticFee = BigNumber.from('-2277659') // = 3374.655169**2 *-0.00001 * 100% * 0.02
        expect(accountProcessEventShort.accumulationResult.adiabaticFee).to.equal(expectedShortAdiabaticFee)
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
            adiabaticFee: BigNumber.from('0'),
          },
          takerFee: {
            ...riskParams.takerFee,
            linearFee: BigNumber.from('0'),
            proportionalFee: BigNumber.from('0'),
            adiabaticFee: BigNumber.from('0'),
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

        await market.updateParameter(AddressZero, AddressZero, {
          ...marketParams,
          settlementFee: parse6decimal('1.23'),
        })
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
        const tx = await updateNoOp(market, instanceVars.user)

        const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject

        const expectedSettlementFee = parse6decimal('1.23')
        expect(accountProcessEvent.accumulationResult.settlementFee).to.equal(expectedSettlementFee)

        expectGlobalEq(await market.global(), {
          currentId: 3,
          latestId: 2,
          protocolFee: 0,
          riskFee: 0,
          oracleFee: expectedSettlementFee,
          donation: 0,
          exposure: 0,
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
          currentId: 2,
          latestId: 2,
          protocolFee: 0,
          riskFee: 0,
          oracleFee: expectedSettlementFee,
          donation: 0,
          exposure: 0,
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
          adiabaticFee: BigNumber.from('0'),
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
          adiabaticFee: BigNumber.from('0'),
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
      const { user, userB } = instanceVars

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
      // makerFeeLinear = position * linearFee * price = 3 * 0.09 * 113.882975 = 30.748403
      // referralFee = makerFeeLinear * referral / makerPos =  30.748403 * 0.45 / 3 = 4.612260
      const expectedClaimable = parse6decimal('4.612260')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        claimable: expectedClaimable,
      })
      await expect(market.connect(user).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, expectedClaimable)
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
      // takerFeeLinear = position * linearFee * price = 3 * 0.05 * 113.882975 = 17.082446
      // referralFee = takerFeeLinear * referral / takerPos =  17.082446 * 0.36 / 3 = 2.049893
      const expectedClaimable = parse6decimal('2.049893')
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        claimable: expectedClaimable,
      })
      await expect(market.connect(userB).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(userB.address, expectedClaimable)
    })

    it('handles a change in user referral fee', async () => {
      const { owner, user, userB, marketFactory } = instanceVars

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
      // makerFeeLinear = position * linearFee * price = 3 * 0.09 * 113.882975 = 30.748403
      // referralFee = makerFeeLinear * referral / makerPos =  30.748403 * 0.51 / 3 = 5.227228
      const expectedClaimable = parse6decimal('5.227228')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        claimable: expectedClaimable,
      })
      await expect(market.connect(user).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, expectedClaimable)
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
      // makerFeeLinear = position * linearFee * price = 6 * 0.09 * 113.882975 = 61.496806
      // referralFee = makerFeeLinear * referral / makerPos = 61.496806 * 0.72 / 6 = 7.379616
      const expectedClaimableMakerReferral = parse6decimal('7.379616')
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        claimable: expectedClaimableMakerReferral,
      })
      await expect(market.connect(userB).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(userB.address, expectedClaimableMakerReferral)

      // user should be able to claim the taker referral fee at the user rate
      // takerFeeLinear = position * linearFee * price = 3 * 0.05 * 113.882975 = 17.082446
      // referralFee = takerFeeLinear * referral / takerPos =  17.082446 * 0.45 / 3 = 2.562367
      let expectedClaimableTakerReferral = parse6decimal('2.562367')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 1,
        collateral: parse6decimal('1105.704894'),
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
      // takerFeeLinear = position * linearFee * price = 2 * 0.05 * 113.882975 = 11.388297
      // referralFee = takerFeeLinear * referral / takerPos =  11.388297 * 0.30 / 2 = 1.70824455
      expectedClaimableTakerReferral = expectedClaimableTakerReferral.add(parse6decimal('1.70824455'))
      await expect(market.connect(user).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, expectedClaimableTakerReferral)
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
      await settle(market, userC)
      expect(await market.referrers(userC.address, currentId)).to.equal(userB.address)
      expect((await market.locals(userC.address)).currentId).to.equal(currentId.add(1))

      // ensure the proper amount of the base fee is claimable by the referrer
      // takerFeeLinear = position * linearFee * price = 3 * 0.05 * 113.882975 = 17.082446
      // referralFee = takerFeeLinear * referral / takerPos =  17.082446 * 0.36 / 3 = 2.049893
      const expectedClaimable = parse6decimal('2.049893')
      expectLocalEq(await market.locals(userB.address), {
        ...DEFAULT_LOCAL,
        currentId: 1,
        latestId: 0,
        claimable: expectedClaimable,
      })
      await expect(market.connect(userB).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(userB.address, expectedClaimable)

      // userC closes a short position referred by user
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](userC.address, 0, 0, 0, 0, false, user.address)

      await nextWithConstantPrice()
      await settle(market, user)
      await settle(market, userB)
      await settle(market, userC)

      // ensure the proper amount of the base fee is claimable by the referrer
      // takerFeeLinear = position * linearFee * price = 3 * 0.05 * 113.882975 = 17.082446
      // referralFee = takerFeeLinear * referral / takerPos =  17.082446 * 0.45 / 3 = 2.562367
      const expectedCloseClaimable = parse6decimal('2.562367')
      expectLocalEq(await market.locals(user.address), {
        ...DEFAULT_LOCAL,
        currentId: 3,
        latestId: 2,
        collateral: '1220242686',
        claimable: expectedCloseClaimable,
      })
      await expect(market.connect(user).claimFee())
        .to.emit(market, 'FeeClaimed')
        .withArgs(user.address, expectedCloseClaimable)
      expect(await market.referrers(userC.address, currentId.add(1))).to.equal(user.address)

      await nextWithConstantPrice()
      // userC opens a short position referred by no one
      await market
        .connect(userC)
        ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, 0, false)
      await nextWithConstantPrice()
      expect(await market.referrers(userC.address, currentId.add(2))).to.equal(constants.AddressZero)
    })
  })
})
