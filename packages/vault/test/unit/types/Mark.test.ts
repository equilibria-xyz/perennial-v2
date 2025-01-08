import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import { MarkTester, MarkTester__factory } from '../../../types/generated'
import { MarkStruct } from '../../../types/generated/contracts/Vault'

const { ethers } = HRE
use(smock.matchers)

const VALID_MARK: MarkStruct = { mark: 1, claimable: 2 }

describe('Mark', () => {
  let owner: SignerWithAddress

  let mark: MarkTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    mark = await new MarkTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores the value', async () => {
      await mark.store(VALID_MARK)

      const value = await mark.read()

      expect(value.mark).to.equal(1)
      expect(value.claimable).to.equal(2)
    })

    describe('.mark', () => {
      const STORAGE_SIZE = 128

      it('saves if in range', async () => {
        await mark.store({ ...VALID_MARK, mark: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await mark.read()
        expect(value.mark).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          mark.store({ ...VALID_MARK, mark: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(mark, 'MarkStorageInvalidError')
      })
    })

    describe('.claimable', () => {
      const STORAGE_SIZE = 64

      it('saves if in range', async () => {
        await mark.store({ ...VALID_MARK, claimable: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await mark.read()
        expect(value.claimable).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          mark.store({ ...VALID_MARK, claimable: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(mark, 'MarkStorageInvalidError')
      })
    })
  })
})
