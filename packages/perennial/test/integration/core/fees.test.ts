import { expect } from 'chai'
import 'hardhat'
import { BigNumber } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle } from '../helpers/setupHelpers'
import {
  DEFAULT_POSITION,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  parse6decimal,
} from '../../../../common/testutil/types'
import { Market } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  AccountPositionProcessedEventObject,
  PositionProcessedEventObject,
} from '../../../types/generated/contracts/Market'

export const PRICE = parse6decimal('3374.655169')
export const TIMESTAMP_0 = 1631112429
export const TIMESTAMP_1 = 1631112904
export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631115371
export const TIMESTAMP_5 = 1631118731

const RISK_PARAMS = {
  takerFee: parse6decimal('0.05'),
  takerSkewFee: parse6decimal('0.06'),
  takerImpactFee: parse6decimal('0.07'),
  makerFee: parse6decimal('0.09'),
  makerImpactFee: parse6decimal('0.08'),
  utilizationCurve: {
    minRate: 0,
    maxRate: 0,
    targetRate: 0,
    targetUtilization: 0,
  },
  pController: {
    k: BigNumber.from('1099511627775'),
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

  beforeEach(async () => {
    instanceVars = await loadFixture(fixture)
    await instanceVars.chainlink.reset()
    market = await createMarket(instanceVars, undefined, undefined, RISK_PARAMS, MARKET_PARAMS)
  })

  describe('position fees', () => {
    it('charges make fees on open', async () => {
      const POSITION = parse6decimal('0.0001')
      const COLLATERAL = parse6decimal('1000')
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

      await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false)

      // Settle the market with a new oracle version
      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const expectedMakerFee = BigNumber.from('11388297') // = 3374.655169**2 * 0.0001 * (0.09 - 0.08)

      expect(accountProcessEvent?.accumulationResult.positionFee).to.equal(expectedMakerFee)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedMakerFee),
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
      const expectedProtocolFee = BigNumber.from('5694148') // = 11388297 * 1 * 0.5 (no existing makers to all fees go to protocol/market)
      const expectedOracleFee = BigNumber.from('1708244') // = (11388297 - 5694148) * 0.3
      const expectedRiskFee = BigNumber.from('2277659') // = (11388297 - 5694148) * 0.4
      const expectedDonation = BigNumber.from('1708246') // = 11388297 - 5694148 - 1708244 - 2277659
      expectGlobalEq(await market.global(), {
        currentId: 2,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
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

    it('charges make fees on close', async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({ ...riskParams, makerFee: BigNumber.from('0') })
      const POSITION = parse6decimal('0.0001')
      const COLLATERAL = parse6decimal('1000')
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

      await expect(market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, user)

      await market.updateRiskParameter(riskParams)
      await market.connect(user).update(user.address, 0, 0, 0, 0, false)

      // Settle the market with a new oracle version
      await nextWithConstantPrice()
      const tx = await settle(market, user)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const expectedMakerFee = BigNumber.from('193601057') // = 3374.655169**2 * 0.0001 * (0.09 + 0.08)

      expect(accountProcessEvent?.accumulationResult.positionFee).to.equal(expectedMakerFee)

      // check user state
      expectLocalEq(await market.locals(user.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedMakerFee.div(2)), // Maker gets part of their fee refunded since they were an exisiting maker
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(user.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        delta: COLLATERAL,
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
      })
      expectPositionEq(await market.pendingPosition(3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })
    })

    it('charges take fees on long open', async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({ ...riskParams, makerFee: BigNumber.from('0') })

      const MAKER_POSITION = parse6decimal('0.0001')
      const LONG_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(userB.address, TIMESTAMP_1, 0, LONG_POSITION, 0, COLLATERAL, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedPositionFee = BigNumber.from('20498935') // = 3374.655169**2 * 0.00001 * (0.05 + 0.06 + 0.07)
      expect(accountProcessEventLong.accumulationResult.positionFee).to.eq(expectedPositionFee)

      const expectedProtocolFee = BigNumber.from('10249467') // = PositionFee / 2
      const expectedOracleFee = BigNumber.from('3074840') // = (20498935 - 10249467) * 0.3
      const expectedRiskFee = BigNumber.from('4099787') // = (20498935 - 10249467) * 0.4
      const expectedDonation = BigNumber.from('3074841') // = 20498935 - 10249467 - 3074840 - 4099787

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 2,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
      })
      expectPositionEq(await market.pendingPosition(2), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
        long: LONG_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: MAKER_POSITION,
        long: LONG_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedPositionFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(userB.address, 2), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        long: LONG_POSITION,
        delta: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        long: LONG_POSITION,
      })
    })

    it('charges take fees on long open, distributes to existing makes', async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({ ...riskParams, makerFee: BigNumber.from('0') })

      const MAKER_POSITION = parse6decimal('0.0001')
      const LONG_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)

      // Settle maker to give them portion of fees
      await nextWithConstantPrice()
      await settle(market, user)

      await expect(market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(userB.address, TIMESTAMP_2, 0, LONG_POSITION, 0, COLLATERAL, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedPositionFee = BigNumber.from('20498935') // = 3374.655169**2 * 0.00001 * (0.05 + 0.06 + 0.07)
      expect(accountProcessEventLong.accumulationResult.positionFee).to.eq(expectedPositionFee)

      const expectedProtocolFee = BigNumber.from('5124733') // = PositionFee * 0.5 * 0.5
      const expectedOracleFee = BigNumber.from('1537420') // = (10249467 - 5124733) * 0.3
      const expectedRiskFee = BigNumber.from('2049893') // = (10249467 - 5124733) * 0.4
      const expectedDonation = BigNumber.from('1537421') // = 10249467 - 5124733 - 1537420 - 2049893

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
      })
      expectPositionEq(await market.pendingPosition(3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
        long: LONG_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
        long: LONG_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedPositionFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(userB.address, 2), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        long: LONG_POSITION,
        delta: COLLATERAL,
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

      const expectedMakerFee = BigNumber.from('10249468') // = 20498935 - Floor(20498935/2)
      expect(accountProcessEventMaker.accumulationResult.collateralAmount).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(user.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
        delta: COLLATERAL,
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
        makerFee: BigNumber.from('0'),
        takerFee: BigNumber.from('0'),
        takerImpactFee: BigNumber.from('0'),
        takerSkewFee: BigNumber.from('0'),
      })
      await market.updateParameter({
        ...marketParams,
        fundingFee: BigNumber.from('0'),
      })

      const MAKER_POSITION = parse6decimal('0.0001')
      const LONG_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(userB.address, TIMESTAMP_1, 0, LONG_POSITION, 0, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, userB)
      await settle(market, user)

      // Re-enable fees for close, disable skew and impact for ease of calculation
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: BigNumber.from('0'),
        takerImpactFee: BigNumber.from('0'),
        takerSkewFee: BigNumber.from('0'),
      })
      await market.connect(userB).update(userB.address, 0, 0, 0, 0, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)

      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedPositionFee = BigNumber.from('5694148') // = 3374.655169**2 * 0.00001 * 0.05
      expect(accountProcessEventLong.accumulationResult.positionFee).to.eq(expectedPositionFee)

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
      })
      expectPositionEq(await market.pendingPosition(3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedPositionFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(userB.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        delta: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      const txMaker = await settle(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = BigNumber.from('2847074') // = 5694148 - Floor(5694148/2)
      expect(accountProcessEventMaker.accumulationResult.collateralAmount).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(user.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
        delta: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })
    })

    it('charges take fees on short open', async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({ ...riskParams, makerFee: BigNumber.from('0') })

      const MAKER_POSITION = parse6decimal('0.0001')
      const SHORT_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(userB.address, TIMESTAMP_1, 0, 0, SHORT_POSITION, COLLATERAL, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedPositionFee = BigNumber.from('20498935') // = 3374.655169**2 * 0.00001 * (0.05 + 0.06 + 0.07)
      expect(accountProcessEventLong.accumulationResult.positionFee).to.eq(expectedPositionFee)

      const expectedProtocolFee = BigNumber.from('10249467') // = PositionFee / 2
      const expectedOracleFee = BigNumber.from('3074840') // = (20498935 - 10249467) * 0.3
      const expectedRiskFee = BigNumber.from('4099787') // = (20498935 - 10249467) * 0.4
      const expectedDonation = BigNumber.from('3074841') // = 20498935 - 10249467 - 3074840 - 4099787

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 2,
        latestId: 1,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
      })
      expectPositionEq(await market.pendingPosition(2), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
        short: SHORT_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        maker: MAKER_POSITION,
        short: SHORT_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedPositionFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(userB.address, 2), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        short: SHORT_POSITION,
        delta: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_1,
        short: SHORT_POSITION,
      })
    })

    it('charges take fees on short open, distributes to existing makes', async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({ ...riskParams, makerFee: BigNumber.from('0') })

      const MAKER_POSITION = parse6decimal('0.0001')
      const SHORT_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)

      // Settle maker to give them portion of fees
      await nextWithConstantPrice()
      await settle(market, user)

      await expect(market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(userB.address, TIMESTAMP_2, 0, 0, SHORT_POSITION, COLLATERAL, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)
      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      // 100% long so taker takes full skew and impact
      const expectedPositionFee = BigNumber.from('20498935') // = 3374.655169**2 * 0.00001 * (0.05 + 0.06 + 0.07)
      expect(accountProcessEventLong.accumulationResult.positionFee).to.eq(expectedPositionFee)

      const expectedProtocolFee = BigNumber.from('5124733') // = PositionFee * 0.5 * 0.5
      const expectedOracleFee = BigNumber.from('1537420') // = (10249467 - 5124733) * 0.3
      const expectedRiskFee = BigNumber.from('2049893') // = (10249467 - 5124733) * 0.4
      const expectedDonation = BigNumber.from('1537421') // = 10249467 - 5124733 - 1537420 - 2049893

      // Global State
      expectGlobalEq(await market.global(), {
        currentId: 3,
        latestId: 2,
        protocolFee: expectedProtocolFee,
        riskFee: expectedRiskFee,
        oracleFee: expectedOracleFee,
        donation: expectedDonation,
      })
      expectPositionEq(await market.pendingPosition(3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
        short: SHORT_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
        short: SHORT_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        currentId: 2,
        latestId: 1,
        collateral: COLLATERAL.sub(expectedPositionFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(userB.address, 2), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        short: SHORT_POSITION,
        delta: COLLATERAL,
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

      const expectedMakerFee = BigNumber.from('10249468') // = 20498935 - Floor(20498935/2)
      expect(accountProcessEventMaker.accumulationResult.collateralAmount).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(user.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
        delta: COLLATERAL,
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
        makerFee: BigNumber.from('0'),
        takerFee: BigNumber.from('0'),
        takerImpactFee: BigNumber.from('0'),
        takerSkewFee: BigNumber.from('0'),
      })
      await market.updateParameter({
        ...marketParams,
        fundingFee: BigNumber.from('0'),
      })

      const MAKER_POSITION = parse6decimal('0.0001')
      const SHORT_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')
      const { user, userB, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await expect(market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false))
        .to.emit(market, 'Updated')
        .withArgs(userB.address, TIMESTAMP_1, 0, 0, SHORT_POSITION, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, userB)
      await settle(market, user)

      // Re-enable fees for close, disable skew and impact for ease of calculation
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: BigNumber.from('0'),
        takerImpactFee: BigNumber.from('0'),
        takerSkewFee: BigNumber.from('0'),
      })
      await market.connect(userB).update(userB.address, 0, 0, 0, 0, false)

      await nextWithConstantPrice()
      const txLong = await settle(market, userB)

      const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedPositionFee = BigNumber.from('5694148') // = 3374.655169**2 * 0.00001 * 0.05
      expect(accountProcessEventLong.accumulationResult.positionFee).to.eq(expectedPositionFee)

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
      })
      expectPositionEq(await market.pendingPosition(3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
      })
      expectPositionEq(await market.position(), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })

      // Long State
      expectLocalEq(await market.locals(userB.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.sub(expectedPositionFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(userB.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        delta: COLLATERAL,
      })
      expectPositionEq(await market.positions(userB.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
      })

      const txMaker = await settle(market, user)
      const accountProcessEventMaker: AccountPositionProcessedEventObject = (await txMaker.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject

      const expectedMakerFee = BigNumber.from('2847074') // = 5694148 - Floor(5694148/2)
      expect(accountProcessEventMaker.accumulationResult.collateralAmount).to.equal(expectedMakerFee)

      // Maker State
      expectLocalEq(await market.locals(user.address), {
        currentId: 3,
        latestId: 2,
        collateral: COLLATERAL.add(expectedMakerFee),
        reward: 0,
        protection: 0,
      })
      expectPositionEq(await market.pendingPositions(user.address, 3), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_3,
        maker: MAKER_POSITION,
        delta: COLLATERAL,
      })
      expectPositionEq(await market.positions(user.address), {
        ...DEFAULT_POSITION,
        timestamp: TIMESTAMP_2,
        maker: MAKER_POSITION,
      })
    })

    describe('skew fee', () => {
      const MAKER_POSITION = parse6decimal('0.0001')
      const SHORT_POSITION = parse6decimal('0.00001')
      const LONG_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')

      beforeEach(async () => {
        const riskParams = await market.riskParameter()
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: BigNumber.from('0'),
          takerFee: BigNumber.from('0'),
          takerImpactFee: BigNumber.from('0'),
          takerSkewFee: parse6decimal('0.01'),
        })

        const { user, userB, userC, dsu } = instanceVars

        await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

        await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
        await nextWithConstantPrice()
        await settle(market, user)
      })

      it('charges skew fee for changing skew', async () => {
        const { userB, userC } = instanceVars

        // Bring skew from 0 to 100% -> total skew change of 100%
        await market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

        await nextWithConstantPrice()
        const txShort = await settle(market, userB)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await txShort.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await txShort.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortSkewFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        expect(accountProcessEventShort.accumulationResult.positionFee).to.equal(expectedShortSkewFee)
        expect(
          positionProcessEventShort.accumulationResult.positionFeeMaker.add(
            positionProcessEventShort.accumulationResult.positionFeeFee,
          ),
        ).to.equal(expectedShortSkewFee)

        // Bring skew from -100% to +50% -> total skew change of 150%
        await market.connect(userC).update(userC.address, 0, LONG_POSITION.mul(2), 0, COLLATERAL, false)

        await nextWithConstantPrice()
        const txLong = await settle(market, userC)
        const accountProcessEventLong: AccountPositionProcessedEventObject = (await txLong.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventLong: PositionProcessedEventObject = (await txLong.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedLongSkewFee = BigNumber.from('3416489') // = 3374.655169**2 * 0.00002 * 150% * 0.01
        expect(accountProcessEventLong.accumulationResult.positionFee).to.equal(expectedLongSkewFee)
        expect(
          positionProcessEventLong.accumulationResult.positionFeeMaker.add(
            positionProcessEventLong.accumulationResult.positionFeeFee,
          ),
        ).to.equal(expectedLongSkewFee)
      })
    })

    describe('impact fee', () => {
      const MAKER_POSITION = parse6decimal('0.0001')
      const SHORT_POSITION = parse6decimal('0.00001')
      const LONG_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')

      beforeEach(async () => {
        const riskParams = await market.riskParameter()
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: BigNumber.from('0'),
          takerFee: BigNumber.from('0'),
          takerImpactFee: parse6decimal('0.01'),
          takerSkewFee: BigNumber.from('0'),
        })

        const { user, userB, userC, dsu } = instanceVars

        await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

        await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
        await nextWithConstantPrice()
        await settle(market, user)
      })

      it('charges taker impact fee for changing skew (short)', async () => {
        const { userB } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

        await nextWithConstantPrice()
        const tx = await settle(market, userB)
        const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEvent: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortSkewFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        expect(accountProcessEvent.accumulationResult.positionFee).to.equal(expectedShortSkewFee)
        expect(
          positionProcessEvent.accumulationResult.positionFeeMaker.add(
            positionProcessEvent.accumulationResult.positionFeeFee,
          ),
        ).to.equal(expectedShortSkewFee)
      })

      it('charges taker impact fee for changing skew (long)', async () => {
        const { userB } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)

        await nextWithConstantPrice()
        const tx = await settle(market, userB)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortSkewFee = BigNumber.from('1138829') // = 3374.655169**2 * 0.00001 * 100% * 0.01
        expect(accountProcessEventShort.accumulationResult.positionFee).to.equal(expectedShortSkewFee)
        expect(
          positionProcessEventShort.accumulationResult.positionFeeMaker.add(
            positionProcessEventShort.accumulationResult.positionFeeFee,
          ),
        ).to.equal(expectedShortSkewFee)
      })

      it('refunds taker position fee for negative impact', async () => {
        const { userB, userC } = instanceVars

        // Bring skew from 0 to 100% -> total impact change of 100%
        await market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

        await nextWithConstantPrice()
        await settle(market, userB)

        // Enable position fee to test refund
        const riskParams = await market.riskParameter()
        await market.updateRiskParameter({
          ...riskParams,
          takerFee: parse6decimal('0.01'),
          takerImpactFee: parse6decimal('0.01'),
        })
        // Bring skew from -100% to 0% -> total impact change of -100%
        await market.connect(userC).update(userC.address, 0, LONG_POSITION, 0, COLLATERAL, false)

        await nextWithConstantPrice()
        const tx = await settle(market, userC)
        const accountProcessEventShort: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject
        const positionProcessEventShort: PositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'PositionProcessed',
        )?.args as unknown as PositionProcessedEventObject

        const expectedShortSkewFee = BigNumber.from('0') // The impact fee offsets the taker fee
        expect(accountProcessEventShort.accumulationResult.positionFee).to.equal(expectedShortSkewFee)
        expect(
          positionProcessEventShort.accumulationResult.positionFeeMaker.add(
            positionProcessEventShort.accumulationResult.positionFeeFee,
          ),
        ).to.equal(expectedShortSkewFee)
      })
    })

    describe('settlement fee', () => {
      const MAKER_POSITION = parse6decimal('0.0001')
      const SHORT_POSITION = parse6decimal('0.00001')
      const LONG_POSITION = parse6decimal('0.00001')
      const COLLATERAL = parse6decimal('1000')

      beforeEach(async () => {
        const riskParams = await market.riskParameter()
        const marketParams = await market.parameter()
        await market.updateRiskParameter({
          ...riskParams,
          makerFee: BigNumber.from('0'),
          takerFee: BigNumber.from('0'),
          takerImpactFee: parse6decimal('0.0'),
          takerSkewFee: BigNumber.from('0'),
        })

        const { user, userB, userC, dsu } = instanceVars

        await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
        await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

        await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
        await nextWithConstantPrice()
        await settle(market, user)

        await market.updateParameter({
          ...marketParams,
          settlementFee: parse6decimal('1.23'),
        })
      })

      it('charges settlement fee for maker', async () => {
        await market.connect(instanceVars.user).update(instanceVars.user.address, MAKER_POSITION.mul(2), 0, 0, 0, false)

        await nextWithConstantPrice()
        const tx = await settle(market, instanceVars.user)

        const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
          e => e.event === 'AccountPositionProcessed',
        )?.args as unknown as AccountPositionProcessedEventObject

        const expectedSettlementFee = parse6decimal('1.23')
        expect(accountProcessEvent.accumulationResult.keeper).to.equal(expectedSettlementFee)

        expectGlobalEq(await market.global(), {
          currentId: 3,
          latestId: 2,
          protocolFee: 0,
          riskFee: 0,
          oracleFee: expectedSettlementFee,
          donation: 0,
        })
      })

      it('charges settlement fee for taker', async () => {
        const { userB, userC } = instanceVars
        await market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)
        await market.connect(userC).update(userC.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

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
        expect(accountProcessEventB.accumulationResult.keeper).to.equal(expectedSettlementFee)
        expect(accountProcessEventC.accumulationResult.keeper).to.equal(expectedSettlementFee)

        expectGlobalEq(await market.global(), {
          currentId: 3,
          latestId: 2,
          protocolFee: 0,
          riskFee: 0,
          oracleFee: expectedSettlementFee.mul(2),
          donation: 0,
        })
      })
    })
  })

  describe('interest fee', () => {
    const MAKER_POSITION = parse6decimal('0.0001')
    const SHORT_POSITION = parse6decimal('0.00001')
    const LONG_POSITION = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: BigNumber.from('0'),
        takerFee: BigNumber.from('0'),
        takerImpactFee: parse6decimal('0'),
        takerSkewFee: BigNumber.from('0'),
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

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await nextWithConstantPrice()
      await settle(market, user)
    })

    it('charges interest fee for long position', async () => {
      const { userB } = instanceVars

      await market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const positionProcessEvent: PositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'PositionProcessed',
      )?.args as unknown as PositionProcessedEventObject

      const expectedInterest = BigNumber.from('6') // = 3374.655169**2 * 0.00001 * 0.01 * 186 seconds / 365 days
      const expectedInterestFee = BigNumber.from('1') // = 6 * .2
      expect(accountProcessEvent.accumulationResult.collateralAmount).to.equal(expectedInterest.mul(-1))
      expect(positionProcessEvent.accumulationResult.interestFee).to.equal(expectedInterestFee)
      expect(
        positionProcessEvent.accumulationResult.interestFee.add(positionProcessEvent.accumulationResult.interestMaker),
      ).to.equal(expectedInterest)
    })

    it('charges interest fee for short position', async () => {
      const { userB } = instanceVars

      await market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const positionProcessEvent: PositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'PositionProcessed',
      )?.args as unknown as PositionProcessedEventObject

      const expectedInterest = BigNumber.from('6') // = 3374.655169**2 * 0.00001 * 0.01 * 186 seconds / 365 days
      const expectedInterestFee = BigNumber.from('1') // = 6 * .2
      expect(accountProcessEvent.accumulationResult.collateralAmount).to.equal(expectedInterest.mul(-1))
      expect(positionProcessEvent.accumulationResult.interestFee).to.equal(expectedInterestFee)
      expect(
        positionProcessEvent.accumulationResult.interestFee.add(positionProcessEvent.accumulationResult.interestMaker),
      ).to.equal(expectedInterest)
    })
  })

  describe('funding fee', () => {
    const MAKER_POSITION = parse6decimal('0.0001')
    const SHORT_POSITION = parse6decimal('0.00001')
    const LONG_POSITION = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const riskParams = await market.riskParameter()
      await market.updateRiskParameter({
        ...riskParams,
        makerFee: BigNumber.from('0'),
        takerFee: BigNumber.from('0'),
        takerImpactFee: parse6decimal('0'),
        takerSkewFee: BigNumber.from('0'),
        pController: {
          k: parse6decimal('10'),
          max: parse6decimal('1.20'),
        },
      })

      const { user, userB, userC, dsu } = instanceVars

      await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
      await dsu.connect(userC).approve(market.address, COLLATERAL.mul(1e12))

      await market.connect(user).update(user.address, MAKER_POSITION, 0, 0, COLLATERAL, false)
      await nextWithConstantPrice()
      await settle(market, user)
    })

    it('charges funding fee for long position', async () => {
      const { userB } = instanceVars

      await market.connect(userB).update(userB.address, 0, LONG_POSITION, 0, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const positionProcessEvent: PositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'PositionProcessed',
      )?.args as unknown as PositionProcessedEventObject

      const expectedFunding = BigNumber.from('819')
      const expectedFundingFee = BigNumber.from('78') // = 819 * .1 - 3 (due to precision loss)
      expect(accountProcessEvent.accumulationResult.collateralAmount).to.equal(expectedFunding.mul(-1))
      expect(positionProcessEvent.accumulationResult.fundingFee).to.equal(expectedFundingFee)
      expect(
        positionProcessEvent.accumulationResult.fundingFee.add(positionProcessEvent.accumulationResult.fundingMaker),
      ).to.equal(expectedFunding)
    })

    it('charges funding fee for short position', async () => {
      const { userB } = instanceVars

      await market.connect(userB).update(userB.address, 0, 0, SHORT_POSITION, COLLATERAL, false)

      await nextWithConstantPrice()
      await settle(market, userB)

      await nextWithConstantPrice()
      await nextWithConstantPrice()
      await nextWithConstantPrice()

      const tx = await settle(market, userB)
      const accountProcessEvent: AccountPositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'AccountPositionProcessed',
      )?.args as unknown as AccountPositionProcessedEventObject
      const positionProcessEvent: PositionProcessedEventObject = (await tx.wait()).events?.find(
        e => e.event === 'PositionProcessed',
      )?.args as unknown as PositionProcessedEventObject

      const expectedFunding = BigNumber.from('819')
      const expectedFundingFee = BigNumber.from('78') // = // = 819 * .1 - 3 (due to precision loss)
      expect(accountProcessEvent.accumulationResult.collateralAmount).to.equal(expectedFunding.mul(-1))
      expect(positionProcessEvent.accumulationResult.fundingFee).to.equal(expectedFundingFee)
      expect(
        positionProcessEvent.accumulationResult.fundingFee.add(positionProcessEvent.accumulationResult.fundingMaker),
      ).to.equal(expectedFunding)
    })
  })
})
