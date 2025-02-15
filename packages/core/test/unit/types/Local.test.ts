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
      collateral: 0,
      claimable: 0,
    }
    it('stores a new value', async () => {
      await local.store(VALID_STORED_VALUE)

      const value = await local.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(5)
      expect(value.collateral).to.equal(0)
      expect(value.claimable).to.equal(0)
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
      it('saves if zero', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          collateral: 0,
        })
        const value = await local.read()
        expect(value.collateral).to.equal(BigNumber.from(0))
      })

      it('reverts if nonzero', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            collateral: 1,
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.claimable', async () => {
      const STORAGE_SIZE = 64
      it('saves if zero', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          claimable: 0,
        })
        const value = await local.read()
        expect(value.claimable).to.equal(BigNumber.from(0))
      })

      it('reverts if nonzero', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            claimable: 2,
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })
  })

  describe('#update', () => {
    it('correctly calculates pnl and updates fees', async () => {
      await local.store({ ...DEFAULT_LOCAL })
      const checkpointAccumulationResponse = {
        collateral: 1012,
        liquidationFee: 256,
        subtractiveFee: 0,
        solverFee: 0,
      }

      const pnl = await local.callStatic.update(11, checkpointAccumulationResponse)
      expect(pnl).to.equal(756)

      await local['update(uint256,(int256,uint256,uint256,uint256))'](11, checkpointAccumulationResponse)
      const storedLocal = await local.read()
      expect(await storedLocal.collateral).to.equal(0)
      expect(await storedLocal.latestId).to.equal(11)
    })
  })
})
