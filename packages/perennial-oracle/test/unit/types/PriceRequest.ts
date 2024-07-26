import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { PriceRequestTester, PriceRequestTester__factory } from '../../../types/generated'
import { PriceRequestStruct } from '../../../types/generated/contracts/test/PriceRequestTester'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

const DEFAULT_PRICE_REQUEST: PriceRequestStruct = {
  timestamp: 0,
  settlementFee: 0,
  oracleFee: 0,
}

describe('PriceRequest', () => {
  let owner: SignerWithAddress
  let priceRequest: PriceRequestTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    priceRequest = await new PriceRequestTester__factory(owner).deploy()
  })

  describe('storage', () => {
    describe('.timestamp', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await priceRequest.store({
          ...DEFAULT_PRICE_REQUEST,
          timestamp: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceRequest.read()
        expect(value.timestamp).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          priceRequest.store({
            ...DEFAULT_PRICE_REQUEST,
            timestamp: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceRequest, 'PriceRequestStorageInvalidError')
      })
    })

    context('.syncFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await priceRequest.store({
          ...DEFAULT_PRICE_REQUEST,
          syncFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceRequest.read()
        expect(value.syncFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if syncFee out of range', async () => {
        await expect(
          priceRequest.store({
            ...DEFAULT_PRICE_REQUEST,
            syncFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceRequest, 'PriceRequestStorageInvalidError')
      })
    })

    context('.asyncFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await priceRequest.store({
          ...DEFAULT_PRICE_REQUEST,
          asyncFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceRequest.read()
        expect(value.asyncFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if asyncFee out of range', async () => {
        await expect(
          priceRequest.store({
            ...DEFAULT_PRICE_REQUEST,
            asyncFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceRequest, 'PriceRequestStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await priceRequest.store({
          ...DEFAULT_PRICE_REQUEST,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await priceRequest.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if oracleFee out of range', async () => {
        await expect(
          priceRequest.store({
            ...DEFAULT_PRICE_REQUEST,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(priceRequest, 'PriceRequestStorageInvalidError')
      })
    })
  })

  describe('#toPriceResponse', () => {
    it('constructs price response (valid)', async () => {
      const value = await priceRequest.toPriceResponse(
        {
          ...DEFAULT_PRICE_REQUEST,
          settlementFee: parse6decimal('2.0'),
          oracleFee: parse6decimal('0.1'),
          timestamp: 1337,
        },
        {
          timestamp: 1337,
          price: parse6decimal('123'),
          valid: true,
        },
      )

      expect(value.price).to.equal(parse6decimal('123'))
      expect(value.settlementFee).to.equal(parse6decimal('2.0'))
      expect(value.oracleFee).to.equal(parse6decimal('0.1'))
      expect(value.valid).to.equal(true)
    })

    it('constructs price response (invalid)', async () => {
      const value = await priceRequest.toPriceResponse(
        {
          ...DEFAULT_PRICE_REQUEST,
          settlementFee: parse6decimal('2.0'),
          oracleFee: parse6decimal('0.1'),
          timestamp: 1337,
        },
        {
          timestamp: 1337,
          price: parse6decimal('123'),
          valid: false,
        },
      )

      expect(value.price).to.equal(parse6decimal('123'))
      expect(value.settlementFee).to.equal(parse6decimal('2.0'))
      expect(value.oracleFee).to.equal(parse6decimal('0.1'))
      expect(value.valid).to.equal(false)
    })
  })

  describe('#toPriceResponseInvalid', () => {
    it('constructs price response', async () => {
      const value = await priceRequest.toPriceResponseInvalid(
        {
          ...DEFAULT_PRICE_REQUEST,
          settlementFee: parse6decimal('2.0'),
          oracleFee: parse6decimal('0.1'),
          timestamp: 1337,
        },
        {
          price: parse6decimal('123'),
          settlementFee: parse6decimal('3.0'),
          oracleFee: parse6decimal('0.2'),
          valid: true,
        },
      )

      expect(value.price).to.equal(parse6decimal('123'))
      expect(value.settlementFee).to.equal(parse6decimal('2.0'))
      expect(value.oracleFee).to.equal(parse6decimal('0.1'))
      expect(value.valid).to.equal(false)
    })
  })
})
