import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { PriceResponseTester, PriceResponseTester__factory } from '../../../types/generated'
import { PriceResponseStruct } from '../../../types/generated/contracts/test/PriceResponseTester'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { time } from 'console'

const { ethers } = HRE

const DEFAULT_PRICE_RESPONSE: PriceResponseStruct = {
  price: 0,
  settlementFee: 0,
  oracleFee: 0,
  valid: false,
}

describe('PriceResponse', () => {
  let owner: SignerWithAddress
  let priceResponse: PriceResponseTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    priceResponse = await new PriceResponseTester__factory(owner).deploy()
  })

  describe('storage', () => {
    describe('.price', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          price: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceResponse.read()
        expect(value.price).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          price: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await priceResponse.read()
        expect(value.price).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          priceResponse.store({
            ...DEFAULT_PRICE_RESPONSE,
            price: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceResponse, 'PriceResponseStorageInvalidError')
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          priceResponse.store({
            ...DEFAULT_PRICE_RESPONSE,
            price: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(priceResponse, 'PriceResponseStorageInvalidError')
      })
    })

    context('.settlementFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceResponse.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if settlementFee out of range', async () => {
        await expect(
          priceResponse.store({
            ...DEFAULT_PRICE_RESPONSE,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceResponse, 'PriceResponseStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceResponse.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if oracleFee out of range', async () => {
        await expect(
          priceResponse.store({
            ...DEFAULT_PRICE_RESPONSE,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceResponse, 'PriceResponseStorageInvalidError')
      })
    })

    describe('.valid', () => {
      it('stores and reads a valid price', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          valid: true,
        })

        const readPrice = await priceResponse.read()
        expect(readPrice.valid).to.equal(true)
      })

      it('stores and reads an invalid price', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          valid: false,
        })

        const readPrice = await priceResponse.read()
        expect(readPrice.valid).to.equal(false)
      })
    })
  })

  describe('#fromUnrequested', () => {
    it('constructs price response', async () => {
      const value = await priceResponse.fromUnrequested({
        timestamp: 1337,
        price: parse6decimal('123'),
        valid: true,
      })

      expect(value.price).to.equal(parse6decimal('123'))
      expect(value.settlementFee).to.equal(0)
      expect(value.oracleFee).to.equal(0)
      expect(value.valid).to.equal(true)
    })
  })

  describe('#toOracleVersion', () => {
    it('constructs oracle version (valid)', async () => {
      const value = await priceResponse.toOracleVersion(
        {
          ...DEFAULT_PRICE_RESPONSE,
          price: parse6decimal('123'),
          valid: true,
        },
        1337,
      )

      expect(value.timestamp).to.equal(1337)
      expect(value.price).to.equal(parse6decimal('123'))
      expect(value.valid).to.equal(true)
    })

    it('constructs oracle version (invalid)', async () => {
      const value = await priceResponse.toOracleVersion(
        {
          ...DEFAULT_PRICE_RESPONSE,
          price: parse6decimal('123'),
          valid: false,
        },
        1337,
      )

      expect(value.timestamp).to.equal(1337)
      expect(value.price).to.equal(parse6decimal('123'))
      expect(value.valid).to.equal(false)
    })
  })
})
