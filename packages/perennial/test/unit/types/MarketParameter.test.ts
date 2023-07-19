import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { MarketParameterTester, MarketParameterTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { MarketParameterStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

export const VALID_MARKET_PARAMETER: MarketParameterStruct = {
  fundingFee: 1,
  interestFee: 2,
  positionFee: 3,
  oracleFee: 4,
  riskFee: 5,
  settlementFee: 6,
  makerRewardRate: 7,
  longRewardRate: 8,
  shortRewardRate: 9,
  takerCloseAlways: false,
  makerCloseAlways: false,
  closed: false,
}

describe('MarketParameter', () => {
  let owner: SignerWithAddress

  let marketParameter: MarketParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    marketParameter = await new MarketParameterTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await marketParameter.store(VALID_MARKET_PARAMETER)

      const value = await marketParameter.read()
      expect(value.fundingFee).to.equal(1)
      expect(value.interestFee).to.equal(2)
      expect(value.positionFee).to.equal(3)
      expect(value.oracleFee).to.equal(4)
      expect(value.riskFee).to.equal(5)
      expect(value.settlementFee).to.equal(6)
      expect(value.makerRewardRate).to.equal(7)
      expect(value.longRewardRate).to.equal(8)
      expect(value.shortRewardRate).to.equal(9)
      expect(value.takerCloseAlways).to.equal(false)
      expect(value.makerCloseAlways).to.equal(false)
      expect(value.closed).to.equal(false)
    })

    context('.fundingFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          fundingFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.fundingFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            fundingFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.interestFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          interestFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.interestFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            interestFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.positionFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          positionFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.positionFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            positionFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.riskFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          riskFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.riskFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            riskFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.settlementFee', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.makerRewardRate', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          makerRewardRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.makerRewardRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            makerRewardRate: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.longRewardRate', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          longRewardRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.longRewardRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            longRewardRate: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.shortRewardRate', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          shortRewardRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await marketParameter.read()
        expect(value.shortRewardRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            shortRewardRate: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(marketParameter, 'MarketParameterStorageInvalidError')
      })
    })

    context('.flags', async () => {
      it('saves takerCloseAlways', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          takerCloseAlways: true,
        })
        const value = await marketParameter.read()
        expect(value.takerCloseAlways).to.equal(true)
      })

      it('saves makerCloseAlways', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          makerCloseAlways: true,
        })
        const value = await marketParameter.read()
        expect(value.makerCloseAlways).to.equal(true)
      })

      it('saves closed', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          closed: true,
        })
        const value = await marketParameter.read()
        expect(value.closed).to.equal(true)
      })
    })
  })
})
