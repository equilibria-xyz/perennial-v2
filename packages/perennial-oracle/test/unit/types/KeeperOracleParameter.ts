import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { KeeperOracleParameterTester, KeeperOracleParameterTester__factory } from '../../../types/generated'
import { KeeperOracleParameterStruct } from '../../../types/generated/contracts/test/KeeperOracleParameterTester'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

const DEFAULT_PROVIDER_PARAMETER: KeeperOracleParameterStruct = {
  latestGranularity: 0,
  currentGranularity: 1,
  effectiveAfter: 0,
  oracleFee: 0,
  validFrom: 0,
  validTo: 0,
}

describe('KeeperOracleParameter', () => {
  let owner: SignerWithAddress
  let providerParameter: KeeperOracleParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    providerParameter = await new KeeperOracleParameterTester__factory(owner).deploy()
  })

  describe('storage', () => {
    describe('.latestGranularity', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range (above)', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          latestGranularity: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await providerParameter.read()
        expect(value.latestGranularity).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          latestGranularity: 1,
        })
        const value = await providerParameter.read()
        expect(value.latestGranularity).to.equal(1)
      })

      it('saves if in out of range, but fresh (below)', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
        })
        const value = await providerParameter.read()
        expect(value.latestGranularity).to.equal(0)
      })

      it('reverts if latestGranularity out of range (above)', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            latestGranularity: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })

      it('reverts if latestGranularity out of range (below)', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            effectiveAfter: 1337,
            latestGranularity: 0,
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })
    })

    describe('.currentGranularity', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range (above)', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          currentGranularity: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await providerParameter.read()
        expect(value.currentGranularity).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (above)', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          currentGranularity: 1,
        })
        const value = await providerParameter.read()
        expect(value.currentGranularity).to.equal(1)
      })

      it('reverts if currentGranularity out of range (above)', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            currentGranularity: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })

      it('reverts if currentGranularity out of range (below)', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            currentGranularity: 0,
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })
    })

    describe('.effectiveAfter', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          latestGranularity: 1,
          effectiveAfter: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await providerParameter.read()
        expect(value.effectiveAfter).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if effectiveAfter out of range', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            latestGranularity: 1,
            effectiveAfter: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await providerParameter.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if oracleFee out of range', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })
    })

    describe('.validFrom', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          validFrom: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await providerParameter.read()
        expect(value.validFrom).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if validFrom out of range', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            validFrom: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })
    })

    describe('.validTo', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range', async () => {
        await providerParameter.store({
          ...DEFAULT_PROVIDER_PARAMETER,
          validTo: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await providerParameter.read()
        expect(value.validTo).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if validFrom out of range', async () => {
        await expect(
          providerParameter.store({
            ...DEFAULT_PROVIDER_PARAMETER,
            validFrom: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(providerParameter, 'KeeperOracleParameterStorageInvalidError')
      })
    })
  })
})
