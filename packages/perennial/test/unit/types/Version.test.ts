import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { VersionTester, VersionTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { DEFAULT_ORDER, parse6decimal } from '../../../../common/testutil/types'
import {
  GlobalStruct,
  MarketParameterStruct,
  OrderStruct,
  PositionStruct,
  RiskParameterStruct,
  VersionStruct,
} from '../../../types/generated/contracts/Market'
import { OracleVersionStruct } from '../../../types/generated/contracts/interfaces/IOracleProvider'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { VALID_RISK_PARAMETER } from './RiskParameter.test'

const { ethers } = HRE
use(smock.matchers)

const VALID_VERSION: VersionStruct = {
  valid: true,
  makerValue: { _value: 1 },
  longValue: { _value: 2 },
  shortValue: { _value: 3 },
  makerPosFee: { _value: 4 },
  makerNegFee: { _value: 5 },
  takerPosFee: { _value: 6 },
  takerNegFee: { _value: 7 },
  settlementFee: { _value: -8 },
}

const EMPTY_VERSION: VersionStruct = {
  valid: true,
  makerValue: { _value: 0 },
  longValue: { _value: 0 },
  shortValue: { _value: 0 },
  makerNegFee: { _value: 0 },
  makerPosFee: { _value: 0 },
  takerNegFee: { _value: 0 },
  takerPosFee: { _value: 0 },
  settlementFee: { _value: 0 },
}

const GLOBAL: GlobalStruct = {
  currentId: 1,
  latestId: 8,
  protocolFee: 2,
  oracleFee: 3,
  riskFee: 4,
  donation: 5,
  pAccumulator: {
    _value: 6,
    _skew: 7,
  },
  latestPrice: 8,
}

const FROM_POSITION: PositionStruct = {
  timestamp: 2,
  maker: 3,
  long: 4,
  short: 5,
}

const ORDER: OrderStruct = {
  timestamp: 20,
  orders: 4,
  collateral: 1000,
  makerPos: 30,
  makerNeg: 3,
  longPos: 36,
  longNeg: 0,
  shortPos: 45,
  shortNeg: 0,
}

const TIMESTAMP = 1636401093
const PRICE = parse6decimal('123')

const ORACLE_VERSION_1: OracleVersionStruct = {
  price: PRICE,
  timestamp: TIMESTAMP,
  valid: true,
}

const ORACLE_VERSION_2: OracleVersionStruct = {
  price: PRICE,
  timestamp: TIMESTAMP + 3600,
  valid: true,
}

describe('Version', () => {
  let owner: SignerWithAddress
  let version: VersionTester

  const accumulateWithReturn = async (
    global: GlobalStruct,
    fromPosition: PositionStruct,
    order: OrderStruct,
    fromOracleVersion: OracleVersionStruct,
    toOracleVersion: OracleVersionStruct,
    marketParameter: MarketParameterStruct,
    riskParameter: RiskParameterStruct,
  ) => {
    const ret = await version.callStatic.accumulate(
      global,
      fromPosition,
      order,
      fromOracleVersion,
      toOracleVersion,
      marketParameter,
      riskParameter,
    )
    await version.accumulate(
      global,
      fromPosition,
      order,
      fromOracleVersion,
      toOracleVersion,
      marketParameter,
      riskParameter,
    )

    const value = await version.read()
    return { ret, value }
  }

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    version = await new VersionTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await version.store(VALID_VERSION)

      const value = await version.read()
      expect(value.valid).to.equal(true)
      expect(value.makerValue._value).to.equal(1)
      expect(value.longValue._value).to.equal(2)
      expect(value.shortValue._value).to.equal(3)
      expect(value.makerPosFee._value).to.equal(4)
      expect(value.makerNegFee._value).to.equal(5)
      expect(value.takerPosFee._value).to.equal(6)
      expect(value.takerNegFee._value).to.equal(7)
      expect(value.settlementFee._value).to.equal(-8)
    })

    describe('.valid', async () => {
      it('saves', async () => {
        await version.store({
          ...VALID_VERSION,
          valid: true,
        })
        const value = await version.read()
        expect(value.valid).to.equal(true)
      })
    })

    describe('.makerValue', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.longValue', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          longValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.longValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          longValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.longValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.shortValue', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.shortValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.shortValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.makerPosFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerPosFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerPosFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.makerNegFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerNegFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerNegFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.takerPosFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.takerPosFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.takerPosFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.takerNegFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.takerNegFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.takerNegFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.settlementFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          settlementFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.settlementFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          settlementFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.settlementFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            settlementFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            settlementFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })
  })

  describe('#accumulate', () => {
    context('market closed', () => {
      it('only accumulates fee', async () => {
        await version.store(VALID_VERSION)

        const ret = await version.callStatic.accumulate(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('10'), short: parse6decimal('10'), maker: parse6decimal('10') },
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          ORACLE_VERSION_1,
          ORACLE_VERSION_2,
          { ...VALID_MARKET_PARAMETER, settlementFee: parse6decimal('2'), closed: true },
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              linearFee: parse6decimal('0.1'),
              proportionalFee: parse6decimal('0.2'),
              adiabaticFee: parse6decimal('0.3'),
              scale: parse6decimal('100'),
            },
          },
        )
        await version.accumulate(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('10'), short: parse6decimal('10'), maker: parse6decimal('10') },
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          ORACLE_VERSION_1,
          ORACLE_VERSION_2,
          { ...VALID_MARKET_PARAMETER, settlementFee: parse6decimal('2'), closed: true },
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              linearFee: parse6decimal('0.1'),
              proportionalFee: parse6decimal('0.2'),
              adiabaticFee: parse6decimal('0.3'),
              scale: parse6decimal('100'),
            },
          },
        )

        const value = await version.read()

        expect(value.valid).to.be.true
        expect(value.makerValue._value).to.equal(BigNumber.from('14759956'))
        expect(value.longValue._value).to.equal(2)
        expect(value.shortValue._value).to.equal(3)

        expect(ret.fees.marketFee).to.equal(BigNumber.from('442'))

        expect(ret[0].positionFee).to.equal(BigNumber.from('147600000'))
        expect(ret[0].positionFeeMaker).to.equal(BigNumber.from('147599558'))
        expect(ret[0].positionFeeProtocol).to.equal(BigNumber.from('442'))
        expect(ret[0].positionFeeExposure).to.equal(0)
        expect(ret[0].positionFeeExposureMaker).to.equal(0)
        expect(ret[0].positionFeeExposureProtocol).to.equal(0)
        expect(ret[0].positionFeeImpact).to.equal(BigNumber.from('18450000'))
        expect(ret[0].fundingMaker).to.equal(0)
        expect(ret[0].fundingLong).to.equal(0)
        expect(ret[0].fundingShort).to.equal(0)
        expect(ret[0].fundingFee).to.equal(0)
        expect(ret[0].interestMaker).to.equal(0)
        expect(ret[0].interestLong).to.equal(0)
        expect(ret[0].interestShort).to.equal(0)
        expect(ret[0].interestFee).to.equal(0)
        expect(ret[0].pnlMaker).to.equal(0)
        expect(ret[0].pnlLong).to.equal(0)
        expect(ret[0].pnlShort).to.equal(0)
        expect(ret[0].settlementFee).to.equal(parse6decimal('2'))
      })
    })

    describe('.valid', () => {
      context('invalid toOracleVersion', () => {
        it('marks version invalid', async () => {
          await version.store(VALID_VERSION)
          await version.accumulate(
            GLOBAL,
            FROM_POSITION,
            ORDER,
            ORACLE_VERSION_1,
            { ...ORACLE_VERSION_2, valid: false },
            VALID_MARKET_PARAMETER,
            VALID_RISK_PARAMETER,
          )

          const value = await version.read()
          expect(value.valid).to.be.false
        })
      })

      context('valid toOracleVersion', () => {
        it('marks version valid', async () => {
          await version.store({ ...VALID_VERSION, valid: false })
          await version.accumulate(
            GLOBAL,
            FROM_POSITION,
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            VALID_MARKET_PARAMETER,
            VALID_RISK_PARAMETER,
          )

          const value = await version.read()
          expect(value.valid).to.be.true
        })
      })

      context('market closed, currently invalid, toOracleVersion.valid = true', () => {
        it('marks the version as valid', async () => {
          await version.store({ ...VALID_VERSION, valid: false })
          await version.accumulate(
            GLOBAL,
            FROM_POSITION,
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            { ...VALID_MARKET_PARAMETER, closed: true },
            VALID_RISK_PARAMETER,
          )

          const value = await version.read()
          expect(value.valid).to.be.true
        })
      })
    })

    describe('position fee accumulation', () => {
      it('allocates when no makers', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('20'), short: parse6decimal('30'), maker: 0 },
          {
            ...ORDER,
            makerNeg: parse6decimal('0'),
            makerPos: parse6decimal('10'),
            longPos: parse6decimal('30'),
            longNeg: parse6decimal('10'),
            shortPos: parse6decimal('50'),
            shortNeg: parse6decimal('20'),
          },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          { ...VALID_MARKET_PARAMETER },
          {
            ...VALID_RISK_PARAMETER,
            pController: { max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
            makerFee: {
              linearFee: parse6decimal('0.02'),
              proportionalFee: parse6decimal('0.10'),
              adiabaticFee: parse6decimal('0.20'),
              scale: parse6decimal('100'),
            },
            takerFee: {
              linearFee: parse6decimal('0.01'),
              proportionalFee: parse6decimal('0.05'),
              adiabaticFee: parse6decimal('0.10'),
              scale: parse6decimal('100'),
            },
          },
        )

        const takerExposure = parse6decimal('0.05') // 0 -> -10 / 100 = -5 / 100 = -0.05 * -10 * 0.1
        const makerExposure = parse6decimal('0.0') // 100 -> 100 / 100 = 199 / 100 = 1.0 * 0 * 0.2
        const exposure = takerExposure.add(makerExposure).mul(2) // price delta

        const fee1 = parse6decimal('1.75') // 50 * 0.01 + 50 * 0.025
        const fee2 = parse6decimal('2.4') // 60 * 0.01 + 60 * 0.03
        const fee3 = parse6decimal('0.0')
        const fee4 = parse6decimal('0.3') // 10 * 0.02 + 10 * 0.01
        const fee = fee1.add(fee2).add(fee3).add(fee4).mul(123) // price

        const impact1 = parse6decimal('.75') // -10 -> 40 / 100 = 15 / 100 = 0.15 * 50 * 0.1
        const impact2 = parse6decimal('-0.6') // 40 -> -20 / 100 = -10 / 100 = -0.1 * 60 * 0.1
        const impact3 = parse6decimal('0')
        const impact4 = parse6decimal('-1.9') // 100 -> 90 / 100 = -95 / 100 = -0.95 * 10 * 0.2
        const impact = impact1.add(impact2).add(impact3).add(impact4).mul(123) // price

        expect(value.makerValue._value).to.equal(1)
        expect(value.longValue._value).to.equal(parse6decimal('2').add(2)) // pnl
        expect(value.shortValue._value).to.equal(parse6decimal('-2').mul(2).div(3).sub(1).add(3)) // pnl
        expect(value.makerPosFee._value).to.equal(impact4.add(fee4).mul(-1).mul(123).div(10))
        expect(value.makerNegFee._value).to.equal(0)
        expect(value.takerPosFee._value).to.equal(impact1.add(fee1).mul(-1).mul(123).div(50))
        expect(value.takerNegFee._value).to.equal(impact2.add(fee2).mul(-1).mul(123).div(60))
        expect(value.settlementFee._value).to.equal(-2)

        expect(ret[0].positionFee).to.equal(fee)
        expect(ret[0].positionFeeMaker).to.equal(0)
        expect(ret[0].positionFeeProtocol).to.equal(fee)
        expect(ret[0].positionFeeExposure).to.equal(exposure)
        expect(ret[0].positionFeeExposureProtocol).to.equal(-exposure)
        expect(ret[0].positionFeeExposureMaker).to.equal(0)
        expect(ret[0].positionFeeImpact).to.equal(impact)
      })

      it('allocates when makers', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('20'), short: parse6decimal('30'), maker: parse6decimal('50') },
          {
            ...ORDER,
            makerNeg: parse6decimal('10'),
            makerPos: parse6decimal('20'),
            longPos: parse6decimal('30'),
            longNeg: parse6decimal('10'),
            shortPos: parse6decimal('50'),
            shortNeg: parse6decimal('20'),
          },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          { ...VALID_MARKET_PARAMETER, positionFee: parse6decimal('0.1') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
            makerFee: {
              linearFee: parse6decimal('0.02'),
              proportionalFee: parse6decimal('0.10'),
              adiabaticFee: parse6decimal('0.20'),
              scale: parse6decimal('100'),
            },
            takerFee: {
              linearFee: parse6decimal('0.01'),
              proportionalFee: parse6decimal('0.05'),
              adiabaticFee: parse6decimal('0.10'),
              scale: parse6decimal('100'),
            },
          },
        )

        const takerExposure = parse6decimal('0.05') // 0 -> -10 / 100 = -5 / 100 = -0.05 * -10 * 0.1
        const makerExposure = parse6decimal('-7.5') // 100 -> 50 / 100 = 75 / 100 = 0.75 * 50 * 0.2
        const exposure = takerExposure.add(makerExposure).mul(2) // price delta

        const fee1 = parse6decimal('1.75') // 50 * 0.01 + 50 * 0.025
        const fee2 = parse6decimal('2.4') // 60 * 0.01 + 60 * 0.03
        const fee3 = parse6decimal('0.3') // 10 * 0.02 + 10 * 0.01
        const fee4 = parse6decimal('0.8') // 20 * 0.02 + 20 * 0.02
        const fee = fee1.add(fee2).add(fee3).add(fee4).mul(123) // price

        const impact1 = parse6decimal('.75') // -10 -> 40 / 100 = 15 / 100 = 0.15 * 50 * 0.1
        const impact2 = parse6decimal('-0.6') // 40 -> -20 / 100 = -10 / 100 = -0.1 * 60 * 0.1
        const impact3 = parse6decimal('1.1') // 50 -> 60 / 100 = 55 / 100 = 0.55 * 10 * 0.2
        const impact4 = parse6decimal('-2.0') // 60 -> 40 / 100 = -50 / 100 = -.5 * 20 * 0.2
        const impact = impact1.add(impact2).add(impact3).add(impact4).mul(123) // price

        expect(value.makerValue._value).to.equal(
          fee.mul(9).div(10).sub(exposure).add(parse6decimal('2').mul(10)).div(50).add(1),
        )
        expect(value.longValue._value).to.equal(parse6decimal('2').add(2))
        expect(value.shortValue._value).to.equal(parse6decimal('-2').add(3))
        expect(value.makerPosFee._value).to.equal(impact4.add(fee4).mul(-1).mul(123).div(20))
        expect(value.makerNegFee._value).to.equal(impact3.add(fee3).mul(-1).mul(123).div(10))
        expect(value.takerPosFee._value).to.equal(impact1.add(fee1).mul(-1).mul(123).div(50))
        expect(value.takerNegFee._value).to.equal(impact2.add(fee2).mul(-1).mul(123).div(60))
        expect(value.settlementFee._value).to.equal(-2)

        expect(ret[0].positionFee).to.equal(fee)
        expect(ret[0].positionFeeMaker).to.equal(fee.mul(9).div(10))
        expect(ret[0].positionFeeProtocol).to.equal(fee.div(10))
        expect(ret[0].positionFeeExposure).to.equal(exposure)
        expect(ret[0].positionFeeExposureMaker).to.equal(-exposure)
        expect(ret[0].positionFeeExposureProtocol).to.equal(0)
        expect(ret[0].positionFeeImpact).to.equal(impact)
      })
    })

    describe('funding accumulation', () => {
      context('no time elapsed', () => {
        it('accumulates 0 funding', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('12'),
              short: parse6decimal('2'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_1,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.02'),
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )
          expect(ret[0].fundingFee).to.equal(0)
          expect(ret[0].fundingMaker).to.equal(0)
          expect(ret[0].fundingLong).to.equal(0)
          expect(ret[0].fundingShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('no positions', () => {
        it('accumulates 0 funding', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: 0,
              long: 0,
              short: 0,
            },
            {
              ...ORDER,
              makerPos: ORDER.makerPos,
              makerNeg: 0,
            },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.02'),
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )
          expect(ret[0].fundingFee).to.equal(0)
          expect(ret[0].fundingMaker).to.equal(0)
          expect(ret[0].fundingLong).to.equal(0)
          expect(ret[0].fundingShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('longs > shorts', () => {
        it('accumulates funding', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('12'),
              short: parse6decimal('8'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: 0,
              fundingFee: parse6decimal('0.02'),
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )

          expect(ret[0].fundingFee).to.equal(BigNumber.from('35'))
          expect(ret[0].fundingMaker).to.equal(BigNumber.from('584'))
          expect(ret[0].fundingLong).to.equal(BigNumber.from('-1788'))
          expect(ret[0].fundingShort).to.equal(BigNumber.from('1169'))

          expect(value.makerValue._value).to.equal(BigNumber.from('58'))
          expect(value.longValue._value).to.equal(BigNumber.from('-149'))
          expect(value.shortValue._value).to.equal(BigNumber.from('146'))
        })
      })

      context('shorts > longs', () => {
        it('accumulates funding', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('8'),
              short: parse6decimal('12'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: 0,
              fundingFee: parse6decimal('0.02'),
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )

          expect(ret[0].fundingFee).to.equal(BigNumber.from('35'))
          expect(ret[0].fundingMaker).to.equal(BigNumber.from('-595'))
          expect(ret[0].fundingLong).to.equal(BigNumber.from('-1193'))
          expect(ret[0].fundingShort).to.equal(BigNumber.from('1753'))

          expect(value.makerValue._value).to.equal(BigNumber.from('-60'))
          expect(value.longValue._value).to.equal(BigNumber.from('-150'))
          expect(value.shortValue._value).to.equal(BigNumber.from('146'))
        })
      })

      context('makerReceiveOnly', () => {
        it('accumulates funding', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('8'),
              short: parse6decimal('12'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: 0,
              fundingFee: parse6decimal('0.02'),
            },
            {
              ...VALID_RISK_PARAMETER,
              makerReceiveOnly: true,
              pController: { max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )

          expect(ret[0].fundingFee).to.equal(BigNumber.from('35'))
          expect(ret[0].fundingMaker).to.equal(BigNumber.from('583'))
          expect(ret[0].fundingLong).to.equal(BigNumber.from('1169'))
          expect(ret[0].fundingShort).to.equal(BigNumber.from('-1787'))

          expect(value.makerValue._value).to.equal(BigNumber.from('58'))
          expect(value.longValue._value).to.equal(BigNumber.from('146'))
          expect(value.shortValue._value).to.equal(BigNumber.from('-149'))
        })
      })
    })

    describe('interest accumulation', () => {
      context('no time elapsed', () => {
        it('accumulates 0 interest', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('12'),
              short: parse6decimal('2'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_1,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.02'),
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: parse6decimal('0.1'),
                maxRate: parse6decimal('0.1'),
                targetRate: parse6decimal('0.1'),
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )
          expect(ret[0].interestFee).to.equal(0)
          expect(ret[0].interestMaker).to.equal(0)
          expect(ret[0].interestLong).to.equal(0)
          expect(ret[0].interestShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('long + short > maker', () => {
        it('uses maker notional to calculate interest', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('12'),
              short: parse6decimal('2'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.02'),
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: parse6decimal('0.1'),
                maxRate: parse6decimal('0.1'),
                targetRate: parse6decimal('0.1'),
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )

          // notional = 10 * 1230 = 12300
          // interest = 12300 * 0.1 / 365 / 24 = .014041
          // fee = 0.014041 * 0.02 = 0.00028
          // interestMaker =.014041 - 0.00028 = 0.013761
          // interestLong = .014041 * 12 / 14 * -1 = -0.012035
          // interestShort = (.014041 - .012035) * -1 = -0.002006
          expect(ret[0].interestFee).to.equal(parse6decimal('0.00028'))
          expect(ret[0].interestMaker).to.equal(parse6decimal('0.013761'))
          expect(ret[0].interestLong).to.equal(parse6decimal('-0.012035'))
          expect(ret[0].interestShort).to.equal(parse6decimal('-0.002006'))

          expect(value.makerValue._value).to.equal(parse6decimal('0.001376'))
          expect(value.longValue._value).to.equal(parse6decimal('-0.001003'))
          expect(value.shortValue._value).to.equal(parse6decimal('-0.001003'))
        })
      })

      context('long + short < maker', () => {
        it('uses long+short notional to calculate interest', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('20'),
              long: parse6decimal('8'),
              short: parse6decimal('2'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.02'),
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: parse6decimal('0.1'),
                maxRate: parse6decimal('0.1'),
                targetRate: parse6decimal('0.1'),
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )

          // notional = 10 * 1230 = 12300
          // interest = 12300 * 0.1 / 365 / 24 = .014041
          // fee = 0.014041 * 0.02 = 0.00028
          // interestMaker =.014041 - 0.00028 = 0.013761
          // interestLong = .014041 * 8 / 10 * -1 = -0.0112328
          // interestShort = (.014041 - 0.0112328) * -1 = -0.002809
          expect(ret[0].interestFee).to.equal(parse6decimal('0.00028'))
          expect(ret[0].interestMaker).to.equal(parse6decimal('0.013761'))
          expect(ret[0].interestLong).to.equal(parse6decimal('-0.0112328'))
          expect(ret[0].interestShort).to.equal(parse6decimal('-0.002809'))

          expect(value.makerValue._value).to.equal(parse6decimal('0.000688'))
          expect(value.longValue._value).to.equal(parse6decimal('-0.0014041'))
          expect(value.shortValue._value).to.equal(parse6decimal('-0.001405'))
        })
      })

      context('major is 0', () => {
        it('accumulates 0 interest', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: 0,
              short: 0,
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.02'),
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: parse6decimal('0.1'),
                maxRate: parse6decimal('0.1'),
                targetRate: parse6decimal('0.1'),
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )

          expect(ret[0].interestFee).to.equal(0)
          expect(ret[0].interestMaker).to.equal(0)
          expect(ret[0].interestLong).to.equal(0)
          expect(ret[0].interestShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })
    })

    describe('pnl accumulation', () => {
      context('no price change', () => {
        it('accumulates 0 pnl', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('2'),
              short: parse6decimal('9'),
            },
            ORDER,
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: 0,
              fundingFee: 0,
            },
            {
              ...VALID_RISK_PARAMETER,
              pController: { max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )

          expect(ret[0].pnlMaker).to.equal(0)
          expect(ret[0].pnlLong).to.equal(0)
          expect(ret[0].pnlShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('positive price change', () => {
        context('no maker exposure', () => {
          it('accumulates pnl to long/shorts', async () => {
            await version.store(EMPTY_VERSION)

            const { ret, value } = await accumulateWithReturn(
              GLOBAL,
              {
                ...FROM_POSITION,
                maker: parse6decimal('10'),
                long: parse6decimal('9'),
                short: parse6decimal('9'),
              },
              ORDER,
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('2')),
              },
              {
                ...VALID_MARKET_PARAMETER,
                interestFee: 0,
                fundingFee: 0,
              },
              {
                ...VALID_RISK_PARAMETER,
                makerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                takerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                pController: { max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret[0].pnlMaker).to.equal(parse6decimal('0'))
            expect(ret[0].pnlLong).to.equal(parse6decimal('18'))
            expect(ret[0].pnlShort).to.equal(parse6decimal('-18'))

            expect(value.makerValue._value).to.equal(0)
            expect(value.longValue._value).to.equal(parse6decimal('2'))
            expect(value.shortValue._value).to.equal(parse6decimal('-2'))
          })
        })

        context('maker long exposure', () => {
          it('accumulates pnl to long/shorts/makers', async () => {
            await version.store(EMPTY_VERSION)

            const { ret, value } = await accumulateWithReturn(
              GLOBAL,
              {
                ...FROM_POSITION,
                maker: parse6decimal('10'),
                long: parse6decimal('2'),
                short: parse6decimal('9'),
              },
              ORDER,
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('2')),
              },
              {
                ...VALID_MARKET_PARAMETER,
                interestFee: 0,
                fundingFee: 0,
              },
              {
                ...VALID_RISK_PARAMETER,
                makerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                takerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                pController: { max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret[0].pnlMaker).to.equal(parse6decimal('14'))
            expect(ret[0].pnlLong).to.equal(parse6decimal('4'))
            expect(ret[0].pnlShort).to.equal(parse6decimal('-18'))

            expect(value.makerValue._value).to.equal(parse6decimal('1.4'))
            expect(value.longValue._value).to.equal(parse6decimal('2'))
            expect(value.shortValue._value).to.equal(parse6decimal('-2'))
          })
        })

        context('maker short exposure', () => {
          it('accumulates pnl to long/shorts/makers', async () => {
            await version.store(EMPTY_VERSION)

            const { ret, value } = await accumulateWithReturn(
              GLOBAL,
              {
                ...FROM_POSITION,
                maker: parse6decimal('5'),
                long: parse6decimal('20'),
                short: parse6decimal('15'),
              },
              ORDER,
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('2')),
              },
              {
                ...VALID_MARKET_PARAMETER,
                interestFee: 0,
                fundingFee: 0,
              },
              {
                ...VALID_RISK_PARAMETER,
                makerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                takerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                pController: { max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret[0].pnlMaker).to.equal(parse6decimal('-10'))
            expect(ret[0].pnlLong).to.equal(parse6decimal('40'))
            expect(ret[0].pnlShort).to.equal(parse6decimal('-30'))

            expect(value.makerValue._value).to.equal(parse6decimal('-2'))
            expect(value.longValue._value).to.equal(parse6decimal('2'))
            expect(value.shortValue._value).to.equal(parse6decimal('-2'))
          })
        })
      })

      context('negative price change', () => {
        context('no maker exposure', () => {
          it('accumulates pnl to long/shorts', async () => {
            await version.store(EMPTY_VERSION)

            const { ret, value } = await accumulateWithReturn(
              GLOBAL,
              {
                ...FROM_POSITION,
                maker: parse6decimal('10'),
                long: parse6decimal('9'),
                short: parse6decimal('9'),
              },
              ORDER,
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('-2')),
              },
              {
                ...VALID_MARKET_PARAMETER,
                interestFee: 0,
                fundingFee: 0,
              },
              {
                ...VALID_RISK_PARAMETER,
                makerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                takerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                pController: { max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret[0].pnlMaker).to.equal(parse6decimal('0'))
            expect(ret[0].pnlLong).to.equal(parse6decimal('-18'))
            expect(ret[0].pnlShort).to.equal(parse6decimal('18'))

            expect(value.makerValue._value).to.equal(0)
            expect(value.longValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortValue._value).to.equal(parse6decimal('2'))
          })
        })

        context('maker long exposure', () => {
          it('accumulates 0 pnl', async () => {
            await version.store(EMPTY_VERSION)

            const { ret, value } = await accumulateWithReturn(
              GLOBAL,
              {
                ...FROM_POSITION,
                maker: parse6decimal('10'),
                long: parse6decimal('2'),
                short: parse6decimal('9'),
              },
              ORDER,
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('-2')),
              },
              {
                ...VALID_MARKET_PARAMETER,
                interestFee: 0,
                fundingFee: 0,
              },
              {
                ...VALID_RISK_PARAMETER,
                makerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                takerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                pController: { max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret[0].pnlMaker).to.equal(parse6decimal('-14'))
            expect(ret[0].pnlLong).to.equal(parse6decimal('-4'))
            expect(ret[0].pnlShort).to.equal(parse6decimal('18'))

            expect(value.makerValue._value).to.equal(parse6decimal('-1.4'))
            expect(value.longValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortValue._value).to.equal(parse6decimal('2'))
          })
        })

        context('maker short exposure', () => {
          it('accumulates pnl to long/shorts/makers', async () => {
            await version.store(EMPTY_VERSION)

            const { ret, value } = await accumulateWithReturn(
              GLOBAL,
              {
                ...FROM_POSITION,
                maker: parse6decimal('5'),
                long: parse6decimal('20'),
                short: parse6decimal('15'),
              },
              ORDER,
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('-2')),
              },
              {
                ...VALID_MARKET_PARAMETER,
                interestFee: 0,
                fundingFee: 0,
              },
              {
                ...VALID_RISK_PARAMETER,
                makerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                takerFee: {
                  linearFee: 0,
                  proportionalFee: 0,
                  adiabaticFee: 0,
                  scale: parse6decimal('100'),
                },
                pController: { max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret[0].pnlMaker).to.equal(parse6decimal('10'))
            expect(ret[0].pnlLong).to.equal(parse6decimal('-40'))
            expect(ret[0].pnlShort).to.equal(parse6decimal('30'))

            expect(value.makerValue._value).to.equal(parse6decimal('2'))
            expect(value.longValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortValue._value).to.equal(parse6decimal('2'))
          })
        })
      })
    })
  })
})
