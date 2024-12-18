import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import { AccountTester, AccountTester__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { AccountStruct, CheckpointStruct } from '../../../types/generated/contracts/Vault'

const { ethers } = HRE
use(smock.matchers)

export const VALID_ACCOUNT: AccountStruct = {
  current: 1,
  latest: 2,
  shares: 3,
  assets: 4,
  deposit: 5,
  redemption: 6,
}

const EMPTY_CHECKPOINT: CheckpointStruct = {
  deposit: 0,
  redemption: 0,
  shares: 0,
  assets: 0,
  tradeFee: 0,
  settlementFee: 0,
  deposits: 0,
  redemptions: 0,
  timestamp: 0,
}

describe('Account', () => {
  let owner: SignerWithAddress

  let account: AccountTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    account = await new AccountTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores the value', async () => {
      await account.store(VALID_ACCOUNT)

      const value = await account.read()

      expect(value.current).to.equal(1)
      expect(value.latest).to.equal(2)
      expect(value.shares).to.equal(3)
      expect(value.assets).to.equal(4)
      expect(value.deposit).to.equal(5)
      expect(value.redemption).to.equal(6)
    })

    describe('.current', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          current: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await account.read()
        expect(value.current).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          account.store({
            ...VALID_ACCOUNT,
            current: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(account, 'AccountStorageInvalidError')
      })
    })

    describe('.latest', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          latest: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await account.read()
        expect(value.latest).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          account.store({
            ...VALID_ACCOUNT,
            latest: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(account, 'AccountStorageInvalidError')
      })
    })

    describe('.shares', () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          shares: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await account.read()
        expect(value.shares).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          account.store({
            ...VALID_ACCOUNT,
            shares: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(account, 'AccountStorageInvalidError')
      })
    })

    describe('.assets', () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          assets: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await account.read()
        expect(value.assets).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          account.store({
            ...VALID_ACCOUNT,
            assets: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(account, 'AccountStorageInvalidError')
      })
    })

    describe('.deposit', () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          deposit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await account.read()
        expect(value.deposit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          account.store({
            ...VALID_ACCOUNT,
            deposit: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(account, 'AccountStorageInvalidError')
      })
    })

    describe('.redemption', () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          redemption: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await account.read()
        expect(value.redemption).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          account.store({
            ...VALID_ACCOUNT,
            redemption: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(account, 'AccountStorageInvalidError')
      })
    })
  })

  describe('#processGlobal', () => {
    context('no existing shares or assets', () => {
      it('processes the global state', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          shares: 0,
          assets: 0,
          deposit: parse6decimal('21'),
          redemption: parse6decimal('23'),
        })

        await account.processGlobal(20, EMPTY_CHECKPOINT, parse6decimal('11'), parse6decimal('12'))

        const value = await account.read()

        expect(value.latest).to.equal(20)
        expect(value.assets).to.equal(parse6decimal('12'))
        expect(value.shares).to.equal(parse6decimal('11'))
        expect(value.deposit).to.equal(parse6decimal('10'))
        expect(value.redemption).to.equal(parse6decimal('11'))
      })
    })

    context('existing shares and assets', () => {
      it('processes the global state', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          shares: parse6decimal('123'),
          assets: parse6decimal('130'),
          deposit: parse6decimal('21'),
          redemption: parse6decimal('23'),
        })

        await account.processGlobal(20, EMPTY_CHECKPOINT, parse6decimal('11'), parse6decimal('12'))

        const value = await account.read()

        expect(value.latest).to.equal(20)
        expect(value.assets).to.equal(parse6decimal('142'))
        expect(value.shares).to.equal(parse6decimal('134'))
        expect(value.deposit).to.equal(parse6decimal('10'))
        expect(value.redemption).to.equal(parse6decimal('11'))
      })
    })
  })

  describe('#processLocal', () => {
    context('no existing shares or assets', () => {
      it('processes the global state', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          shares: 0,
          assets: 0,
          deposit: parse6decimal('21'),
          redemption: parse6decimal('23'),
        })

        await account.processLocal(20, EMPTY_CHECKPOINT, parse6decimal('11'), parse6decimal('12'))

        const value = await account.read()

        expect(value.latest).to.equal(20)
        expect(value.assets).to.equal(parse6decimal('12'))
        expect(value.shares).to.equal(parse6decimal('11'))
        expect(value.deposit).to.equal(parse6decimal('10'))
        expect(value.redemption).to.equal(parse6decimal('11'))
      })
    })

    context('existing shares and assets', () => {
      it('processes the global state', async () => {
        await account.store({
          ...VALID_ACCOUNT,
          shares: parse6decimal('123'),
          assets: parse6decimal('130'),
          deposit: parse6decimal('21'),
          redemption: parse6decimal('23'),
        })

        await account.processLocal(20, EMPTY_CHECKPOINT, parse6decimal('11'), parse6decimal('12'))

        const value = await account.read()

        expect(value.latest).to.equal(20)
        expect(value.assets).to.equal(parse6decimal('142'))
        expect(value.shares).to.equal(parse6decimal('134'))
        expect(value.deposit).to.equal(parse6decimal('10'))
        expect(value.redemption).to.equal(parse6decimal('11'))
      })
    })
  })

  describe('#update', () => {
    it('updates the account', async () => {
      await account.store({
        ...VALID_ACCOUNT,
        assets: parse6decimal('130'),
        shares: parse6decimal('123'),
        deposit: parse6decimal('21'),
        redemption: parse6decimal('23'),
      })

      await account.update(567, parse6decimal('129'), parse6decimal('120'), parse6decimal('22'), parse6decimal('24'))

      const value = await account.read()

      expect(value.current).to.equal(567)
      expect(value.assets).to.equal(parse6decimal('1'))
      expect(value.shares).to.equal(parse6decimal('3'))
      expect(value.deposit).to.equal(parse6decimal('43'))
      expect(value.redemption).to.equal(parse6decimal('47'))
    })
  })
})
