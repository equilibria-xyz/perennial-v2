import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  VersionLib,
  VersionLib__factory,
  VersionStorageLib,
  VersionStorageLib__factory,
  VersionTester,
  VersionTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { DEFAULT_ORDER, DEFAULT_VERSION, parse6decimal } from '../../../../common/testutil/types'
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
  makerLinearFee: { _value: 14 },
  makerProportionalFee: { _value: 15 },
  takerLinearFee: { _value: 16 },
  takerProportionalFee: { _value: 17 },
  makerPosFee: { _value: 4 },
  makerNegFee: { _value: 5 },
  takerPosFee: { _value: 6 },
  takerNegFee: { _value: 7 },
  settlementFee: { _value: -8 },
  liquidationFee: { _value: -9 },
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
  exposure: 0,
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
  protection: 1,
  makerReferral: 10,
  takerReferral: 11,
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
  let versionLib: VersionLib
  let versionStorageLib: VersionStorageLib
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
    const accumulationResult = await version.callStatic.accumulate(
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
    return { ret: accumulationResult[1], value, nextGlobal: accumulationResult[0] }
  }

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    versionLib = await new VersionLib__factory(owner).deploy()
    versionStorageLib = await new VersionStorageLib__factory(owner).deploy()
    version = await new VersionTester__factory(
      {
        'contracts/libs/VersionLib.sol:VersionLib': versionLib.address,
        'contracts/types/Version.sol:VersionStorageLib': versionStorageLib.address,
      },
      owner,
    ).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await version.store(VALID_VERSION)

      const value = await version.read()
      expect(value.valid).to.equal(true)
      expect(value.makerValue._value).to.equal(1)
      expect(value.longValue._value).to.equal(2)
      expect(value.shortValue._value).to.equal(3)
      expect(value.makerLinearFee._value).to.equal(14)
      expect(value.makerProportionalFee._value).to.equal(15)
      expect(value.takerLinearFee._value).to.equal(16)
      expect(value.takerProportionalFee._value).to.equal(17)
      expect(value.makerPosFee._value).to.equal(4)
      expect(value.makerNegFee._value).to.equal(5)
      expect(value.takerPosFee._value).to.equal(6)
      expect(value.takerNegFee._value).to.equal(7)
      expect(value.settlementFee._value).to.equal(-8)
      expect(value.liquidationFee._value).to.equal(-9)
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerLinearFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerLinearFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerLinearFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerProportionalFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerProportionalFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerProportionalFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.takerLinearFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.takerLinearFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.takerLinearFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerLinearFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.takerProportionalFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.takerProportionalFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.takerProportionalFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerProportionalFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerPosFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerNegFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            settlementFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.liquidationFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          liquidationFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.liquidationFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          liquidationFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.liquidationFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            liquidationFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            liquidationFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
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

        expect(ret[1].positionFee).to.equal(BigNumber.from('147600000'))
        expect(ret[1].positionFeeMaker).to.equal(BigNumber.from('147599558'))
        expect(ret[1].positionFeeProtocol).to.equal(BigNumber.from('442'))
        expect(ret[1].positionFeeExposure).to.equal(0)
        expect(ret[1].positionFeeExposureMaker).to.equal(0)
        expect(ret[1].positionFeeExposureProtocol).to.equal(0)
        expect(ret[1].positionFeeImpact).to.equal(BigNumber.from('18450000'))
        expect(ret[1].fundingMaker).to.equal(0)
        expect(ret[1].fundingLong).to.equal(0)
        expect(ret[1].fundingShort).to.equal(0)
        expect(ret[1].fundingFee).to.equal(0)
        expect(ret[1].interestMaker).to.equal(0)
        expect(ret[1].interestLong).to.equal(0)
        expect(ret[1].interestShort).to.equal(0)
        expect(ret[1].interestFee).to.equal(0)
        expect(ret[1].pnlMaker).to.equal(0)
        expect(ret[1].pnlLong).to.equal(0)
        expect(ret[1].pnlShort).to.equal(0)
        expect(ret[1].settlementFee).to.equal(parse6decimal('2'))
        expect(ret[1].liquidationFee).to.equal(9)
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
            makerReferral: 0,
            takerReferral: 0,
          },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          { ...VALID_MARKET_PARAMETER },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
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

        const linear1 = parse6decimal('0.2') // 10 * 0.02
        const linear2 = parse6decimal('1.1') // 110 * 0.01
        const linear = linear1.add(linear2).mul(123) // price

        const proportional1 = parse6decimal('0.1') // 10 * 0.01
        const proportional2 = parse6decimal('6.05') // 110 * 0.055
        const proportional = proportional1.add(proportional2).mul(123) // price

        const fee = linear.add(proportional)

        const impact1 = parse6decimal('.75') // -10 -> 40 / 100 = 15 / 100 = 0.15 * 50 * 0.1
        const impact2 = parse6decimal('-0.6') // 40 -> -20 / 100 = -10 / 100 = -0.1 * 60 * 0.1
        const impact3 = parse6decimal('0')
        const impact4 = parse6decimal('-1.9') // 100 -> 90 / 100 = -95 / 100 = -0.95 * 10 * 0.2
        const impact = impact1.add(impact2).add(impact3).add(impact4).mul(123) // price

        expect(value.makerValue._value).to.equal(1)
        expect(value.longValue._value).to.equal(parse6decimal('2').add(2)) // pnl
        expect(value.shortValue._value).to.equal(parse6decimal('-2').mul(2).div(3).sub(1).add(3)) // pnl
        expect(value.makerLinearFee._value).to.equal(linear1.mul(-1).mul(123).div(10))
        expect(value.makerProportionalFee._value).to.equal(proportional1.mul(-1).mul(123).div(10))
        expect(value.takerLinearFee._value).to.equal(linear2.mul(-1).mul(123).div(110))
        expect(value.takerProportionalFee._value).to.equal(proportional2.mul(-1).mul(123).div(110))
        expect(value.makerPosFee._value).to.equal(impact4.mul(-1).mul(123).div(10))
        expect(value.makerNegFee._value).to.equal(0)
        expect(value.takerPosFee._value).to.equal(impact1.mul(-1).mul(123).div(50))
        expect(value.takerNegFee._value).to.equal(impact2.mul(-1).mul(123).div(60))
        expect(value.settlementFee._value).to.equal(-2)

        expect(ret.positionFee).to.equal(fee)
        expect(ret.positionFeeMaker).to.equal(0)
        expect(ret.positionFeeProtocol).to.equal(fee)
        expect(ret.positionFeeExposure).to.equal(exposure)
        expect(ret.positionFeeExposureProtocol).to.equal(-exposure)
        expect(ret.positionFeeExposureMaker).to.equal(0)
        expect(ret.positionFeeImpact).to.equal(impact)
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
            makerReferral: 0,
            takerReferral: 0,
          },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          { ...VALID_MARKET_PARAMETER, positionFee: parse6decimal('0.1') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
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

        const linear1 = parse6decimal('0.6') // 30 * 0.02
        const linear2 = parse6decimal('1.1') // 110 * 0.01
        const linear = linear1.add(linear2).mul(123) // price

        const proportional1 = parse6decimal('0.9') // 30 * 0.03
        const proportional2 = parse6decimal('6.05') // 110 * 0.055
        const proportional = proportional1.add(proportional2).mul(123) // price

        const fee = linear.add(proportional)

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
        expect(value.makerLinearFee._value).to.equal(linear1.mul(-1).mul(123).div(30))
        expect(value.makerProportionalFee._value).to.equal(proportional1.mul(-1).mul(123).div(30))
        expect(value.takerLinearFee._value).to.equal(linear2.mul(-1).mul(123).div(110))
        expect(value.takerProportionalFee._value).to.equal(proportional2.mul(-1).mul(123).div(110))
        expect(value.makerPosFee._value).to.equal(impact4.mul(-1).mul(123).div(20))
        expect(value.makerNegFee._value).to.equal(impact3.mul(-1).mul(123).div(10))
        expect(value.takerPosFee._value).to.equal(impact1.mul(-1).mul(123).div(50))
        expect(value.takerNegFee._value).to.equal(impact2.mul(-1).mul(123).div(60))
        expect(value.settlementFee._value).to.equal(-2)

        expect(ret.positionFee).to.equal(fee)
        expect(ret.positionFeeMaker).to.equal(fee.mul(9).div(10))
        expect(ret.positionFeeProtocol).to.equal(fee.div(10))
        expect(ret.positionFeeExposure).to.equal(exposure)
        expect(ret.positionFeeExposureMaker).to.equal(-exposure)
        expect(ret.positionFeeExposureProtocol).to.equal(0)
        expect(ret.positionFeeImpact).to.equal(impact)
      })
    })

    describe('funding accumulation', () => {
      context('no time elapsed', () => {
        it('accumulates 0 funding', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: parse6decimal('-40000'), max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )
          expect(ret.fundingFee).to.equal(0)
          expect(ret.fundingMaker).to.equal(0)
          expect(ret.fundingLong).to.equal(0)
          expect(ret.fundingShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('no positions', () => {
        it('accumulates 0 funding', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: parse6decimal('-40000'), max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )
          expect(ret.fundingFee).to.equal(0)
          expect(ret.fundingMaker).to.equal(0)
          expect(ret.fundingLong).to.equal(0)
          expect(ret.fundingShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('longs > shorts', () => {
        it('accumulates funding', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: parse6decimal('-40000'), max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )

          expect(ret.fundingFee).to.equal(BigNumber.from('35'))
          expect(ret.fundingMaker).to.equal(BigNumber.from('584'))
          expect(ret.fundingLong).to.equal(BigNumber.from('-1788'))
          expect(ret.fundingShort).to.equal(BigNumber.from('1169'))

          expect(value.makerValue._value).to.equal(BigNumber.from('58'))
          expect(value.longValue._value).to.equal(BigNumber.from('-149'))
          expect(value.shortValue._value).to.equal(BigNumber.from('146'))
        })
      })

      context('shorts > longs', () => {
        it('accumulates funding', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: parse6decimal('-40000'), max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )

          expect(ret.fundingFee).to.equal(BigNumber.from('35'))
          expect(ret.fundingMaker).to.equal(BigNumber.from('-595'))
          expect(ret.fundingLong).to.equal(BigNumber.from('-1193'))
          expect(ret.fundingShort).to.equal(BigNumber.from('1753'))

          expect(value.makerValue._value).to.equal(BigNumber.from('-60'))
          expect(value.longValue._value).to.equal(BigNumber.from('-150'))
          expect(value.shortValue._value).to.equal(BigNumber.from('146'))
        })
      })

      context('makerReceiveOnly', () => {
        it('accumulates funding', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: parse6decimal('-40000'), max: parse6decimal('40000'), k: parse6decimal('1.2') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: 0,
              },
            },
          )

          expect(ret.fundingFee).to.equal(BigNumber.from('35'))
          expect(ret.fundingMaker).to.equal(BigNumber.from('583'))
          expect(ret.fundingLong).to.equal(BigNumber.from('1169'))
          expect(ret.fundingShort).to.equal(BigNumber.from('-1787'))

          expect(value.makerValue._value).to.equal(BigNumber.from('58'))
          expect(value.longValue._value).to.equal(BigNumber.from('146'))
          expect(value.shortValue._value).to.equal(BigNumber.from('-149'))
        })
      })
    })

    describe('interest accumulation', () => {
      context('no time elapsed', () => {
        it('accumulates 0 interest', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: 0, max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: parse6decimal('0.1'),
                maxRate: parse6decimal('0.1'),
                targetRate: parse6decimal('0.1'),
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )
          expect(ret.interestFee).to.equal(0)
          expect(ret.interestMaker).to.equal(0)
          expect(ret.interestLong).to.equal(0)
          expect(ret.interestShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('long + short > maker', () => {
        it('uses maker notional to calculate interest', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: 0, max: 0, k: parse6decimal('999999') },
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
          expect(ret.interestFee).to.equal(parse6decimal('0.00028'))
          expect(ret.interestMaker).to.equal(parse6decimal('0.013761'))
          expect(ret.interestLong).to.equal(parse6decimal('-0.012035'))
          expect(ret.interestShort).to.equal(parse6decimal('-0.002006'))

          expect(value.makerValue._value).to.equal(parse6decimal('0.001376'))
          expect(value.longValue._value).to.equal(parse6decimal('-0.001003'))
          expect(value.shortValue._value).to.equal(parse6decimal('-0.001003'))
        })
      })

      context('long + short < maker', () => {
        it('uses long+short notional to calculate interest', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: 0, max: 0, k: parse6decimal('999999') },
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
          expect(ret.interestFee).to.equal(parse6decimal('0.00028'))
          expect(ret.interestMaker).to.equal(parse6decimal('0.013761'))
          expect(ret.interestLong).to.equal(parse6decimal('-0.0112328'))
          expect(ret.interestShort).to.equal(parse6decimal('-0.002809'))

          expect(value.makerValue._value).to.equal(parse6decimal('0.000688'))
          expect(value.longValue._value).to.equal(parse6decimal('-0.0014041'))
          expect(value.shortValue._value).to.equal(parse6decimal('-0.001405'))
        })
      })

      context('major is 0', () => {
        it('accumulates 0 interest', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: 0, max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: parse6decimal('0.1'),
                maxRate: parse6decimal('0.1'),
                targetRate: parse6decimal('0.1'),
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )

          expect(ret.interestFee).to.equal(0)
          expect(ret.interestMaker).to.equal(0)
          expect(ret.interestLong).to.equal(0)
          expect(ret.interestShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })
    })

    describe('pnl accumulation', () => {
      context('no price change', () => {
        it('accumulates 0 pnl', async () => {
          await version.store(DEFAULT_VERSION)

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
              pController: { min: 0, max: 0, k: parse6decimal('999999') },
              utilizationCurve: {
                minRate: 0,
                maxRate: 0,
                targetRate: 0,
                targetUtilization: parse6decimal('0.8'),
              },
            },
          )

          expect(ret.pnlMaker).to.equal(0)
          expect(ret.pnlLong).to.equal(0)
          expect(ret.pnlShort).to.equal(0)

          expect(value.makerValue._value).to.equal(0)
          expect(value.longValue._value).to.equal(0)
          expect(value.shortValue._value).to.equal(0)
        })
      })

      context('positive price change', () => {
        context('no maker exposure', () => {
          it('accumulates pnl to long/shorts', async () => {
            await version.store(DEFAULT_VERSION)

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
                pController: { min: 0, max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret.pnlMaker).to.equal(parse6decimal('0'))
            expect(ret.pnlLong).to.equal(parse6decimal('18'))
            expect(ret.pnlShort).to.equal(parse6decimal('-18'))

            expect(value.makerValue._value).to.equal(0)
            expect(value.longValue._value).to.equal(parse6decimal('2'))
            expect(value.shortValue._value).to.equal(parse6decimal('-2'))
          })
        })

        context('maker long exposure', () => {
          it('accumulates pnl to long/shorts/makers', async () => {
            await version.store(DEFAULT_VERSION)

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
                pController: { min: 0, max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret.pnlMaker).to.equal(parse6decimal('14'))
            expect(ret.pnlLong).to.equal(parse6decimal('4'))
            expect(ret.pnlShort).to.equal(parse6decimal('-18'))

            expect(value.makerValue._value).to.equal(parse6decimal('1.4'))
            expect(value.longValue._value).to.equal(parse6decimal('2'))
            expect(value.shortValue._value).to.equal(parse6decimal('-2'))
          })
        })

        context('maker short exposure', () => {
          it('accumulates pnl to long/shorts/makers', async () => {
            await version.store(DEFAULT_VERSION)

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
                pController: { min: 0, max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret.pnlMaker).to.equal(parse6decimal('-10'))
            expect(ret.pnlLong).to.equal(parse6decimal('40'))
            expect(ret.pnlShort).to.equal(parse6decimal('-30'))

            expect(value.makerValue._value).to.equal(parse6decimal('-2'))
            expect(value.longValue._value).to.equal(parse6decimal('2'))
            expect(value.shortValue._value).to.equal(parse6decimal('-2'))
          })
        })
      })

      context('negative price change', () => {
        context('no maker exposure', () => {
          it('accumulates pnl to long/shorts', async () => {
            await version.store(DEFAULT_VERSION)

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
                pController: { min: 0, max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret.pnlMaker).to.equal(parse6decimal('0'))
            expect(ret.pnlLong).to.equal(parse6decimal('-18'))
            expect(ret.pnlShort).to.equal(parse6decimal('18'))

            expect(value.makerValue._value).to.equal(0)
            expect(value.longValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortValue._value).to.equal(parse6decimal('2'))
          })
        })

        context('maker long exposure', () => {
          it('accumulates 0 pnl', async () => {
            await version.store(DEFAULT_VERSION)

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
                pController: { min: 0, max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret.pnlMaker).to.equal(parse6decimal('-14'))
            expect(ret.pnlLong).to.equal(parse6decimal('-4'))
            expect(ret.pnlShort).to.equal(parse6decimal('18'))

            expect(value.makerValue._value).to.equal(parse6decimal('-1.4'))
            expect(value.longValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortValue._value).to.equal(parse6decimal('2'))
          })
        })

        context('maker short exposure', () => {
          it('accumulates pnl to long/shorts/makers', async () => {
            await version.store(DEFAULT_VERSION)

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
                pController: { min: 0, max: 0, k: parse6decimal('999999') },
                utilizationCurve: {
                  minRate: 0,
                  maxRate: 0,
                  targetRate: 0,
                  targetUtilization: parse6decimal('0.8'),
                },
              },
            )

            expect(ret.pnlMaker).to.equal(parse6decimal('10'))
            expect(ret.pnlLong).to.equal(parse6decimal('-40'))
            expect(ret.pnlShort).to.equal(parse6decimal('30'))

            expect(value.makerValue._value).to.equal(parse6decimal('2'))
            expect(value.longValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortValue._value).to.equal(parse6decimal('2'))
          })
        })
      })
    })

    describe('global accumulator', () => {
      it('returns updated global accumulator values', async () => {
        await version.store(DEFAULT_VERSION)

        const { nextGlobal } = await accumulateWithReturn(
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
            pController: { min: 0, max: 0, k: parse6decimal('999999') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: parse6decimal('0.8'),
            },
          },
        )

        expect(nextGlobal.pAccumulator._value).to.equal(0)
        expect(nextGlobal.pAccumulator._skew).to.equal('-1000000')
      })
    })
  })
})
