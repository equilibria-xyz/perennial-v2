import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { CheckpointTester, CheckpointTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { CheckpointStruct } from '../../../types/generated/contracts/Market'
import { DEFAULT_ORDER } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Checkpoint', () => {
  let owner: SignerWithAddress
  let checkpoint: CheckpointTester

  const VALID_CHECKPOINT: CheckpointStruct = {
    tradeFee: 3,
    settlementFee: 4,
    transfer: 6,
    collateral: 5,
  }

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    checkpoint = await new CheckpointTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      const value = await checkpoint.read()
      expect(value.tradeFee).to.equal(3)
      expect(value.settlementFee).to.equal(4)
      expect(value.transfer).to.equal(6)
      expect(value.collateral).to.equal(5)
    })

    describe('.tradeFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.tradeFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.tradeFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if tradeFee out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            tradeFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })

      it('reverts if tradeFee out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.settlementFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if settlementFee out of range)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.transfer', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          transfer: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.transfer).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          transfer: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.transfer).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if delta out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            transfer: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })

      it('reverts if delta out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            transfer: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.collateral', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if collateral out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })

      it('reverts if collateral out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })
  })

  describe('#update', () => {
    it('correctly updates fees', async () => {
      await checkpoint.store(VALID_CHECKPOINT)
      await checkpoint.update({ ...DEFAULT_ORDER, collateral: 345 }, 567, -123, 456)

      const storedCheckpoint = await checkpoint.read()
      expect(await storedCheckpoint.collateral).to.equal(571)
      expect(await storedCheckpoint.transfer).to.equal(345)
      expect(await storedCheckpoint.tradeFee).to.equal(-123)
      expect(await storedCheckpoint.settlementFee).to.equal(456)
    })
  })
})
