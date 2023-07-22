import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants } from 'ethers'

import { RegistrationTester, RegistrationTester__factory } from '../../../types/generated'
import { RegistrationStruct } from '../../../types/generated/contracts/Vault'

const { ethers } = HRE
use(smock.matchers)

const VALID_REGISTRATION: RegistrationStruct = {
  market: constants.AddressZero,
  weight: 1,
  leverage: 2,
}

describe('Registration', () => {
  let owner: SignerWithAddress

  let registration: RegistrationTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    registration = await new RegistrationTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores the value', async () => {
      await registration.store(VALID_REGISTRATION)

      const value = await registration.read()

      expect(value.market).to.equal(constants.AddressZero)
      expect(value.weight).to.equal(1)
      expect(value.leverage).to.equal(2)
    })

    describe('.weight', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await registration.store({ ...VALID_REGISTRATION, weight: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await registration.read()
        expect(value.weight).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          registration.store({ ...VALID_REGISTRATION, weight: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(registration, 'RegistrationStorageInvalidError')
      })
    })

    describe('.leverage', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await registration.store({ ...VALID_REGISTRATION, leverage: BigNumber.from(2).pow(STORAGE_SIZE).sub(1) })

        const value = await registration.read()
        expect(value.leverage).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          registration.store({ ...VALID_REGISTRATION, leverage: BigNumber.from(2).pow(STORAGE_SIZE) }),
        ).to.be.revertedWithCustomError(registration, 'RegistrationStorageInvalidError')
      })
    })
  })
})
