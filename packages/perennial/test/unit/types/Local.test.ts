import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { LocalTester, LocalTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { DEFAULT_ORDER, DEFAULT_VERSION, DEFAULT_POSITION, parse6decimal } from '../../../../common/testutil/types'
import {
  LocalStruct,
  PositionStruct,
  VersionStruct,
  RiskParameterStruct,
} from '../../../types/generated/contracts/Market'
import { OracleVersionStruct } from '../../../types/generated/contracts/interfaces/IOracleProvider'

const { ethers } = HRE
use(smock.matchers)

const DEFAULT_LOCAL: LocalStruct = {
  currentId: 0,
  latestId: 0,
  collateral: 0,
  protection: 0,
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
    }
    it('stores a new value', async () => {
      await local.store(VALID_STORED_VALUE)

      const value = await local.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(5)
      expect(value.collateral).to.equal(2)
      expect(value.protection).to.equal(4)
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
  })

  describe('#update', () => {
    it('adds collateral (increase)', async () => {
      await local.store(DEFAULT_LOCAL)

      await local['update(int256)'](1)

      const value = await local.read()
      expect(value.collateral).to.equal(1)
    })

    it('adds collateral (decrease)', async () => {
      await local.store(DEFAULT_LOCAL)

      await local['update(int256)'](-1)

      const value = await local.read()
      expect(value.collateral).to.equal(-1)
    })
  })

  describe('#update', () => {
    it('correctly updates fees', async () => {
      await local.store({ ...DEFAULT_LOCAL, collateral: 1000 })
      await local['update(uint256,int256,int256,uint256)'](11, 567, -123, 456)

      const storedLocal = await local.read()
      expect(await storedLocal.collateral).to.equal(1234)
      expect(await storedLocal.latestId).to.equal(11)
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
      takerFee: {
        linearFee: 2,
        proportionalFee: 3,
        adiabaticFee: 4,
        scale: 14,
      },
      makerFee: {
        linearFee: 5,
        proportionalFee: 6,
        adiabaticFee: 17,
        scale: 14,
      },
      makerLimit: 7,
      efficiencyLimit: 8,
      liquidationFee: 9,
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
    }

    it('doesnt protect tryProtect == false', async () => {
      const result = await local.callStatic.protect(VALID_ORACLE_VERSION, 123, false)
      await local.protect(VALID_ORACLE_VERSION, 123, false)

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.protection).to.equal(0)
    })

    it('doesnt protect still protected version', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 124,
      })
      const result = await local.callStatic.protect({ ...VALID_ORACLE_VERSION, timestamp: 123 }, 127, true)
      await local.protect({ ...VALID_ORACLE_VERSION, timestamp: 123 }, 127, true)

      const value = await local.read()

      expect(result).to.equal(false)

      expect(value.protection).to.equal(124)
    })

    it('protects if just settled protection', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 124,
      })
      const result = await local.callStatic.protect({ ...VALID_ORACLE_VERSION, timestamp: 124 }, 127, true)
      await local.protect({ ...VALID_ORACLE_VERSION, timestamp: 124 }, 127, true)

      const value = await local.read()

      expect(result).to.equal(true)

      expect(value.protection).to.equal(127)
    })

    it('protects', async () => {
      await local.store({
        ...DEFAULT_LOCAL,
        protection: 121,
      })
      const result = await local.callStatic.protect({ ...VALID_ORACLE_VERSION, timestamp: 124 }, 127, true)
      await local.protect({ ...VALID_ORACLE_VERSION, timestamp: 124 }, 127, true)

      const value = await local.read()

      expect(result).to.equal(true)

      expect(value.protection).to.equal(127)
    })
  })
})
