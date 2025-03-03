import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  IMarket__factory,
  VersionLib,
  VersionLib__factory,
  VersionStorageLib,
  VersionStorageLib__factory,
  VersionTester,
  VersionTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import {
  DEFAULT_ORDER,
  DEFAULT_VERSION,
  DEFAULT_GUARANTEE,
  parse6decimal,
  DEFAULT_ORACLE_RECEIPT,
  DEFAULT_CONTEXT,
  DEFAULT_SETTLEMENT_CONTEXT,
} from '../../../../common/testutil/types'
import {
  GlobalStruct,
  MarketParameterStruct,
  OrderStruct,
  GuaranteeStruct,
  PositionStruct,
  RiskParameterStruct,
  VersionStruct,
} from '../../../types/generated/contracts/Market'
import { OracleReceiptStruct, OracleVersionStruct } from '../../../types/generated/contracts/interfaces/IOracleProvider'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { VALID_RISK_PARAMETER } from './RiskParameter.test'

const { ethers } = HRE
use(smock.matchers)

const VALID_VERSION: VersionStruct = {
  valid: true,
  price: 18,
  makerPosExposure: 21,
  makerNegExposure: 22,
  longPosExposure: 23,
  longNegExposure: 24,
  shortPosExposure: 25,
  shortNegExposure: 26,
  makerPreValue: { _value: 1 },
  longPreValue: { _value: 2 },
  shortPreValue: { _value: 3 },
  makerCloseValue: { _value: 8 },
  longCloseValue: { _value: 9 },
  shortCloseValue: { _value: 10 },
  longPostValue: { _value: 11 },
  shortPostValue: { _value: 12 },
  spreadPos: { _value: 6 },
  spreadNeg: { _value: 7 },
  makerFee: { _value: 14 },
  takerFee: { _value: 16 },
  settlementFee: { _value: -8 },
  liquidationFee: { _value: -9 },
}

const GLOBAL: GlobalStruct = {
  currentId: 1,
  latestId: 8,
  protocolFee: 2,
  oracleFee: 3,
  riskFee: 4,
  pAccumulator: {
    _value: 6,
    _skew: 7,
  },
  latestPrice: 9,
}

const FROM_POSITION: PositionStruct = {
  timestamp: 2,
  maker: 3,
  long: 4,
  short: 5,
}

