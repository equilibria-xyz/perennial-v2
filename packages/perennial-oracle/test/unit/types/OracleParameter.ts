import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { OracleParameterTester, OracleParameterTester__factory } from '../../../types/generated'
import { OracleParameterStruct } from '../../../types/generated/contracts/test/OracleParameterTester'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

const DEFAULT_PRICE_RESPONSE: OracleParameterStruct = {
  latestGranularity: 0,
  currentGranularity: 0,
  effectiveAfter: 0,
  settlementFee: 0,
  oracleFee: 0,
}

describe('OracleParameter', () => {
  let owner: SignerWithAddress
  let oracleParameter: OracleParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    oracleParameter = await new OracleParameterTester__factory(owner).deploy()
  })

  describe('storage', () => {
    describe('.latestGranularity', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_PRICE_RESPONSE,
          latestGranularity: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.latestGranularity).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if latestGranularity out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_PRICE_RESPONSE,
            latestGranularity: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })

    describe('.currentGranularity', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_PRICE_RESPONSE,
          currentGranularity: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.currentGranularity).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentGranularity out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_PRICE_RESPONSE,
            currentGranularity: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })

    describe('.effectiveAfter', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_PRICE_RESPONSE,
          effectiveAfter: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.effectiveAfter).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if effectiveAfter out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_PRICE_RESPONSE,
            effectiveAfter: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })

    context('.settlementFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_PRICE_RESPONSE,
          settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if settlementFee out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_PRICE_RESPONSE,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_PRICE_RESPONSE,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if oracleFee out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_PRICE_RESPONSE,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })
  })
})
