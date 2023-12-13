import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { LocalTester, LocalTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import {
  LocalStruct,
  PositionStruct,
  VersionStruct,
  OrderStruct,
  RiskParameterStruct,
  OracleVersionStruct,
} from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

const DEFAULT_LOCAL: LocalStruct = {
  currentId: 0,
  latestId: 0,
  collateral: 0,
  protection: 0,
  protectionAmount: 0,
  protectionInitiator: ethers.constants.AddressZero,
}

const DEFAULT_ADDRESS = '0x0123456789abcdef0123456789abcdef01234567'

describe('Local', () => {
  let owner: SignerWithAddress

  let local: LocalTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    local = await new LocalTester__factory(owner).deploy()
  })

  describe('#store', () => {
    const VALID_STORED_VALUE: LocalStruct = {
      currentId: 1,
      latestId: 5,
      collateral: 2,
      protection: 4,
      protectionAmount: 5,
      protectionInitiator: DEFAULT_ADDRESS,
    }
    it('stores a new value', async () => {
      await local.store(VALID_STORED_VALUE)

      const value = await local.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(5)
      expect(value.collateral).to.equal(2)
      expect(value.protection).to.equal(4)
      expect(value.protectionAmount).to.equal(5)
      expect(value.protectionInitiator.toLowerCase()).to.equal(DEFAULT_ADDRESS)
    })

    context('.currentId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          currentId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.currentId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            currentId: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.latestId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          latestId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.latestId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            latestId: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.collateral', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await local.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if collateral out of range (above)', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })

      it('reverts if collateral out of range (below)', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.protection', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          protection: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.protection).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if version out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            protection: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.protectionAmount', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          protectionAmount: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.protectionAmount).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if amount out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            protectionAmount: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.protectionInitiator', async () => {
      it('saves', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          protectionInitiator: owner.address,
        })
        const value = await local.read()
        expect(value.protectionInitiator).to.equal(owner.address)
      })
    })
  })

  describe('#update', () => {
    it('adds collateral (increase)', async () => {
      await local.store(DEFAULT_LOCAL)

      await local.update(1)

      const value = await local.read()
      expect(value.collateral).to.equal(1)
    })

    it('adds collateral (decrease)', async () => {
      await local.store(DEFAULT_LOCAL)

      await local.update(-1)

      const value = await local.read()
      expect(value.collateral).to.equal(-1)
    })
  })

  describe('#accumulate', () => {
    const FROM_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: parse6decimal('987'),
      long: parse6decimal('654'),
      short: parse6decimal('321'),
      fee: 0, // unused
      keeper: 0, // unused
      collateral: 0, // unused
      delta: 0, // unused
      invalidation: {
        maker: 0, // unused
        long: 0, // unused
        short: 0, // unused
      },
    }

    const TO_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: parse6decimal('123'),
      keeper: parse6decimal('456'),
      collateral: 0, // unused
      delta: 0, // unused
      invalidation: {
        maker: 0, // unused
        long: 0, // unused
        short: 0, // unused
      },
    }

    const FROM_VERSION: VersionStruct = {
      valid: true,
      makerValue: { _value: parse6decimal('100') },
      longValue: { _value: parse6decimal('200') },
      shortValue: { _value: parse6decimal('300') },
    }

    const TO_VERSION: VersionStruct = {
      valid: true,
      makerValue: { _value: parse6decimal('1000') },
      longValue: { _value: parse6decimal('2000') },
      shortValue: { _value: parse6decimal('3000') },
    }

    context('zero initial values', () => {
      beforeEach(async () => {
        await local.store({
          ...DEFAULT_LOCAL,
          currentId: 1,
        })
      })

      it('accumulates values (increase)', async () => {
        const collateralAmount = await local.callStatic.accumulatePnl(1, FROM_POSITION, FROM_VERSION, TO_VERSION)
        await local.accumulatePnl(1, FROM_POSITION, FROM_VERSION, TO_VERSION)
        const valuesFees = await local.callStatic.accumulateFees(TO_POSITION)
        await local.accumulateFees(TO_POSITION)

        const value = await local.read()

        const expectedCollateral = parse6decimal('2932200') // = 900 * 987 + 1800 * 654 + 2700 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')

        expect(collateralAmount).to.equal(expectedCollateral)
        expect(valuesFees.positionFee).to.equal(expectedPositionFee)
        expect(valuesFees.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(1)
        expect(value.latestId).to.equal(1)
        expect(value.collateral).to.equal(expectedCollateral.sub(expectedPositionFee.add(expectedKeeper)))
      })

      it('accumulates values (decrease)', async () => {
        const TO_VERSION_NEG = {
          ...TO_VERSION,
          makerValue: { _value: BigNumber.from(TO_VERSION.makerValue._value).mul(-1) },
          longValue: { _value: BigNumber.from(TO_VERSION.longValue._value).mul(-1) },
          shortValue: { _value: BigNumber.from(TO_VERSION.shortValue._value).mul(-1) },
        }
        const collateralAmount = await local.callStatic.accumulatePnl(1, FROM_POSITION, FROM_VERSION, TO_VERSION_NEG)
        await local.accumulatePnl(1, FROM_POSITION, FROM_VERSION, TO_VERSION_NEG)
        const valuesFees = await local.callStatic.accumulateFees(TO_POSITION)
        await local.accumulateFees(TO_POSITION)

        const value = await local.read()

        const expectedCollateral = parse6decimal('-3583800') // = -1100 * 987 + -2200 * 654 + -3300 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')

        expect(collateralAmount).to.equal(expectedCollateral)
        expect(valuesFees.positionFee).to.equal(expectedPositionFee)
        expect(valuesFees.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(1)
        expect(value.latestId).to.equal(1)
        expect(value.collateral).to.equal(expectedCollateral.sub(expectedPositionFee.add(expectedKeeper)))
      })
    })

    context('non-zero initial values', () => {
      const INITIAL_VALUES = {
        ...DEFAULT_LOCAL,
        currentId: 12,
        latestId: 10,
        collateral: parse6decimal('10'),
        protection: parse6decimal('34'),
      }
      beforeEach(async () => {
        await local.store(INITIAL_VALUES)
      })

      it('accumulates values (increase)', async () => {
        const collateralAmount = await local.callStatic.accumulatePnl(11, FROM_POSITION, FROM_VERSION, TO_VERSION)
        await local.accumulatePnl(11, FROM_POSITION, FROM_VERSION, TO_VERSION)
        const valuesFees = await local.callStatic.accumulateFees(TO_POSITION)
        await local.accumulateFees(TO_POSITION)

        const value = await local.read()

        const expectedCollateral = parse6decimal('2932200') // = 900 * 987 + 1800 * 654 + 2700 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')

        expect(collateralAmount).to.equal(expectedCollateral)
        expect(valuesFees.positionFee).to.equal(expectedPositionFee)
        expect(valuesFees.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(INITIAL_VALUES.currentId)
        expect(value.latestId).to.equal(11)
        expect(value.collateral).to.equal(
          expectedCollateral.add(INITIAL_VALUES.collateral).sub(expectedPositionFee.add(expectedKeeper)),
        )
      })

      it('accumulates values (decrease)', async () => {
        const TO_VERSION_NEG = {
          ...TO_VERSION,
          makerValue: { _value: BigNumber.from(TO_VERSION.makerValue._value).mul(-1) },
          longValue: { _value: BigNumber.from(TO_VERSION.longValue._value).mul(-1) },
          shortValue: { _value: BigNumber.from(TO_VERSION.shortValue._value).mul(-1) },
        }
        const collateralAmount = await local.callStatic.accumulatePnl(11, FROM_POSITION, FROM_VERSION, TO_VERSION_NEG)
        await local.accumulatePnl(11, FROM_POSITION, FROM_VERSION, TO_VERSION_NEG)
        const valuesFees = await local.callStatic.accumulateFees(TO_POSITION)
        await local.accumulateFees(TO_POSITION)

        const value = await local.read()

        const expectedCollateral = parse6decimal('-3583800') // = -1100 * 987 + -2200 * 654 + -3300 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')

        expect(collateralAmount).to.equal(expectedCollateral)
        expect(valuesFees.positionFee).to.equal(expectedPositionFee)
        expect(valuesFees.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(INITIAL_VALUES.currentId)
        expect(value.latestId).to.equal(11)
        expect(value.collateral).to.equal(
          expectedCollateral.add(INITIAL_VALUES.collateral).sub(expectedPositionFee.add(expectedKeeper)),
        )
      })
    })
  })

  describe('#protect', () => {
    const VALID_ORACLE_VERSION: OracleVersionStruct = {
      timestamp: 12345,
      price: parse6decimal('100'),
      valid: true,
    }

    const VALID_RISK_PARAMETER: RiskParameterStruct = {
      margin: 15,
      maintenance: 1,
      takerFee: 2,
      takerSkewFee: 3,
      takerImpactFee: 4,
      makerFee: 5,
      makerImpactFee: 6,
      makerLimit: 7,
      efficiencyLimit: 8,
      liquidationFee: 9,
      minLiquidationFee: 10,
      maxLiquidationFee: 11,
      utilizationCurve: {
        minRate: 101,
        maxRate: 102,
        targetRate: 103,
        targetUtilization: 104,
      },
      pController: {
        k: 201,
        max: 202,
      },
      minMargin: 16,
      minMaintenance: 12,
      staleAfter: 13,
      makerReceiveOnly: false,
      skewScale: 14,
    }

    const VALID_ORDER: OrderStruct = {
      maker: 0,
      long: 0,
      short: 0,
      skew: 0,
      impact: 0,
      efficiency: 0,
      fee: 0,
      keeper: 0,
      utilization: 0,
      net: 0,
    }

    const TO_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: parse6decimal('123'),
      keeper: parse6decimal('456'),
      collateral: 0, // unused
      delta: 0, // unused
      invalidation: {
        maker: 0, // unused
        long: 0, // unused
        short: 0, // unused
      },
    }

    it('doesnt protect tryProtect == false', async () => {
      const result = await local.callStatic.protect(
        VALID_RISK_PARAMETER,
        VALID_ORACLE_VERSION,
        123,
        VALID_ORDER,
        owner.address,
        false,
      )
      await local.protect(VALID_RISK_PARAMETER, VALID_ORACLE_VERSION, 123, VALID_ORDER, owner.address, false)

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.protection).to.equal(0)
      expect(value.protectionAmount).to.equal(0)
      expect(value.protectionInitiator).to.equal(ethers.constants.AddressZero)
    })

    it('doesnt protect tryProtect == false', async () => {
      const result = await local.callStatic.protect(
        VALID_RISK_PARAMETER,
        VALID_ORACLE_VERSION,
        123,
        VALID_ORDER,
        owner.address,
        false,
      )
      await local.protect(VALID_RISK_PARAMETER, VALID_ORACLE_VERSION, 123, VALID_ORDER, owner.address, false)

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.protection).to.equal(0)
      expect(value.protectionAmount).to.equal(0)
      expect(value.protectionInitiator).to.equal(ethers.constants.AddressZero)
    })

    it('doesnt protect still protected version', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 124,
        protectionAmount: 5,
        protectionInitiator: owner.address,
      })
      const result = await local.callStatic.protect(
        VALID_RISK_PARAMETER,
        { ...VALID_ORACLE_VERSION, timestamp: 123 },
        127,
        VALID_ORDER,
        owner.address,
        true,
      )
      await local.protect(
        VALID_RISK_PARAMETER,
        { ...VALID_ORACLE_VERSION, timestamp: 123 },
        127,
        VALID_ORDER,
        owner.address,
        true,
      )

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.protection).to.equal(124)
      expect(value.protectionAmount).to.equal(5)
      expect(value.protectionInitiator).to.equal(owner.address)
    })

    it('protects if just settled protection', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 124,
        protectionAmount: 5,
        protectionInitiator: owner.address,
      })
      const result = await local.callStatic.protect(
        VALID_RISK_PARAMETER,
        { ...VALID_ORACLE_VERSION, timestamp: 124 },
        127,
        { ...VALID_ORDER, long: parse6decimal('1') },
        owner.address,
        true,
      )
      await local.protect(
        VALID_RISK_PARAMETER,
        { ...VALID_ORACLE_VERSION, timestamp: 124 },
        127,
        { ...VALID_ORDER, long: parse6decimal('1') },
        owner.address,
        true,
      )

      const value = await local.read()

      expect(result).to.equal(true)

      expect(value.protection).to.equal(127)
      expect(value.protectionAmount).to.equal(10)
      expect(value.protectionInitiator).to.equal(owner.address)
    })

    it('protects', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 121,
        protectionAmount: 5,
        protectionInitiator: owner.address,
      })
      const result = await local.callStatic.protect(
        VALID_RISK_PARAMETER,
        { ...VALID_ORACLE_VERSION, timestamp: 124 },
        127,
        { ...VALID_ORDER, long: parse6decimal('1') },
        owner.address,
        true,
      )
      await local.protect(
        VALID_RISK_PARAMETER,
        { ...VALID_ORACLE_VERSION, timestamp: 124 },
        127,
        { ...VALID_ORDER, long: parse6decimal('1') },
        owner.address,
        true,
      )

      const value = await local.read()

      expect(result).to.equal(true)

      expect(value.protection).to.equal(127)
      expect(value.protectionAmount).to.equal(10)
      expect(value.protectionInitiator).to.equal(owner.address)
    })
  })

  describe('#liquidationFee', () => {
    const TO_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: 0, // unused
      keeper: 0, // unused
      collateral: 0, // unused
      delta: 0, // unused
      invalidation: {
        maker: 0, // unused
        long: 0, // unused
        short: 0, // unused
      },
    }

    it('non-zero if protected at version', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 123,
        protectionAmount: 5,
        protectionInitiator: owner.address,
      })

      expect(await local.pendingLiquidationFee({ ...TO_POSITION, timestamp: 122 })).to.equal(5)
    })

    it('zero if latest after protection', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 123,
        protectionAmount: 5,
        protectionInitiator: owner.address,
      })

      expect(await local.pendingLiquidationFee({ ...TO_POSITION, timestamp: 124 })).to.equal(0)
    })

    it('zero if latest at protection', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 123,
        protectionAmount: 5,
        protectionInitiator: owner.address,
      })

      expect(await local.pendingLiquidationFee({ ...TO_POSITION, timestamp: 123 })).to.equal(0)
    })
  })

  describe('#processProtection', () => {
    const TO_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: parse6decimal('123'),
      keeper: parse6decimal('456'),
      collateral: 0, // unused
      delta: 0, // unused
      invalidation: {
        maker: 0, // unused
        long: 0, // unused
        short: 0, // unused
      },
    }

    const TO_VERSION: VersionStruct = {
      valid: true,
      makerValue: { _value: parse6decimal('1000') },
      longValue: { _value: parse6decimal('2000') },
      shortValue: { _value: parse6decimal('3000') },
    }

    it('does not decrement fee when invalid', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        collateral: 1000,
        protection: 123,
        protectionAmount: 123,
        protectionInitiator: owner.address,
      })

      const result = await local.callStatic.processProtection(TO_POSITION, { ...TO_VERSION, valid: false })
      await local.processProtection(TO_POSITION, { ...TO_VERSION, valid: false })

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.collateral).to.equal(1000)
    })

    it('does not decrement fee when timestamp before', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        collateral: 1000,
        protection: 123,
        protectionAmount: 123,
        protectionInitiator: owner.address,
      })

      const result = await local.callStatic.processProtection({ ...TO_POSITION, timestamp: 122 }, TO_VERSION)
      await local.processProtection({ ...TO_POSITION, timestamp: 122 }, TO_VERSION)

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.collateral).to.equal(1000)
    })

    it('does not decrement fee when timestamp after', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        collateral: 1000,
        protection: 123,
        protectionAmount: 123,
        protectionInitiator: owner.address,
      })

      const result = await local.callStatic.processProtection({ ...TO_POSITION, timestamp: 124 }, TO_VERSION)
      await local.processProtection({ ...TO_POSITION, timestamp: 122 }, TO_VERSION)

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.collateral).to.equal(1000)
    })

    it('decrements fee when valid', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        currentId: 0,
        latestId: 0,
        collateral: 1000,
        protection: 123,
        protectionAmount: 123,
        protectionInitiator: owner.address,
      })

      const result = await local.callStatic.processProtection({ ...TO_POSITION, timestamp: 123 }, TO_VERSION)
      await local.processProtection({ ...TO_POSITION, timestamp: 123 }, TO_VERSION)

      const value = await local.read()

      expect(result).to.equal(true)

      expect(value.collateral).to.equal(877)
    })
  })

  describe('#processLiquidationFee', () => {
    const TO_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: parse6decimal('123'),
      keeper: parse6decimal('456'),
      collateral: 0, // unused
      delta: 0, // unused
      invalidation: {
        maker: 0, // unused
        long: 0, // unused
        short: 0, // unused
      },
    }

    const TO_VERSION: VersionStruct = {
      valid: true,
      makerValue: { _value: parse6decimal('1000') },
      longValue: { _value: parse6decimal('2000') },
      shortValue: { _value: parse6decimal('3000') },
    }

    it('increments fee', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        collateral: 1000,
      })

      const initiateeLocal: LocalStruct = {
        ...DEFAULT_LOCAL,
        protection: 123,
        protectionAmount: 123,
        protectionInitiator: owner.address,
      }

      await local.processLiquidationFee(initiateeLocal)

      const value = await local.read()

      expect(value.collateral).to.equal(1123)
    })
  })
})
