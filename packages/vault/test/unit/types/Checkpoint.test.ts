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
  deposits: 6,
  redemptions: 9,
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
      expect(value.deposits).to.equal(6)
      expect(value.redemptions).to.equal(9)
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

    describe('.deposits', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposits: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.deposits).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            deposits: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpoint, 'CheckpointStorageInvalidError')
      })
    })

    describe('.redemptions', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          redemptions: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.redemptions).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            redemptions: BigNumber.from(2).pow(STORAGE_SIZE),
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
      expect(value.deposits).to.equal(0)
      expect(value.redemptions).to.equal(0)
    })
  })

  describe('#update', () => {
    it('updates the checkpoint (deposit only)', async () => {
      await checkpoint.store({ ...VALID_CHECKPOINT, redemption: 0 })

      await checkpoint.update(123, 0)

      const value = await checkpoint.read()

      expect(value.deposit).to.equal(124)
      expect(value.redemption).to.equal(0)
      expect(value.deposits).to.equal(7)
    })

    it('updates the checkpoint (redeem only)', async () => {
      await checkpoint.store({ ...VALID_CHECKPOINT, deposit: 0 })

      await checkpoint.update(0, 456)

      const value = await checkpoint.read()

      expect(value.deposit).to.equal(0)
      expect(value.redemption).to.equal(458)
      expect(value.redemptions).to.equal(10)
    })

    it('updates the checkpoint (deposit and redemption)', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      await checkpoint.update(123, 456)

      const value = await checkpoint.read()

      expect(value.deposit).to.equal(124)
      expect(value.redemption).to.equal(458)
      expect(value.deposits).to.equal(7)
      expect(value.redemptions).to.equal(10)
    })
  })

  describe('#complete', () => {
    it('completes the checkpoint (above hwm)', async () => {
      await checkpoint.store({
        ...VALID_CHECKPOINT,
        assets: parse6decimal('100'),
        shares: parse6decimal('100'),
      })

      const marketCheckpoint = {
        collateral: parse6decimal('900'),
        tradeFee: 456,
        settlementFee: 78,
        transfer: 0,
      }
      const mark = ethers.utils.parseEther('5') // 5 -> 10
      const vaultParameter = { maxDeposit: 123, minDeposit: 456, profitShare: parse6decimal('0.2') }

      const [newMark, profitShares] = await checkpoint.callStatic.complete(mark, vaultParameter, marketCheckpoint)
      await checkpoint.complete(mark, vaultParameter, marketCheckpoint)

      const value = await checkpoint.read()

      expect(newMark).to.equal(ethers.utils.parseEther('10'))
      expect(profitShares).to.equal(parse6decimal('11.111111')) // 100 out of 1000 profit assets
      expect(value.assets).to.equal(parse6decimal('1000')) // 100 + 900
      expect(value.shares).to.equal(parse6decimal('111.111111'))
      expect(value.tradeFee).to.equal(456)
      expect(value.settlementFee).to.equal(78)
    })

    it('completes the checkpoint (below hwm)', async () => {
      await checkpoint.store({
        ...VALID_CHECKPOINT,
        assets: parse6decimal('100'),
        shares: parse6decimal('100'),
      })

      const marketCheckpoint = {
        collateral: parse6decimal('900'),
        tradeFee: 456,
        settlementFee: 78,
        transfer: 0,
      }
      const mark = ethers.utils.parseEther('15')
      const vaultParameter = { maxDeposit: 123, minDeposit: 456, profitShare: parse6decimal('0.2') }

      const [newMark, profitShares] = await checkpoint.callStatic.complete(mark, vaultParameter, marketCheckpoint)
      await checkpoint.complete(mark, vaultParameter, marketCheckpoint)

      const value = await checkpoint.read()

      expect(newMark).to.equal(ethers.utils.parseEther('15'))
      expect(profitShares).to.equal(0)
      expect(value.assets).to.equal(parse6decimal('1000'))
      expect(value.shares).to.equal(parse6decimal('100'))
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

          expect(value).to.equal(9) // 12 - 3
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

          // (40 * 60 / 100) - 10 * 6 / 15 * 60 / 100
          expect(await checkpoint.toSharesGlobal(parse6decimal('40'))).to.equal(parse6decimal('21.60000'))
        })
      })

      it('returns shares (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('400'),
          redemption: parse6decimal('200'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
        })

        // (40 * 60 / 100) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60)) - 10 * 60 / 100 * 6 / 15
        expect(await checkpoint.toSharesGlobal(parse6decimal('40'))).to.equal(parse6decimal('21.567272'))
      })
    })
  })

  describe('#toAssetsGlobal', () => {
    context('zero shares', () => {
      it('returns shares net of keepr', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0 })

        const value = await checkpoint.toAssetsGlobal(12)

        expect(value).to.equal(7) // 12 - 5
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

          // (40 * 100 / 60) - 10 * 9 / 15
          expect(await checkpoint.toAssetsGlobal(parse6decimal('40'))).to.equal(parse6decimal('60.666666'))
        })
      })

      it('returns assets (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('400'),
          redemption: parse6decimal('200'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
        })

        // (40 * 100 / 60) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60)) - 10 * 9 / 15
        expect(await checkpoint.toAssetsGlobal(parse6decimal('40'))).to.equal(parse6decimal('60.575757').sub(1))
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

          expect(value).to.equal(11) // 12 - 1
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
            deposits: 2,
            redemptions: 3,
          })

          expect(await checkpoint.toSharesLocal(parse6decimal('40'))).to.equal(parse6decimal('22.8'))
        })
      })

      context('orders is 0', () => {
        it('returns shares without settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: parse6decimal('400'),
            redemption: parse6decimal('200'),
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
            deposits: 0,
            redemptions: 0,
          })
          // (40 * 60 / 100) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60))
          expect(await checkpoint.toSharesLocal(parse6decimal('40'))).to.equal(parse6decimal('23.967272'))
        })
      })

      it('returns shares (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('400'),
          redemption: parse6decimal('200'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
          deposits: 2,
          redemptions: 3,
        })

        // (40 * 60 / 100) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60)) - 10 * 60 / 100 / 5
        expect(await checkpoint.toSharesLocal(parse6decimal('40'))).to.equal(parse6decimal('22.767272'))
      })
    })
  })

  describe('#toAssetsLocal', () => {
    context('zero shares', () => {
      it('returns shares net of settlement fee', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, shares: 0, settlementFee: 10, deposits: 2, redemptions: 3 })

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
            deposits: 2,
            redemptions: 3,
          })

          expect(await checkpoint.toAssetsLocal(parse6decimal('40'))).to.equal(parse6decimal('64.666666'))
        })
      })

      context('orders is 0', () => {
        it('returns assets no settlement fee', async () => {
          await checkpoint.store({
            ...VALID_CHECKPOINT,
            deposit: parse6decimal('400'),
            redemption: parse6decimal('200'),
            assets: parse6decimal('100'),
            shares: parse6decimal('60'),
            settlementFee: parse6decimal('10'),
            tradeFee: parse6decimal('1'),
            deposits: 0,
            redemptions: 0,
          })

          // (40 * 100 / 60) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60))
          expect(await checkpoint.toAssetsLocal(parse6decimal('40'))).to.equal(parse6decimal('66.575757').sub(1))
        })
      })

      it('returns assets (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('400'),
          redemption: parse6decimal('200'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: parse6decimal('10'),
          tradeFee: parse6decimal('1'),
          deposits: 2,
          redemptions: 3,
        })

        // (40 * 100 / 60) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60)) - 10 / 5
        expect(await checkpoint.toAssetsLocal(parse6decimal('40'))).to.equal(parse6decimal('64.575757').sub(1))
      })
    })
  })

  describe('#toAssets', () => {
    context('zero shares', () => {
      it('returns shares net of keepr', async () => {
        await checkpoint.store({ ...VALID_CHECKPOINT, settlementFee: 0, shares: 0 })

        const value = await checkpoint.toAssets(12)

        expect(value).to.equal(12)
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

          expect(await checkpoint.toAssets(parse6decimal('40'))).to.equal(parse6decimal('66.666666'))
        })
      })

      it('returns assets (full calculation)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          deposit: parse6decimal('400'),
          redemption: parse6decimal('200'),
          assets: parse6decimal('100'),
          shares: parse6decimal('60'),
          settlementFee: 0,
          tradeFee: parse6decimal('1'),
        })

        // (40 * 100 / 60) * ((400 + 200 * 100 / 60 - 1) / (400 + 200 * 100 / 60))
        expect(await checkpoint.toAssets(parse6decimal('40'))).to.equal(parse6decimal('66.575757').sub(1))
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
