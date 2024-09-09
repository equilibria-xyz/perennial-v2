import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { LocalTester, LocalTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { LocalStruct } from '../../../types/generated/contracts/Market'
import { DEFAULT_LOCAL } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

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
      claimable: 3,
    }
    it('stores a new value', async () => {
      await local.store(VALID_STORED_VALUE)

      const value = await local.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(5)
      expect(value.collateral).to.equal(2)
      expect(value.claimable).to.equal(3)
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

    context('.claimable', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          claimable: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.claimable).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if claimable out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            claimable: BigNumber.from(2).pow(STORAGE_SIZE),
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
      await local['update(uint256,(int256,uint256,uint256,uint256))'](11, {
        collateral: 12,
        liquidationFee: 256,
        subtractiveFee: 0,
        solverFee: 0,
      })

      const storedLocal = await local.read()
      expect(await storedLocal.collateral).to.equal(756)
      expect(await storedLocal.latestId).to.equal(11)
    })
  })
})
