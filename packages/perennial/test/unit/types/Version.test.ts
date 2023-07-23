import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { VersionTester, VersionTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import {
  GlobalStruct,
  MarketParameterStruct,
  OracleVersionStruct,
  PositionStruct,
  RiskParameterStruct,
  VersionStruct,
} from '../../../types/generated/contracts/Market'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { VALID_RISK_PARAMETER } from './RiskParameter.test'

const { ethers } = HRE
use(smock.matchers)

const VALID_VERSION: VersionStruct = {
  valid: true,
  makerValue: { _value: 1 },
  longValue: { _value: 2 },
  shortValue: { _value: 3 },
  makerReward: { _value: 4 },
  longReward: { _value: 5 },
  shortReward: { _value: 6 },
}

const EMPTY_VERSION: VersionStruct = {
  valid: true,
  makerValue: { _value: 0 },
  longValue: { _value: 0 },
  shortValue: { _value: 0 },
  makerReward: { _value: 0 },
  longReward: { _value: 0 },
  shortReward: { _value: 0 },
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
  fee: 6,
  keeper: 7,
  collateral: 8,
  delta: 9,
}

const TO_POSITION: PositionStruct = {
  timestamp: 20,
  maker: 30,
  long: 40,
  short: 50,
  fee: 60,
  keeper: 70,
  collateral: 80,
  delta: 90,
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
    toPosition: PositionStruct,
    fromOracleVersion: OracleVersionStruct,
    toOracleVersion: OracleVersionStruct,
    marketParameter: MarketParameterStruct,
    riskParameter: RiskParameterStruct,
  ) => {
    const ret = await version.callStatic.accumulate(
      global,
      fromPosition,
      toPosition,
      fromOracleVersion,
      toOracleVersion,
      marketParameter,
      riskParameter,
    )
    await version.accumulate(
      global,
      fromPosition,
      toPosition,
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
      expect(value.makerReward._value).to.equal(4)
      expect(value.longReward._value).to.equal(5)
      expect(value.shortReward._value).to.equal(6)
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

    describe('.makerReward', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          makerReward: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerReward._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerReward: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.longReward', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          longReward: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.longReward._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longReward: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })

    describe('.shortReward', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          shortReward: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.shortReward._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortReward: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(version, 'VersionStorageInvalidError')
      })
    })
  })

  describe('#accumulate', () => {
    context('market closed', () => {
      it('does not accumulate', async () => {
        await version.store(VALID_VERSION)

        const ret = await version.callStatic.accumulate(
          GLOBAL,
          FROM_POSITION,
          TO_POSITION,
          ORACLE_VERSION_1,
          ORACLE_VERSION_2,
          { ...VALID_MARKET_PARAMETER, closed: true },
          VALID_RISK_PARAMETER,
        )
        await version.accumulate(
          GLOBAL,
          FROM_POSITION,
          TO_POSITION,
          ORACLE_VERSION_1,
          ORACLE_VERSION_2,
          { ...VALID_MARKET_PARAMETER, closed: true },
          VALID_RISK_PARAMETER,
        )

        const value = await version.read()

        expect(value.valid).to.be.true
        expect(value.makerValue._value).to.equal(1)
        expect(value.longValue._value).to.equal(2)
        expect(value.shortValue._value).to.equal(3)
        expect(value.makerReward._value).to.equal(4)
        expect(value.longReward._value).to.equal(5)
        expect(value.shortReward._value).to.equal(6)

        expect(ret.totalFee).to.equal(0)
        // All values should be 0 (default value)
        ret[0].forEach(v => expect(v).to.equal(0))
      })
    })

    describe('.valid', () => {
      context('invalid toOracleVersion', () => {
        it('marks version invalid', async () => {
          await version.store(VALID_VERSION)
          await version.accumulate(
            GLOBAL,
            FROM_POSITION,
            TO_POSITION,
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
            TO_POSITION,
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
            TO_POSITION,
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
      context('no makers', () => {
        it('allocates fees to protocol', async () => {
          await version.store(VALID_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            { ...FROM_POSITION, maker: 0 },
            { ...TO_POSITION, fee: parse6decimal('1.01') },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            VALID_MARKET_PARAMETER,
            VALID_RISK_PARAMETER,
          )

          expect(value.makerValue._value).to.equal(1)
          expect(ret[0].positionFeeFee).to.equal(parse6decimal('1.01'))
        })
      })

      context('makers', () => {
        it('allocates fees to makers and protocol', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            { ...FROM_POSITION, maker: parse6decimal('10') },
            { ...TO_POSITION, fee: parse6decimal('101') },
            ORACLE_VERSION_1,
            ORACLE_VERSION_1,
            { ...VALID_MARKET_PARAMETER, positionFee: parse6decimal('0.1') },
            VALID_RISK_PARAMETER,
          )

          expect(value.makerValue._value).to.equal(parse6decimal('9.09'))
          expect(ret[0].positionFeeMaker).to.equal(parse6decimal('90.9'))
          expect(ret[0].positionFeeFee).to.equal(parse6decimal('10.1'))
        })
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
            { ...TO_POSITION, fee: 0 },
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
            { ...TO_POSITION, fee: 0 },
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
            {
              ...TO_POSITION,
              fee: 0,
            },
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
            {
              ...TO_POSITION,
              fee: 0,
            },
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
            {
              ...TO_POSITION,
              fee: 0,
            },
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
            { ...TO_POSITION, fee: 0 },
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
            { ...TO_POSITION, fee: 0 },
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
            { ...TO_POSITION, fee: 0 },
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
            { ...TO_POSITION, fee: 0 },
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
            { ...TO_POSITION, fee: 0 },
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
              { ...TO_POSITION, fee: 0 },
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
              { ...TO_POSITION, fee: 0 },
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
              { ...TO_POSITION, fee: 0 },
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
              { ...TO_POSITION, fee: 0 },
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
              { ...TO_POSITION, fee: 0 },
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
              { ...TO_POSITION, fee: 0 },
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

    describe('reward accumulation', () => {
      context('no time elapsed', () => {
        it('accumulates 0 rewards', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('12'),
              short: parse6decimal('2'),
            },
            { ...TO_POSITION, fee: 0 },
            ORACLE_VERSION_1,
            ORACLE_VERSION_1,
            VALID_MARKET_PARAMETER,
            VALID_RISK_PARAMETER,
          )
          expect(ret[0].rewardMaker).to.equal(0)
          expect(ret[0].rewardLong).to.equal(0)
          expect(ret[0].rewardShort).to.equal(0)

          expect(value.makerReward._value).to.equal(0)
          expect(value.longReward._value).to.equal(0)
          expect(value.shortReward._value).to.equal(0)
        })
      })

      context('no positions', () => {
        it('accumulates 0 rewards', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: 0,
              long: 0,
              short: 0,
            },
            { ...TO_POSITION, fee: 0 },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            VALID_MARKET_PARAMETER,
            VALID_RISK_PARAMETER,
          )
          expect(ret[0].rewardMaker).to.equal(0)
          expect(ret[0].rewardLong).to.equal(0)
          expect(ret[0].rewardShort).to.equal(0)

          expect(value.makerReward._value).to.equal(0)
          expect(value.longReward._value).to.equal(0)
          expect(value.shortReward._value).to.equal(0)
        })
      })

      context('positions', () => {
        it('accumulates rewards', async () => {
          await version.store(EMPTY_VERSION)

          const { ret, value } = await accumulateWithReturn(
            GLOBAL,
            {
              ...FROM_POSITION,
              maker: parse6decimal('10'),
              long: parse6decimal('12'),
              short: parse6decimal('2'),
            },
            { ...TO_POSITION, fee: 0 },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            {
              ...VALID_MARKET_PARAMETER,
              makerRewardRate: parse6decimal('0.001'),
              longRewardRate: parse6decimal('0.002'),
              shortRewardRate: parse6decimal('0.003'),
            },
            VALID_RISK_PARAMETER,
          )

          expect(ret[0].rewardMaker).to.equal(parse6decimal('3.6'))
          expect(ret[0].rewardLong).to.equal(parse6decimal('7.2'))
          expect(ret[0].rewardShort).to.equal(parse6decimal('10.8'))

          expect(value.makerReward._value).to.equal(parse6decimal('0.36'))
          expect(value.longReward._value).to.equal(parse6decimal('0.6'))
          expect(value.shortReward._value).to.equal(parse6decimal('5.4'))
        })
      })
    })
  })
})
