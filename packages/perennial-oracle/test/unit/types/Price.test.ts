import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { PriceTester, PriceTester__factory } from '../../../types/generated'
import { PriceStruct } from '../../../types/generated/contracts/test/PriceTester'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

describe('Price', () => {
  let owner: SignerWithAddress
  let price: PriceTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    price = await new PriceTester__factory(owner).deploy()
  })

  describe('#storeAndRead', () => {
    it('stores and reads a valid price', async () => {
      const validPrice: PriceStruct = {
        price: parse6decimal('63.48'),
        valid: true,
      }
      await price.store(validPrice)

      const readPrice = await price.read()
      expect(readPrice.price).to.equal(validPrice.price)
      expect(readPrice.valid).to.equal(validPrice.valid)
    })

    it('stores and reads an invalid price', async () => {
      const invalidPrice: PriceStruct = {
        price: 0,
        valid: false,
      }
      await price.store(invalidPrice)

      const readPrice = await price.read()
      expect(readPrice.price).to.equal(invalidPrice.price)
      expect(readPrice.valid).to.equal(invalidPrice.valid)
    })

    it('reverts if price out of range', async () => {
      const STORAGE_SIZE = 64

      const overflowPrice: PriceStruct = {
        price: BigNumber.from(2).pow(STORAGE_SIZE).add(1),
        valid: true,
      }
      await expect(price.store(overflowPrice)).to.be.revertedWithCustomError(price, 'PriceStorageInvalidError')

      const underflowPrice: PriceStruct = {
        price: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
        valid: false,
      }
      await expect(price.store(underflowPrice)).to.be.revertedWithCustomError(price, 'PriceStorageInvalidError')
    })
  })
})
