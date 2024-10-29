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
  syncFee: 0,
  asyncFee: 0,
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

    context('.syncFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceResponse.read()
        expect(value.syncFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if syncFee out of range', async () => {
        await expect(
          priceResponse.store({
            ...DEFAULT_PRICE_RESPONSE,
            syncFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceResponse, 'PriceResponseStorageInvalidError')
      })
    })

    context('.asyncFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await priceResponse.store({
          ...DEFAULT_PRICE_RESPONSE,
          asyncFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceResponse.read()
        expect(value.asyncFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if asyncFee out of range', async () => {
        await expect(
          priceResponse.store({
            ...DEFAULT_PRICE_RESPONSE,
            asyncFee: BigNumber.from(2).pow(STORAGE_SIZE),
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
      expect(value.syncFee).to.equal(0)
      expect(value.asyncFee).to.equal(0)
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

  describe('#toOracleReceipt', () => {
    it('constructs oracle receipt', async () => {
      const value = await priceResponse.toOracleReceipt(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('1'),
          asyncFee: parse6decimal('0.1'),
          oracleFee: parse6decimal('0.01'),
        },
        5,
      )

      expect(value.settlementFee).to.equal(parse6decimal('1.5'))
      expect(value.oracleFee).to.equal(parse6decimal('0.01'))
    })
  })

  describe('#settlementFee', () => {
    it('calculates correct fee w/ non-zero sync, zero async', async () => {
      const value = await priceResponse.settlementFee(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('1'),
          asyncFee: parse6decimal('0.1'),
        },
        0,
      )

      expect(value).to.equal(parse6decimal('1.0'))
    })

    it('calculates correct fee w/ non-zero sync, single async', async () => {
      const value = await priceResponse.settlementFee(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('1'),
          asyncFee: parse6decimal('0.1'),
        },
        1,
      )

      expect(value).to.equal(parse6decimal('1.1'))
    })

    it('calculates correct fee w/ non-zero sync, multiple async', async () => {
      const value = await priceResponse.settlementFee(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('1'),
          asyncFee: parse6decimal('0.1'),
        },
        5,
      )

      expect(value).to.equal(parse6decimal('1.5'))
    })

    it('calculates correct fee w/ zero sync, zero async', async () => {
      const value = await priceResponse.settlementFee(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('0'),
          asyncFee: parse6decimal('0.1'),
        },
        0,
      )

      expect(value).to.equal(parse6decimal('0.0'))
    })

    it('calculates correct fee w/ zero sync, single async', async () => {
      const value = await priceResponse.settlementFee(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('0'),
          asyncFee: parse6decimal('0.1'),
        },
        1,
      )

      expect(value).to.equal(parse6decimal('0.1'))
    })

    it('calculates correct fee w/ zero sync, multiple async', async () => {
      const value = await priceResponse.settlementFee(
        {
          ...DEFAULT_PRICE_RESPONSE,
          syncFee: parse6decimal('0'),
          asyncFee: parse6decimal('0.1'),
        },
        5,
      )

      expect(value).to.equal(parse6decimal('0.5'))
    })
  })

  describe('#applyFeeMaximum', () => {
    it('calculates correct fee w/ non-zero sync, zero async', async () => {
      await priceResponse.store({
        ...DEFAULT_PRICE_RESPONSE,
        syncFee: parse6decimal('1'),
        asyncFee: parse6decimal('0.2'),
      })

      await priceResponse.applyFeeMaximum(parse6decimal('0.5'), 0)

      const value = await priceResponse.read()

      expect(value.syncFee).to.equal(parse6decimal('0.5'))
      expect(value.asyncFee).to.equal(parse6decimal('0.1'))
    })

    it('calculates correct fee w/ non-zero sync, single async', async () => {
      await priceResponse.store({
        ...DEFAULT_PRICE_RESPONSE,
        syncFee: parse6decimal('1'),
        asyncFee: parse6decimal('0.2'),
      })

      await priceResponse.applyFeeMaximum(parse6decimal('0.6'), 1)

      const value = await priceResponse.read()

      expect(value.syncFee).to.equal(parse6decimal('0.5'))
      expect(value.asyncFee).to.equal(parse6decimal('0.1'))
    })

    it('calculates correct fee w/ non-zero sync, multiple async', async () => {
      await priceResponse.store({
        ...DEFAULT_PRICE_RESPONSE,
        syncFee: parse6decimal('1'),
        asyncFee: parse6decimal('0.2'),
      })

      await priceResponse.applyFeeMaximum(parse6decimal('1.0'), 5)

      const value = await priceResponse.read()

      expect(value.syncFee).to.equal(parse6decimal('0.5'))
      expect(value.asyncFee).to.equal(parse6decimal('0.1'))
    })

    it('calculates correct fee w/ zero sync, zero async', async () => {
      await priceResponse.store({
        ...DEFAULT_PRICE_RESPONSE,
        syncFee: parse6decimal('0'),
        asyncFee: parse6decimal('0.2'),
      })

      await priceResponse.applyFeeMaximum(parse6decimal('0.0'), 0)

      const value = await priceResponse.read()

      expect(value.syncFee).to.equal(parse6decimal('0'))
      expect(value.asyncFee).to.equal(parse6decimal('0.2'))
    })

    it('calculates correct fee w/ zero sync, single async', async () => {
      await priceResponse.store({
        ...DEFAULT_PRICE_RESPONSE,
        syncFee: parse6decimal('0'),
        asyncFee: parse6decimal('0.2'),
      })

      await priceResponse.applyFeeMaximum(parse6decimal('0.1'), 1)

      const value = await priceResponse.read()

      expect(value.syncFee).to.equal(parse6decimal('0.0'))
      expect(value.asyncFee).to.equal(parse6decimal('0.1'))
    })

    it('calculates correct fee w/ zero sync, multiple async', async () => {
      await priceResponse.store({
        ...DEFAULT_PRICE_RESPONSE,
        syncFee: parse6decimal('0'),
        asyncFee: parse6decimal('0.2'),
      })

      await priceResponse.applyFeeMaximum(parse6decimal('0.5'), 5)

      const value = await priceResponse.read()

      expect(value.syncFee).to.equal(parse6decimal('0.0'))
      expect(value.asyncFee).to.equal(parse6decimal('0.1'))
    })
  })
})
