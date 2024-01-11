import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { CheckpointGlobalTester, CheckpointGlobalTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { CheckpointStruct, OracleVersionStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

export const VALID_ORACLE_VERSION: OracleVersionStruct = {
  timestamp: 12345,
  price: parse6decimal('100'),
  valid: true,
}

const VALID_ORDER = {
  timestamp: 123456,
  orders: 1,
  maker: parse6decimal('-1'),
  long: parse6decimal('5'),
  short: parse6decimal('3'),
  makerPos: parse6decimal('4'),
  makerNeg: parse6decimal('5'),
  takerPos: parse6decimal('8'),
  takerNeg: parse6decimal('6'),
}

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

    checkpoint = await new CheckpointGlobalTester__factory(owner).deploy()
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

  describe('#magnitude', () => {
    context('maker is max', () => {
      it('returns maker magnitude', async () => {
        await checkpoint.store({ ...validStoredCheckpoint, maker: 101, long: 1, short: 2 })
        expect(await checkpoint.magnitude()).to.equal(101)
      })
    })

    context('long is max', () => {
      it('returns long magnitude', async () => {
        await checkpoint.store({ ...validStoredCheckpoint, maker: 1, long: 102, short: 2 })
        expect(await checkpoint.magnitude()).to.equal(102)
      })
    })

    context('short is max', () => {
      it('returns long magnitude', async () => {
        await checkpoint.store({ ...validStoredCheckpoint, maker: 1, long: 2, short: 103 })
        expect(await checkpoint.magnitude()).to.equal(103)
      })
    })
  })
})
