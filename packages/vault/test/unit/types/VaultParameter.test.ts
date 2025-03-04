import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import { VaultParameterTester, VaultParameterTester__factory } from '../../../types/generated'
import { VaultParameterStruct } from '../../../types/generated/contracts/Vault'

const { ethers } = HRE
use(smock.matchers)

const VALID_VAULT_PARAMETER: VaultParameterStruct = { maxDeposit: 1, minDeposit: 2, profitShare: 3 }

describe('VaultParameter', () => {
  let owner: SignerWithAddress

  let vaultParameter: VaultParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    vaultParameter = await new VaultParameterTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores the value', async () => {
      await vaultParameter.store(VALID_VAULT_PARAMETER)

      const value = await vaultParameter.read()

      expect(value.maxDeposit).to.equal(1)
      expect(value.minDeposit).to.equal(2)
    })

    describe('.maxDeposit', () => {
      const STORAGE_SIZE = 64

      it('saves if in range', async () => {
        await vaultParameter.store({ ...VALID_VAULT_PARAMETER, maxDeposit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await vaultParameter.read()
        expect(value.maxDeposit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          vaultParameter.store({ ...VALID_VAULT_PARAMETER, maxDeposit: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(vaultParameter, 'VaultParameterStorageInvalidError')
      })
    })

    describe('.minDeposit', () => {
      const STORAGE_SIZE = 64

      it('saves if in range', async () => {
        await vaultParameter.store({ ...VALID_VAULT_PARAMETER, minDeposit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await vaultParameter.read()
        expect(value.minDeposit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          vaultParameter.store({ ...VALID_VAULT_PARAMETER, minDeposit: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(vaultParameter, 'VaultParameterStorageInvalidError')
      })
    })

    describe('.profitShare', () => {
      it('saves if in range', async () => {
        await vaultParameter.store({ ...VALID_VAULT_PARAMETER, profitShare: 1e6 })

        const value = await vaultParameter.read()
        expect(value.profitShare).to.equal(1e6)
      })

      it('reverts if out of range', async () => {
        await expect(
          vaultParameter.store({ ...VALID_VAULT_PARAMETER, profitShare: 1e6 + 1 }),
        ).to.be.revertedWithCustomError(vaultParameter, 'VaultParameterStorageInvalidError')
      })
    })
  })
})
