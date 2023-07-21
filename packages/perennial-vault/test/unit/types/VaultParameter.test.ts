import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import { VaultParameterTester, VaultParameterTester__factory } from '../../../types/generated'
import { VaultParameterStruct } from '../../../types/generated/contracts/Vault'

const { ethers } = HRE
use(smock.matchers)

const VALID_VAULT_PARAMETER: VaultParameterStruct = { cap: 1 }

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

      expect(value.cap).to.equal(1)
    })

    describe('.cap', () => {
      const STORAGE_SIZE = 64

      it('saves if in range', async () => {
        await vaultParameter.store({ ...VALID_VAULT_PARAMETER, cap: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await vaultParameter.read()
        expect(value.cap).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          vaultParameter.store({ ...VALID_VAULT_PARAMETER, cap: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(vaultParameter, 'VaultParameterStorageInvalidError')
      })
    })
  })
})
