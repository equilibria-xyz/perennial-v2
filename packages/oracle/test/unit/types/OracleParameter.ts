import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { OracleParameterTester, OracleParameterTester__factory } from '../../../types/generated'
import { OracleParameterStruct } from '../../../types/generated/contracts/test/OracleParameterTester'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

const DEFAULT_ORACLE_PARAMETER: OracleParameterStruct = {
  maxGranularity: 1,
  maxSettlementFee: 0,
  maxOracleFee: 0,
}

describe('OracleParameter', () => {
  let owner: SignerWithAddress
  let oracleParameter: OracleParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    oracleParameter = await new OracleParameterTester__factory(owner).deploy()
  })

  describe('storage', () => {
    describe('.maxGranularity', async () => {
      const STORAGE_SIZE = 16
      it('saves if in range (above)', async () => {
        await oracleParameter.store({
          ...DEFAULT_ORACLE_PARAMETER,
          maxGranularity: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.maxGranularity).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await oracleParameter.store({
          ...DEFAULT_ORACLE_PARAMETER,
          maxGranularity: 1,
        })
        const value = await oracleParameter.read()
        expect(value.maxGranularity).to.equal(1)
      })

      it('reverts if maxGranularity out of range (above)', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_ORACLE_PARAMETER,
            maxGranularity: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })

      it('reverts if maxGranularity out of range (below)', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_ORACLE_PARAMETER,
            maxGranularity: 0,
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })

    context('.maxSettlementFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_ORACLE_PARAMETER,
          maxSettlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await oracleParameter.read()
        expect(value.maxSettlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if maxSettlementFee out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_ORACLE_PARAMETER,
            maxSettlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })

    context('.maxOracleFee', async () => {
      it('saves if in range', async () => {
        await oracleParameter.store({
          ...DEFAULT_ORACLE_PARAMETER,
          maxOracleFee: parse6decimal('1'),
        })
        const value = await oracleParameter.read()
        expect(value.maxOracleFee).to.equal(parse6decimal('1'))
      })

      it('reverts if maxOracleFee out of range', async () => {
        await expect(
          oracleParameter.store({
            ...DEFAULT_ORACLE_PARAMETER,
            maxOracleFee: parse6decimal('1').add(1),
          }),
        ).to.be.revertedWithCustomError(oracleParameter, 'OracleParameterStorageInvalidError')
      })
    })
  })
})
