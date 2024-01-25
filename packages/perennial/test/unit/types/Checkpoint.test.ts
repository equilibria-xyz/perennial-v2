import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { CheckpointTester, CheckpointTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { CheckpointStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

describe('Checkpoint', () => {
  let owner: SignerWithAddress
  let checkpoint: CheckpointTester

  const VALID_CHECKPOINT: CheckpointStruct = {
    tradeFee: 3,
    settlementFee: 4,
    collateral: 5,
    delta: 6,
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
      expect(value.collateral).to.equal(5)
      expect(value.delta).to.equal(6)
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

    describe('.delta', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          delta: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.delta).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          delta: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.delta).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if delta out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            delta: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })

      it('reverts if delta out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            delta: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })
  })

  describe('#updateCollateral', () => {
    it('correctly updates collateral', async () => {
      await checkpoint.store(VALID_CHECKPOINT)
      await checkpoint.updateCollateral({ ...VALID_CHECKPOINT, delta: 100 }, { ...VALID_CHECKPOINT, delta: 200 }, 400)

      const storedCheckpoint = await checkpoint.read()
      expect(await storedCheckpoint.collateral).to.equal(300)
    })
  })

  describe('#updateFees', () => {
    it('correctly updates fees', async () => {
      await checkpoint.store(VALID_CHECKPOINT)
      await checkpoint.updateFees(-123, 456)

      const storedCheckpoint = await checkpoint.read()
      expect(await storedCheckpoint.tradeFee).to.equal(-123)
      expect(await storedCheckpoint.settlementFee).to.equal(456)
    })
  })

  describe('#updateDelta', () => {
    it('correctly increments delta', async () => {
      await checkpoint.store(VALID_CHECKPOINT)
      await checkpoint.updateDelta(100)

      const storedCheckpoint = await checkpoint.read()
      expect(await storedCheckpoint.delta).to.equal(106)
    })
  })

  describe('#next', () => {
    it('correctly resets everything aside from delta', async () => {
      await checkpoint.store(VALID_CHECKPOINT)
      await checkpoint.next()

      const storedCheckpoint = await checkpoint.read()
      expect(await storedCheckpoint.tradeFee).to.equal(0)
      expect(await storedCheckpoint.settlementFee).to.equal(0)
      expect(await storedCheckpoint.collateral).to.equal(0)
      expect(await storedCheckpoint.delta).to.equal(6)
    })
  })
})