const ORDER_ID: BigNumber = BigNumber.from(17)

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
  invalidation: 1,
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
    orderId: BigNumber,
    order: OrderStruct,
    guarantee: GuaranteeStruct,
    fromOracleVersion: OracleVersionStruct,
    toOracleVersion: OracleVersionStruct,
    toOracleReceipt: OracleReceiptStruct,
    marketParameter: MarketParameterStruct,
    riskParameter: RiskParameterStruct,
  ) => {
    const marketInterface = new ethers.utils.Interface(IMarket__factory.abi)
    const accumulationResult = await version.callStatic.accumulate(
      {
        ...DEFAULT_CONTEXT,
        marketParameter,
        riskParameter,
        global,
        latestPositionGlobal: fromPosition,
        latestOracleVersion: fromOracleVersion,
      },
      {
        ...DEFAULT_SETTLEMENT_CONTEXT,
        orderOracleVersion: fromOracleVersion,
      },
      orderId,
      order,
      guarantee,
      toOracleVersion,
      toOracleReceipt,
    )
    const tx = await version.accumulate(
      {
        ...DEFAULT_CONTEXT,
        marketParameter,
        riskParameter,
        global,
        latestPositionGlobal: fromPosition,
        latestOracleVersion: fromOracleVersion,
      },
      {
        ...DEFAULT_SETTLEMENT_CONTEXT,
        orderOracleVersion: fromOracleVersion,
      },
      orderId,
      order,
      guarantee,
      toOracleVersion,
      toOracleReceipt,
    )
    const result = await tx.wait()
    const value = await version.read()
    return {
      ret: marketInterface.parseLog(result.events![0]).args.accumulationResult,
      value,
      nextGlobal: accumulationResult[0],
      rsp: accumulationResult[1],
    }
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
      expect(value.price).to.equal(18)
      expect(value.makerPosExposure).to.equal(21)
      expect(value.makerNegExposure).to.equal(22)
      expect(value.longPosExposure).to.equal(23)
      expect(value.longNegExposure).to.equal(24)
      expect(value.shortPosExposure).to.equal(25)
      expect(value.shortNegExposure).to.equal(26)
      expect(value.makerPreValue._value).to.equal(1)
      expect(value.longPreValue._value).to.equal(2)
      expect(value.shortPreValue._value).to.equal(3)
      expect(value.makerCloseValue._value).to.equal(8)
      expect(value.longCloseValue._value).to.equal(9)
      expect(value.shortCloseValue._value).to.equal(10)
      expect(value.longPostValue._value).to.equal(11)
      expect(value.shortPostValue._value).to.equal(12)
      expect(value.spreadPos._value).to.equal(6)
      expect(value.spreadNeg._value).to.equal(7)
      expect(value.makerFee._value).to.equal(14)
      expect(value.takerFee._value).to.equal(16)
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

    describe('.price', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          price: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.price).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          price: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await version.read()
        expect(value.price).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            price: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            price: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerPosExposure', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerPosExposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.makerPosExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerPosExposure: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await version.read()
        expect(value.makerPosExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPosExposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPosExposure: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerNegExposure', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerNegExposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.makerNegExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerNegExposure: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await version.read()
        expect(value.makerNegExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerNegExposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerNegExposure: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.longPosExposure', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          longPosExposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.longPosExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longPosExposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.longNegExposure', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          longNegExposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.longNegExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longNegExposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.shortPosExposure', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          shortPosExposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.shortPosExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortPosExposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.shortNegExposure', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range', async () => {
        await version.store({
          ...VALID_VERSION,
          shortNegExposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await version.read()
        expect(value.shortNegExposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortNegExposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerPreValue', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerPreValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerPreValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.longPreValue', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          longPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.longPreValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          longPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.longPreValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.shortPreValue', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.shortPreValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.shortPreValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortPreValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerCloseValue', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerCloseValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerCloseValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.longCloseValue', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          longCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.longCloseValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          longCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.longCloseValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.shortCloseValue', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.shortCloseValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.shortCloseValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortCloseValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.longPostValue', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          longPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.longPostValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          longPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.longPostValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            longPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.shortPostValue', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.shortPostValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          shortPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.shortPostValue._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            shortPostValue: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.spreadPos', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          spreadPos: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.spreadPos._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          spreadPos: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.spreadPos._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            spreadPos: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            spreadPos: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.spreadNeg', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          spreadNeg: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.spreadNeg._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          spreadNeg: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.spreadNeg._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            spreadNeg: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            spreadNeg: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.makerFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.makerFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          makerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.makerFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            makerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })
    })

    describe('.takerFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) },
        })
        const value = await version.read()
        expect(value.takerFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await version.store({
          ...VALID_VERSION,
          takerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1) },
        })
        const value = await version.read()
        expect(value.takerFee._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE) },
          }),
        ).to.be.revertedWithCustomError(versionStorageLib, 'VersionStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          version.store({
            ...VALID_VERSION,
            takerFee: { _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1) },
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

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('10'), short: parse6decimal('10'), maker: parse6decimal('10') },
          ORDER_ID,
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          { ...DEFAULT_GUARANTEE },
          ORACLE_VERSION_1,
          ORACLE_VERSION_2,
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('2') },
          {
            ...VALID_MARKET_PARAMETER,
            takerFee: parse6decimal('0.01'),
            closed: true,
          },
          {
            ...VALID_RISK_PARAMETER,
            synBook: {
              d0: parse6decimal('0.1'),
              d1: parse6decimal('0.4'),
              d2: parse6decimal('0.2'),
              d3: parse6decimal('0.3'),
              scale: parse6decimal('100'),
            },
          },
        )

        expect(value.valid).to.be.true
        expect(value.makerPreValue._value).to.equal(1)
        expect(value.longPreValue._value).to.equal(2)
        expect(value.shortPreValue._value).to.equal(3)

        expect(ret.tradeFee).to.equal(BigNumber.from('12300000'))
        expect(ret.subtractiveFee).to.equal(0)
        expect(ret.spreadPos).to.equal(BigNumber.from('14851225'))
        expect(ret.spreadNeg).to.equal(0)
        expect(ret.spreadMaker).to.equal(BigNumber.from('14851225'))
        expect(ret.spreadPreLong).to.equal(0)
        expect(ret.spreadPreShort).to.equal(0)
        expect(ret.spreadCloseLong).to.equal(0)
        expect(ret.spreadCloseShort).to.equal(0)
        expect(ret.spreadPostLong).to.equal(0)
        expect(ret.spreadPostShort).to.equal(0)
        expect(ret.fundingMaker).to.equal(0)
        expect(ret.fundingLong).to.equal(0)
        expect(ret.fundingShort).to.equal(0)
        expect(ret.fundingFee).to.equal(0)
        expect(ret.interestMaker).to.equal(0)
        expect(ret.interestLong).to.equal(0)
        expect(ret.interestShort).to.equal(0)
        expect(ret.interestFee).to.equal(0)
        expect(ret.pnlMaker).to.equal(0)
        expect(ret.pnlLong).to.equal(0)
        expect(ret.pnlShort).to.equal(0)
        expect(ret.settlementFee).to.equal(parse6decimal('2'))
        expect(ret.liquidationFee).to.equal(9 * 2)
      })
    })

    describe('.valid', () => {
      context('invalid toOracleVersion', () => {
        it('marks version invalid', async () => {
          await version.store(VALID_VERSION)
          await accumulateWithReturn(
            GLOBAL,
            FROM_POSITION,
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            { ...ORACLE_VERSION_2, valid: false },
            DEFAULT_ORACLE_RECEIPT,
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
          await accumulateWithReturn(
            GLOBAL,
            FROM_POSITION,
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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
          await accumulateWithReturn(
            GLOBAL,
            FROM_POSITION,
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
            { ...VALID_MARKET_PARAMETER, closed: true },
            VALID_RISK_PARAMETER,
          )

          const value = await version.read()
          expect(value.valid).to.be.true
        })
      })
    })

    describe('.price', () => {
      it('saves price', async () => {
        await version.store(VALID_VERSION)
        await accumulateWithReturn(
          GLOBAL,
          FROM_POSITION,
          ORDER_ID,
          ORDER,
          { ...DEFAULT_GUARANTEE },
          ORACLE_VERSION_1,
          { ...ORACLE_VERSION_2, valid: false },
          DEFAULT_ORACLE_RECEIPT,
          VALID_MARKET_PARAMETER,
          VALID_RISK_PARAMETER,
        )

        const value = await version.read()
        expect(value.price).to.be.equal(ORACLE_VERSION_2.price)
      })
    })

    describe('settlement fee accumulation', () => {
      const riskParameters = {
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
      }

      let position = {
        ...FROM_POSITION,
        maker: parse6decimal('13'),
        long: parse6decimal('83'),
        short: parse6decimal('5'),
      }

      const order = {
        ...ORDER,
        orders: 0,
        makerNeg: 0,
        makerPos: 0,
        longPos: 0,
        longNeg: 0,
        shortPos: 0,
        shortNeg: 0,
        makerReferral: 0,
        takerReferral: 0,
      }

      beforeEach(async () => {
        // set an initial state with a meaningful position
        await version.store(VALID_VERSION)
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          { ...order, orders: 1, makerPos: parse6decimal('4') },
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.05') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )
        expect(value.settlementFee._value).to.equal(parse6decimal('-0.05')) // 0 - (0.05 / 1)
        expect(ret.settlementFee).to.equal(parse6decimal('0.05')) // market parameter

        // update initial state prior to the test
        position = { ...position, maker: position.maker.add(parse6decimal('4')) }
      })

      it('allocates zero orders', async () => {
        // allocate zero orders to ensure fee is zero
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          order,
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.04') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )
        expect(value.settlementFee._value).to.equal(0)
        expect(ret.settlementFee).to.equal(0)
      })

      it('allocates single order', async () => {
        // accumulate single order to decrease short position by 2 without changing settlement fee
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          { ...order, orders: 1, shortNeg: parse6decimal('2') },
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.05') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )
        expect(value.settlementFee._value).to.equal(parse6decimal('-0.05'))
        expect(ret.settlementFee).to.equal(parse6decimal('0.05'))
      })

      it('allocates multiple orders', async () => {
        // accumulate multiple orders with an increase in settlement fee
        const orderCount = 4
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          {
            ...order,
            orders: orderCount,
            makerNeg: parse6decimal('3'),
            longPos: parse6decimal('6'),
            shortPos: parse6decimal('9'),
            shortNeg: parse6decimal('5'),
          },
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.06') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )
        expect(value.settlementFee._value).to.equal(parse6decimal('-0.06').div(orderCount))
        expect(ret.settlementFee).to.equal(parse6decimal('0.06'))
      })

      it('skips guarantee orders', async () => {
        // accumulate multiple orders with an increase in settlement fee
        const orderCount = 4
        const guaranteeCount = 2
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          {
            ...order,
            orders: orderCount,
            makerNeg: parse6decimal('3'),
            longPos: parse6decimal('6'),
            shortPos: parse6decimal('9'),
            shortNeg: parse6decimal('5'),
          },
          { ...DEFAULT_GUARANTEE, orders: guaranteeCount },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.06') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )
        expect(value.settlementFee._value).to.equal(parse6decimal('-0.06').div(orderCount - guaranteeCount))
        expect(ret.settlementFee).to.equal(parse6decimal('0.06'))
      })
    })

    describe('liquidation fee accumulation', () => {
      let riskParameters = {
        ...VALID_RISK_PARAMETER,
        pController: { min: 0, max: 0, k: parse6decimal('1') },
        liquidationFee: parse6decimal('5.00'),
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
      }

      const position = {
        ...FROM_POSITION,
        maker: parse6decimal('6'),
        long: parse6decimal('9'),
        short: parse6decimal('3'),
      }

      const order = {
        ...ORDER,
        orders: 1,
        makerNeg: 0,
        makerPos: 0,
        longPos: parse6decimal('1'),
        longNeg: 0,
        shortPos: 0,
        shortNeg: 0,
        makerReferral: 0,
        takerReferral: 0,
      }

      it('allocates without fee change', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          order,
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.05') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )

        expect(value.liquidationFee._value).to.equal(parse6decimal('-0.25'))
        expect(ret.liquidationFee).to.equal(parse6decimal('0.25'))
      })

      it('allocates with a reduced fee', async () => {
        await version.store(VALID_VERSION)

        riskParameters = { ...riskParameters, liquidationFee: parse6decimal('4.00') }
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          order,
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2 },
          { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('0.05') },
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )

        expect(value.liquidationFee._value).to.equal(parse6decimal('-0.20'))
        expect(ret.liquidationFee).to.equal(parse6decimal('0.20'))
      })

      it('handles invalid oracle version', async () => {
        await version.store(VALID_VERSION)

        riskParameters = { ...riskParameters, liquidationFee: parse6decimal('0.175') }
        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          position,
          ORDER_ID,
          order,
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1 },
          { ...ORACLE_VERSION_2, valid: false },
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER },
          riskParameters,
        )

        expect(value.liquidationFee._value).to.equal(0)
        expect(ret.liquidationFee).to.equal(0)
      })
    })

    describe('price impact accumulation', () => {
      it('allocates', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('12'), short: parse6decimal('16'), maker: parse6decimal('20') },
          ORDER_ID,
          {
            ...ORDER,
            makerPos: parse6decimal('6'),
            makerNeg: parse6decimal('2'),
            longPos: parse6decimal('3'),
            longNeg: parse6decimal('4'),
            shortPos: parse6decimal('6'),
            shortNeg: parse6decimal('5'),
            makerReferral: 0,
            takerReferral: 0,
          },
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1, price: parse6decimal('123') },
          { ...ORACLE_VERSION_2 },
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER, makerFee: parse6decimal('0.00'), takerFee: parse6decimal('0.00') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
            synBook: {
              d0: parse6decimal('0.001'),
              d1: parse6decimal('0.002'),
              d2: parse6decimal('0.004'),
              d3: parse6decimal('0.008'),
              scale: parse6decimal('10'),
            },
          },
        )

        // starting skew -4

        // maker 10->8
        const spreadClose = parse6decimal('0.006179') // -4 -> -4.4

        // long 12 -> 15, short 16 -> 11
        const spreadTakerPos = parse6decimal('0.955135') // -4 -> 4 (rounding error -1)

        // short 16 -> 22, long 12 -> 8
        const spreadTakerNeg = parse6decimal('18.785059') // -4.4 -> -14.4

        // long 11, short 17, maker 18 -> 24
        const spreadOpen = parse6decimal('0.10347') // 4 -> 5.5

        const exposurePos = parse6decimal('9.5')
        const exposureNeg = parse6decimal('10.4')

        expect(value.makerPosExposure).to.equal(parse6decimal('0.25'))
        expect(value.makerNegExposure).to.equal(parse6decimal('0.2'))
        expect(value.longPosExposure).to.equal(parse6decimal('1'))
        expect(value.longNegExposure).to.equal(parse6decimal('1'))
        expect(value.shortPosExposure).to.equal(parse6decimal('-1'))
        expect(value.shortNegExposure).to.equal(parse6decimal('-1'))

        const spreadPos = spreadTakerPos.add(spreadOpen).mul(parse6decimal('1')).div(exposurePos)
        const spreadNeg = spreadClose.add(spreadTakerNeg).mul(parse6decimal('1')).div(exposureNeg)

        expect(value.spreadPos._value).to.equal(-spreadPos.add(1))
        expect(value.spreadNeg._value).to.equal(-spreadNeg.add(1))

        const makerCloseValue = spreadTakerPos
          .add(spreadOpen)
          .add(spreadClose)
          .add(spreadTakerNeg)
          .mul(parse6decimal('1'))
          .div(parse6decimal('18'))

        expect(value.makerPreValue._value).to.equal(1)
        expect(value.longPreValue._value).to.equal(2)
        expect(value.shortPreValue._value).to.equal(3)
        expect(value.makerCloseValue._value).to.equal(makerCloseValue.add(8))
        expect(value.longCloseValue._value).to.equal(9)
        expect(value.shortCloseValue._value).to.equal(10)
        expect(value.longPostValue._value).to.equal(11)
        expect(value.shortPostValue._value).to.equal(12)

        expect(ret.spreadPos).to.equal(spreadTakerPos.add(spreadOpen))
        expect(ret.spreadNeg).to.equal(spreadClose.add(spreadTakerNeg))
        expect(ret.spreadMaker).to.equal(spreadTakerPos.add(spreadOpen).add(spreadClose).add(spreadTakerNeg))
        expect(ret.spreadPreLong).to.equal(0)
        expect(ret.spreadPreShort).to.equal(0)
        expect(ret.spreadCloseLong).to.equal(0)
        expect(ret.spreadCloseShort).to.equal(0)
        expect(ret.spreadPostLong).to.equal(0)
        expect(ret.spreadPostShort).to.equal(0)
      })

      it('allocates when guarentees', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('12'), short: parse6decimal('16'), maker: parse6decimal('20') },
          ORDER_ID,
          {
            ...ORDER,
            makerPos: parse6decimal('6'),
            makerNeg: parse6decimal('2'),
            longPos: parse6decimal('4'), // 3
            longNeg: parse6decimal('6'), // 4
            shortPos: parse6decimal('9'), // 6
            shortNeg: parse6decimal('9'), // 5
            makerReferral: 0,
            takerReferral: 0,
          },
          {
            ...DEFAULT_GUARANTEE,
            longPos: parse6decimal('1'),
            longNeg: parse6decimal('2'),
            shortPos: parse6decimal('3'),
            shortNeg: parse6decimal('4'),
          },
          { ...ORACLE_VERSION_1, price: parse6decimal('123') },
          { ...ORACLE_VERSION_2 },
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER, makerFee: parse6decimal('0.00'), takerFee: parse6decimal('0.00') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
            synBook: {
              d0: parse6decimal('0.001'),
              d1: parse6decimal('0.002'),
              d2: parse6decimal('0.004'),
              d3: parse6decimal('0.008'),
              scale: parse6decimal('10'),
            },
          },
        )

        // starting skew -4

        // maker 10->8
        const spreadClose = parse6decimal('0.006179') // -4 -> -4.4

        // long 12 -> 15, short 16 -> 11
        const spreadTakerPos = parse6decimal('0.955135') // -4 -> 4 (rounding error -1)

        // short 16 -> 22, long 12 -> 8
        const spreadTakerNeg = parse6decimal('18.785059') // -4.4 -> -14.4

        // long 11, short 17, maker 18 -> 24
        const spreadOpen = parse6decimal('0.10347') // 4 -> 5.5

        const exposurePos = parse6decimal('9.5')
        const exposureNeg = parse6decimal('10.4')

        expect(value.makerPosExposure).to.equal(parse6decimal('0.25'))
        expect(value.makerNegExposure).to.equal(parse6decimal('0.2'))
        expect(value.longPosExposure).to.equal(parse6decimal('1'))
        expect(value.longNegExposure).to.equal(parse6decimal('1'))
        expect(value.shortPosExposure).to.equal(parse6decimal('-1'))
        expect(value.shortNegExposure).to.equal(parse6decimal('-1'))

        const spreadPos = spreadTakerPos.add(spreadOpen).mul(parse6decimal('1')).div(exposurePos)
        const spreadNeg = spreadClose.add(spreadTakerNeg).mul(parse6decimal('1')).div(exposureNeg)

        expect(value.spreadPos._value).to.equal(-spreadPos.add(1))
        expect(value.spreadNeg._value).to.equal(-spreadNeg.add(1))

        const makerCloseValue = spreadTakerPos
          .add(spreadOpen)
          .add(spreadClose)
          .add(spreadTakerNeg)
          .mul(parse6decimal('1'))
          .div(parse6decimal('18'))

        expect(value.makerPreValue._value).to.equal(1)
        expect(value.longPreValue._value).to.equal(2)
        expect(value.shortPreValue._value).to.equal(3)
        expect(value.makerCloseValue._value).to.equal(makerCloseValue.add(8))
        expect(value.longCloseValue._value).to.equal(9)
        expect(value.shortCloseValue._value).to.equal(10)
        expect(value.longPostValue._value).to.equal(11)
        expect(value.shortPostValue._value).to.equal(12)

        expect(ret.spreadPos).to.equal(spreadTakerPos.add(spreadOpen))
        expect(ret.spreadNeg).to.equal(spreadClose.add(spreadTakerNeg))
        expect(ret.spreadMaker).to.equal(spreadTakerPos.add(spreadOpen).add(spreadClose).add(spreadTakerNeg))
        expect(ret.spreadPreLong).to.equal(0)
        expect(ret.spreadPreShort).to.equal(0)
        expect(ret.spreadCloseLong).to.equal(0)
        expect(ret.spreadCloseShort).to.equal(0)
        expect(ret.spreadPostLong).to.equal(0)
        expect(ret.spreadPostShort).to.equal(0)
      })
    })

    describe('fee accumulation', () => {
      it('allocates when no makers', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('20'), short: parse6decimal('30'), maker: 0 },
          ORDER_ID,
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
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER, makerFee: parse6decimal('0.02'), takerFee: parse6decimal('0.01') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
          },
        )

        const makerFee = parse6decimal('0.2') // 10 * 0.02
        const takerFee = parse6decimal('1.1') // 110 * 0.01
        const fee = makerFee.add(takerFee).mul(123)

        expect(value.makerFee._value).to.equal(makerFee.mul(-1).mul(123).div(10))
        expect(value.takerFee._value).to.equal(takerFee.mul(-1).mul(123).div(110))
        expect(value.settlementFee._value).to.equal(0)
        expect(ret.tradeFee).to.equal(fee)
      })

      it('allocates when makers', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, long: parse6decimal('20'), short: parse6decimal('30'), maker: parse6decimal('50') },
          // longSoc = min(50+30,20) = 20  shortSoc = min(50+20,30) = 30  takerSoc = min(major,minor)+50 = min(30,20)+50 = 70
          ORDER_ID,
          {
            ...ORDER,
            makerNeg: parse6decimal('10'),
            makerPos: parse6decimal('20'), // +10 -> 60 maker
            longPos: parse6decimal('30'),
            longNeg: parse6decimal('10'), // +20 -> 40 long
            shortPos: parse6decimal('50'),
            shortNeg: parse6decimal('20'), // +30 -> 60 short
            // takerPos = 50, takerNeg = 60
            makerReferral: 0,
            takerReferral: 0,
          },
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER, makerFee: parse6decimal('0.02'), takerFee: parse6decimal('0.01') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
          },
        )

        const makerFee = parse6decimal('0.6') // 30 * 0.02
        const takerFee = parse6decimal('1.1') // 110 * 0.01
        const fee = makerFee.add(takerFee).mul(123)

        expect(value.makerFee._value).to.equal(makerFee.mul(-1).mul(123).div(30))
        expect(value.takerFee._value).to.equal(takerFee.mul(-1).mul(123).div(110))
        expect(value.settlementFee._value).to.equal(0)

        expect(ret.tradeFee).to.equal(fee)
      })

      it('allocates when makers and referrals', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, maker: parse6decimal('10'), long: parse6decimal('12'), short: parse6decimal('8') },
          ORDER_ID,
          {
            ...ORDER,
            makerPos: parse6decimal('22'),
            makerNeg: parse6decimal('2'), // +20 maker -> 30 maker
            longPos: parse6decimal('28'),
            longNeg: parse6decimal('3'), // +25 long -> 37 long
            shortPos: parse6decimal('4'),
            shortNeg: parse6decimal('2'), // +2 short -> 10 short
            makerReferral: parse6decimal('0.025'),
            takerReferral: parse6decimal('0.0125'),
          },
          { ...DEFAULT_GUARANTEE },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 }, // price 123
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER, makerFee: parse6decimal('0.02'), takerFee: parse6decimal('0.01') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
          },
        )

        // (makerpos+makerneg) * 0.02 * price = 24 * 0.02 * 123
        const makerFee = parse6decimal('59.04')
        // makerFee * makerReferral / makerTotal
        const makerSubtractiveFee = makerFee.mul(parse6decimal('0.025')).div(24).div(1e6)
        // (longpos+longneg+shortpos+shortneg) * 0.01 * price = (31+6) * 0.01 * 123
        const takerFee = parse6decimal('45.51')
        // takerFee * takerReferral / takerTotal
        const takerSubtractiveFee = takerFee.mul(parse6decimal('0.0125')).div(37).div(1e6)
        const fee = makerFee.add(takerFee).sub(makerSubtractiveFee).sub(takerSubtractiveFee)

        // makerFee * -1 / makerTotal
        expect(value.makerFee._value).to.equal(makerFee.mul(-1).div(24))
        // takerFee * -1 / takerTotal = takerFee / (31+6)
        expect(value.takerFee._value).to.equal(takerFee.mul(-1).div(37))
        expect(value.settlementFee._value).to.equal(0)
        expect(ret.tradeFee).to.equal(fee)
      })

      it('allocates when makers and guarantees with takerFee', async () => {
        await version.store(VALID_VERSION)

        const { ret, value } = await accumulateWithReturn(
          GLOBAL,
          { ...FROM_POSITION, maker: parse6decimal('38'), long: parse6decimal('33'), short: parse6decimal('40') },
          ORDER_ID,
          {
            ...ORDER,
            makerPos: parse6decimal('4'),
            makerNeg: parse6decimal('6'), // -2 maker -> 36 maker
            longPos: parse6decimal('5'),
            longNeg: parse6decimal('8'), // -3 long -> 30 long
            shortPos: parse6decimal('10'),
            shortNeg: parse6decimal('2'), // +8 short -> 48 short
            makerReferral: 0,
            takerReferral: 0,
          },
          {
            ...DEFAULT_GUARANTEE,
            longPos: parse6decimal('2'),
            longNeg: parse6decimal('3'),
            takerFee: parse6decimal('1.50'),
          },
          { ...ORACLE_VERSION_1, price: parse6decimal('121') },
          { ...ORACLE_VERSION_2 },
          DEFAULT_ORACLE_RECEIPT,
          { ...VALID_MARKET_PARAMETER, makerFee: parse6decimal('0.02'), takerFee: parse6decimal('0.01') },
          {
            ...VALID_RISK_PARAMETER,
            pController: { min: 0, max: 0, k: parse6decimal('1') },
            utilizationCurve: {
              minRate: 0,
              maxRate: 0,
              targetRate: 0,
              targetUtilization: 0,
            },
          },
        )

        // (makerpos+makerneg) * 0.02 * price = 10 * 0.02 * 123
        const makerFee = parse6decimal('24.6')
        // (longpos+longneg+shortpos+shortneg - guarantee.takerFee) * 0.01 * price = (13+12-1.5) * 0.01 * 123
        const takerFee = parse6decimal('28.905')
        const fee = makerFee.add(takerFee)

        // makerFee * -1 / makerTotal
        expect(value.makerFee._value).to.equal(makerFee.mul(-1).div(10))
        // takerFee * -1 / (takerTotal - guarantee.takerFee)
        expect(value.takerFee._value).to.equal(takerFee.mul(-1).mul(1e6).div(parse6decimal('23.5')))
        expect(value.settlementFee._value).to.equal(0)
        expect(ret.tradeFee).to.equal(fee)
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_1,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(0)
          expect(value.longPreValue._value).to.equal(0)
          expect(value.shortPreValue._value).to.equal(0)
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
            ORDER_ID,
            {
              ...ORDER,
              makerPos: ORDER.makerPos,
              makerNeg: 0,
            },
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(0)
          expect(value.longPreValue._value).to.equal(0)
          expect(value.shortPreValue._value).to.equal(0)
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(BigNumber.from('58'))
          expect(value.longPreValue._value).to.equal(BigNumber.from('-149'))
          expect(value.shortPreValue._value).to.equal(BigNumber.from('146'))
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(BigNumber.from('-60'))
          expect(value.longPreValue._value).to.equal(BigNumber.from('-150'))
          expect(value.shortPreValue._value).to.equal(BigNumber.from('146'))
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(BigNumber.from('58'))
          expect(value.longPreValue._value).to.equal(BigNumber.from('146'))
          expect(value.shortPreValue._value).to.equal(BigNumber.from('-149'))
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_1,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(0)
          expect(value.longPreValue._value).to.equal(0)
          expect(value.shortPreValue._value).to.equal(0)
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(parse6decimal('0.001376'))
          expect(value.longPreValue._value).to.equal(parse6decimal('-0.001003'))
          expect(value.shortPreValue._value).to.equal(parse6decimal('-0.001003'))
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(parse6decimal('0.000688'))
          expect(value.longPreValue._value).to.equal(parse6decimal('-0.0014041'))
          expect(value.shortPreValue._value).to.equal(parse6decimal('-0.001405'))
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(0)
          expect(value.longPreValue._value).to.equal(0)
          expect(value.shortPreValue._value).to.equal(0)
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
            ORDER_ID,
            ORDER,
            { ...DEFAULT_GUARANTEE },
            ORACLE_VERSION_1,
            ORACLE_VERSION_2,
            DEFAULT_ORACLE_RECEIPT,
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

          expect(value.makerPreValue._value).to.equal(0)
          expect(value.longPreValue._value).to.equal(0)
          expect(value.shortPreValue._value).to.equal(0)
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
              ORDER_ID,
              ORDER,
              { ...DEFAULT_GUARANTEE },
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('2')),
              },
              DEFAULT_ORACLE_RECEIPT,
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

            expect(ret.pnlMaker).to.equal(parse6decimal('0'))
            expect(ret.pnlLong).to.equal(parse6decimal('18'))
            expect(ret.pnlShort).to.equal(parse6decimal('-18'))

            expect(value.makerPreValue._value).to.equal(0)
            expect(value.longPreValue._value).to.equal(parse6decimal('2'))
            expect(value.shortPreValue._value).to.equal(parse6decimal('-2'))
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
              ORDER_ID,
              ORDER,
              { ...DEFAULT_GUARANTEE },
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('2')),
              },
              DEFAULT_ORACLE_RECEIPT,
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

            expect(ret.pnlMaker).to.equal(parse6decimal('14'))
            expect(ret.pnlLong).to.equal(parse6decimal('4'))
            expect(ret.pnlShort).to.equal(parse6decimal('-18'))

            expect(value.makerPreValue._value).to.equal(parse6decimal('1.4'))
            expect(value.longPreValue._value).to.equal(parse6decimal('2'))
            expect(value.shortPreValue._value).to.equal(parse6decimal('-2'))
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
              ORDER_ID,
              ORDER,
              { ...DEFAULT_GUARANTEE },
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('2')),
              },
              DEFAULT_ORACLE_RECEIPT,
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

            expect(ret.pnlMaker).to.equal(parse6decimal('-10'))
            expect(ret.pnlLong).to.equal(parse6decimal('40'))
            expect(ret.pnlShort).to.equal(parse6decimal('-30'))

            expect(value.makerPreValue._value).to.equal(parse6decimal('-2'))
            expect(value.longPreValue._value).to.equal(parse6decimal('2'))
            expect(value.shortPreValue._value).to.equal(parse6decimal('-2'))
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
              ORDER_ID,
              ORDER,
              { ...DEFAULT_GUARANTEE },
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('-2')),
              },
              DEFAULT_ORACLE_RECEIPT,
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

            expect(ret.pnlMaker).to.equal(parse6decimal('0'))
            expect(ret.pnlLong).to.equal(parse6decimal('-18'))
            expect(ret.pnlShort).to.equal(parse6decimal('18'))

            expect(value.makerPreValue._value).to.equal(0)
            expect(value.longPreValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortPreValue._value).to.equal(parse6decimal('2'))
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
              ORDER_ID,
              ORDER,
              { ...DEFAULT_GUARANTEE },
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('-2')),
              },
              DEFAULT_ORACLE_RECEIPT,
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

            expect(ret.pnlMaker).to.equal(parse6decimal('-14'))
            expect(ret.pnlLong).to.equal(parse6decimal('-4'))
            expect(ret.pnlShort).to.equal(parse6decimal('18'))

            expect(value.makerPreValue._value).to.equal(parse6decimal('-1.4'))
            expect(value.longPreValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortPreValue._value).to.equal(parse6decimal('2'))
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
              ORDER_ID,
              ORDER,
              { ...DEFAULT_GUARANTEE },
              ORACLE_VERSION_1,
              {
                ...ORACLE_VERSION_2,
                price: PRICE.add(parse6decimal('-2')),
              },
              DEFAULT_ORACLE_RECEIPT,
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

            expect(ret.pnlMaker).to.equal(parse6decimal('10'))
            expect(ret.pnlLong).to.equal(parse6decimal('-40'))
            expect(ret.pnlShort).to.equal(parse6decimal('30'))

            expect(value.makerPreValue._value).to.equal(parse6decimal('2'))
            expect(value.longPreValue._value).to.equal(parse6decimal('-2'))
            expect(value.shortPreValue._value).to.equal(parse6decimal('2'))
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
          ORDER_ID,
          ORDER,
          { ...DEFAULT_GUARANTEE },
          ORACLE_VERSION_1,
          ORACLE_VERSION_2,
          DEFAULT_ORACLE_RECEIPT,
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

      it('updates latestPrice', async () => {
        await version.store(DEFAULT_VERSION)

        const { nextGlobal } = await accumulateWithReturn(
          GLOBAL,
          {
            ...FROM_POSITION,
            maker: parse6decimal('10'),
            long: parse6decimal('2'),
            short: parse6decimal('9'),
          },
          ORDER_ID,
          ORDER,
          { ...DEFAULT_GUARANTEE },
          ORACLE_VERSION_1,
          { ...ORACLE_VERSION_2, price: parse6decimal('125') },
          DEFAULT_ORACLE_RECEIPT,
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

        expect(nextGlobal.latestPrice).to.equal(parse6decimal('125'))
      })
    })
  })
})
