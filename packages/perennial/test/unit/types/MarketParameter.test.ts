import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { MarketParameterTester, MarketParameterTester__factory } from '../../../types/generated'
import { BigNumber, constants } from 'ethers'
import { MarketParameterStruct } from '../../../types/generated/contracts/Market'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'
import { parse6decimal } from '../../../../common/testutil/types'

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

const PROTOCOL_PARAMETER: ProtocolParameterStruct = {
  maxPendingIds: parse6decimal('1000'),
  protocolFee: 0,
  maxFee: parse6decimal('1'),
  maxFeeAbsolute: parse6decimal('99999'),
  maxCut: parse6decimal('1'),
  maxRate: parse6decimal('1'),
  minMaintenance: 0,
  minEfficiency: 0,
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

  describe('#validate', () => {
    context('non-0 protocolParameter.maxFeeAbsolute', () => {
      describe('.settlementFee', () => {
        it('reverts if invalid', async () => {
          await marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            settlementFee: parse6decimal('100'),
          })

          await expect(
            marketParameter.validate(
              {
                ...PROTOCOL_PARAMETER,
                maxFeeAbsolute: parse6decimal('1'),
              },
              marketParameter.address,
            ),
          )
            .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
            .withArgs(2)
        })
      })
    })

    context('non-0 protocolParameter.maxCut', () => {
      describe('.fundingFee', () => {
        it('reverts if invalid', async () => {
          await marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            fundingFee: parse6decimal('0.1'),
          })

          await expect(
            marketParameter.validate(
              {
                ...PROTOCOL_PARAMETER,
                maxCut: parse6decimal('0.01'),
              },
              marketParameter.address,
            ),
          )
            .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
            .withArgs(3)
        })
      })

      describe('.interestFee', () => {
        it('reverts if invalid', async () => {
          await marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            interestFee: parse6decimal('0.1'),
          })

          await expect(
            marketParameter.validate(
              {
                ...PROTOCOL_PARAMETER,
                maxCut: parse6decimal('0.01'),
              },
              marketParameter.address,
            ),
          )
            .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
            .withArgs(3)
        })
      })

      describe('.positionFee', () => {
        it('reverts if invalid', async () => {
          await marketParameter.store({
            ...VALID_MARKET_PARAMETER,
            positionFee: parse6decimal('0.1'),
          })

          await expect(
            marketParameter.validate(
              {
                ...PROTOCOL_PARAMETER,
                maxCut: parse6decimal('0.01'),
              },
              marketParameter.address,
            ),
          )
            .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
            .withArgs(3)
        })
      })
    })

    describe('.oracleFee + .riskFee', () => {
      it('reverts if invalid', async () => {
        await marketParameter.store({
          ...VALID_MARKET_PARAMETER,
          oracleFee: parse6decimal('0.9'),
          riskFee: parse6decimal('0.101'),
        })

        await expect(marketParameter.validate(PROTOCOL_PARAMETER, marketParameter.address))
          .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
          .withArgs(8)
      })
    })

    describe('.reward address', () => {
      context('is zero', () => {
        context('.makerRewardRate > 0', () => {
          it('reverts', async () => {
            await marketParameter.store({
              ...VALID_MARKET_PARAMETER,
              makerRewardRate: parse6decimal('0.1'),
            })

            await expect(marketParameter.validate(PROTOCOL_PARAMETER, constants.AddressZero))
              .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
              .withArgs(9)
          })
        })

        context('.longRewardRate > 0', () => {
          it('reverts', async () => {
            await marketParameter.store({
              ...VALID_MARKET_PARAMETER,
              makerRewardRate: 0,
              longRewardRate: parse6decimal('0.1'),
            })

            await expect(marketParameter.validate(PROTOCOL_PARAMETER, constants.AddressZero))
              .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
              .withArgs(9)
          })
        })

        context('.shortRewardRate > 0', () => {
          it('reverts', async () => {
            await marketParameter.store({
              ...VALID_MARKET_PARAMETER,
              makerRewardRate: 0,
              longRewardRate: 0,
              shortRewardRate: parse6decimal('0.1'),
            })

            await expect(marketParameter.validate(PROTOCOL_PARAMETER, constants.AddressZero))
              .to.be.revertedWithCustomError(marketParameter, 'MarketInvalidMarketParameterError')
              .withArgs(9)
          })
        })
      })
    })

    it('allows a valid market parameter', async () => {
      await marketParameter.store(VALID_MARKET_PARAMETER)

      await expect(marketParameter.validate(PROTOCOL_PARAMETER, marketParameter.address)).to.not.be.reverted
    })
  })
})
