import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import { CheckpointTester, CheckpointTester__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { CheckpointStruct } from '../../../types/generated/contracts/Vault'
import { VALID_ACCOUNT } from './Account.test'

const { ethers } = HRE
use(smock.matchers)

const VALID_CHECKPOINT: CheckpointStruct = {
  deposit: 1,
  redemption: 2,
  shares: 3,
  assets: 4,
  tradeFee: 5,
  settlementFee: 7,
  orders: 6,
  timestamp: 8,
}

describe('Checkpoint', () => {
  let owner: SignerWithAddress

  let checkpoint: CheckpointTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    checkpoint = await new CheckpointTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores the value', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      const value = await checkpoint.read()

      expect(value.deposit).to.equal(1)
      expect(value.redemption).to.equal(2)
      expect(value.shares).to.equal(3)
      expect(value.assets).to.equal(4)
      expect(value.tradeFee).to.equal(5)
      expect(value.settlementFee).to.equal(7)
      expect(value.orders).to.equal(6)
      expect(value.timestamp).to.equal(8)
    })

    describe('.deposit', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.deposit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.redemption', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          redemption: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.redemption).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            redemption: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.shares', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          shares: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.shares).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            shares: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.assets', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          assets: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.assets).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          assets: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.assets).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            assets: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            assets: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1).sub(1),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.tradeFee', async () => {
      const STORAGE_SIZE = 63
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

      it('reverts if out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            tradeFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.settlementFee', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.orders', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          orders: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.orders).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            orders: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.timestamp', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          timestamp: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.timestamp).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            timestamp: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })
  })

  describe('#next', () => {
    it('sets the checkpoint', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      await checkpoint.next(123, VALID_ACCOUNT)

      const value = await checkpoint.read()

      expect(value.timestamp).to.equal(123)
      expect(value.shares).to.equal(3)
      expect(value.assets).to.equal(-9)
      expect(value.deposit).to.equal(0)
      expect(value.redemption).to.equal(0)
      expect(value.tradeFee).to.equal(0)
      expect(value.settlementFee).to.equal(0)
      expect(value.orders).to.equal(0)
    })
  })

  describe('#update', () => {
    it('updates the checkpoint', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      await checkpoint.update(123, 456)

      const value = await checkpoint.read()

      expect(value.deposit).to.equal(124)
      expect(value.redemption).to.equal(458)
      expect(value.orders).to.equal(7)
    })
  })

  describe('#complete', () => {
    it('completes the checkpoint', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      const marketCheckpoint = { collateral: 123, tradeFee: 456, settlementFee: 78, transfer: 0 }
      await checkpoint.complete(marketCheckpoint)

      const value = await checkpoint.read()

      expect(value.assets).to.equal(127)
      expect(value.tradeFee).to.equal(456)
      expect(value.settlementFee).to.equal(78)
    })
  })

  describe('#toSharesGlobal', () => {
    context('zero shares', () => {
      it('returns assets', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0 })

        const value = await checkpoint.toSharesGlobal(12)

        expect(value).to.equal(12)
      })
    })

    context('shares are non-0', () => {
      context('assets are negative', () => {
        it('returns assets', async () => {
          await checkpoint.store({ ...VALID_CHECKPOINT, assets: -12 })

          const value = await checkpoint.toSharesGlobal(12)

          expect(value).to.equal(12)
        })
      })

      context('deposits and redemptions are 0', () => {
        it('returns shares net of settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: 0,
            redemption: 0,
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
          })

          expect(await checkpoint.toSharesGlobal(parse6decimal('40'))).to.equal(parse6decimal('18'))
        })
      })

      it('returns shares (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('4'),
          redemption: parse6decimal('2'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
        })

        expect(await checkpoint.toSharesGlobal(parse6decimal('40'))).to.equal(parse6decimal('15.545454'))
      })
    })
  })

  describe('#toAssetsGlobal', () => {
    context('zero shares', () => {
      it('returns shares net of keepr', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0 })

        const value = await checkpoint.toAssetsGlobal(12)

        expect(value).to.equal(5)
      })
    })

    context('shares are non-0', () => {
      context('deposits and redemptions are 0', () => {
        it('returns assets net of settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: 0,
            redemption: 0,
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
          })

          expect(await checkpoint.toAssetsGlobal(parse6decimal('40'))).to.equal(parse6decimal('56.666666'))
        })
      })

      it('returns assets (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('4'),
          redemption: parse6decimal('2'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
        })

        expect(await checkpoint.toAssetsGlobal(parse6decimal('40'))).to.equal(parse6decimal('47.575756'))
      })
    })
  })

  describe('#toSharesLocal', () => {
    context('zero shares', () => {
      it('returns assets', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0 })

        const value = await checkpoint.toSharesLocal(12)

        expect(value).to.equal(12)
      })
    })

    context('shares are non-0', () => {
      context('assets are negative', () => {
        it('returns assets', async () => {
          await checkpoint.store({ ...VALID_CHECKPOINT, assets: -12 })

          const value = await checkpoint.toSharesLocal(12)

          expect(value).to.equal(12)
        })
      })

      context('deposits and redemptions are 0', () => {
        it('returns shares without settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: 0,
            redemption: 0,
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
            orders: 5,
          })

          expect(await checkpoint.toSharesLocal(parse6decimal('40'))).to.equal(parse6decimal('22.8'))
        })
      })

      context('orders is 0', () => {
        it('returns shares without settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: parse6decimal('4'),
            redemption: parse6decimal('2'),
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
            orders: 0,
          })

          expect(await checkpoint.toSharesLocal(parse6decimal('40'))).to.equal(parse6decimal('20.727272'))
        })
      })

      it('returns shares (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('4'),
          redemption: parse6decimal('2'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
          orders: 5,
        })

        expect(await checkpoint.toSharesLocal(parse6decimal('40'))).to.equal(parse6decimal('19.690908'))
      })
    })
  })

  describe('#toAssetsLocal', () => {
    context('zero shares', () => {
      it('returns shares net of settlement fee', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0, settlementFee: 10, orders: 5 })

        const value = await checkpoint.toAssetsLocal(12)

        expect(value).to.equal(10)
      })
    })

    context('shares are non-0', () => {
      context('no deposits or redemptions', () => {
        it('returns shares without settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: 0,
            redemption: 0,
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
            orders: 5,
          })

          expect(await checkpoint.toAssetsLocal(parse6decimal('40'))).to.equal(parse6decimal('64.666666'))
        })
      })

      context('orders is 0', () => {
        it('returns assets no settlement fee fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: parse6decimal('4'),
            redemption: parse6decimal('2'),
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
          })

          expect(await checkpoint.toAssetsLocal(parse6decimal('40'))).to.equal(parse6decimal('55.909090'))
        })
      })

      it('returns assets (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('4'),
          redemption: parse6decimal('2'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
          orders: 5,
        })

        expect(await checkpoint.toAssetsLocal(parse6decimal('40'))).to.equal(parse6decimal('55.575756'))
      })
    })
  })

  describe('#toShares', () => {
    context('zero shares', () => {
      it('returns assets', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, settlementFee: 0, shares: 0 })

        const value = await checkpoint.toShares(12, 7)

        expect(value).to.equal(12)
      })
    })

    context('shares are non-0', () => {
      context('assets are negative', () => {
        it('returns assets', async () => {
          await checkpoint.store({ ...VALID_CHECKPOINT, settlementFee: 0, assets: -12 })

          const value = await checkpoint.toShares(12, 7)

          expect(value).to.equal(12)
        })
      })

      context('deposits and redemptions are 0', () => {
        it('returns shares net of settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: 0,
            redemption: 0,
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: 0,
            tradeFee: parse6decimal('1'),
          })

          expect(await checkpoint.toShares(parse6decimal('40'), parse6decimal('10'))).to.equal(parse6decimal('18'))
        })
      })

      it('returns shares (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('4'),
          redemption: parse6decimal('2'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: 0,
          tradeFee: parse6decimal('1'),
        })

        expect(await checkpoint.toShares(parse6decimal('40'), parse6decimal('10'))).to.equal(parse6decimal('15.545454'))
      })
    })
  })

  describe('#toAssets', () => {
    context('zero shares', () => {
      it('returns shares net of keepr', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, settlementFee: 0, shares: 0 })

        const value = await checkpoint.toAssetes(12, 7)

        expect(value).to.equal(5)
      })
    })

    context('shares are non-0', () => {
      context('deposits and redemptions are 0', () => {
        it('returns assets net of settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: 0,
            redemption: 0,
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: 0,
            tradeFee: parse6decimal('1'),
          })

          expect(await checkpoint.toAssetes(parse6decimal('40'), parse6decimal('10'))).to.equal(
            parse6decimal('56.666666'),
          )
        })
      })

      it('returns assets (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('4'),
          redemption: parse6decimal('2'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: 0,
          tradeFee: parse6decimal('1'),
        })

        expect(await checkpoint.toAssetes(parse6decimal('40'), parse6decimal('10'))).to.equal(
          parse6decimal('47.575756'),
        )
      })
    })
  })

  describe('#unhealthy', () => {
    context('0 shares, 0 assets', () => {
      it('returns false', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0, assets: 0 })

        expect(await checkpoint.unhealthy()).to.equal(false)
      })
    })

    context('non-0 shares, > 0 assets', () => {
      it('returns false', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 1, assets: 1 })

        expect(await checkpoint.unhealthy()).to.equal(false)
      })
    })

    context('non-0 shares, 0 assets', () => {
      it('returns true', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 1, assets: 0 })

        expect(await checkpoint.unhealthy()).to.equal(true)
      })
    })

    context('non-0 shares, < 0 assets', () => {
      it('returns true', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 1, assets: -1 })

        expect(await checkpoint.unhealthy()).to.equal(true)
      })
    })
  })
})
