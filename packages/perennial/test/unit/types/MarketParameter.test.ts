import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  MarketParameterStorageLib,
  MarketParameterStorageLib__factory,
  MarketParameterTester,
  MarketParameterTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { MarketParameterStruct } from '../../../types/generated/contracts/Market'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

export const VALID_MARKET_PARAMETER: MarketParameterStruct = {
  fundingFee: 1,
  interestFee: 2,
  makerFee: 3,
  takerFee: 13,
  riskFee: 5,
  maxPendingGlobal: 10,
  maxPendingLocal: 11,
  maxPriceDeviation: 12,
  closed: false,
  settle: false,
}

const PROTOCOL_PARAMETER: ProtocolParameterStruct = {
  maxFee: parse6decimal('1'),
  maxLiquidationFee: BigNumber.from(2).pow(32).sub(1),
  maxCut: parse6decimal('1'),
  maxRate: parse6decimal('1'),
  minMaintenance: 0,
  minEfficiency: 0,
  referralFee: 0,
  minScale: parse6decimal('0.1'),
  maxStaleAfter: 172800, // 2 days
}

describe('MarketParameter', () => {
  let owner: SignerWithAddress

  let marketParameterStorage: MarketParameterStorageLib
  let marketParameter: MarketParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    marketParameterStorage = await new MarketParameterStorageLib__factory(owner).deploy()
    marketParameter = await new MarketParameterTester__factory(
      {
        'contracts/types/MarketParameter.sol:MarketParameterStorageLib': marketParameterStorage.address,
      },
      owner,
    ).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await marketParameter.validateAndStore(VALID_MARKET_PARAMETER, PROTOCOL_PARAMETER)

      const value = await marketParameter.read()
      expect(value.fundingFee).to.equal(1)
      expect(value.interestFee).to.equal(2)
      expect(value.makerFee).to.equal(3)
      expect(value.takerFee).to.equal(13)
      expect(value.riskFee).to.equal(5)
      expect(value.maxPendingGlobal).to.equal(10)
      expect(value.maxPendingLocal).to.equal(11)
      expect(value.maxPriceDeviation).to.equal(12)
      expect(value.closed).to.equal(false)
      expect(value.settle).to.equal(false)
    })

    context('.fundingFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            fundingFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.fundingFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              fundingFee: parse6decimal('0.1'),
            },
            {
              ...PROTOCOL_PARAMETER,
              maxCut: parse6decimal('0.01'),
            },
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.interestFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            interestFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.interestFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              interestFee: parse6decimal('0.1'),
            },
            {
              ...PROTOCOL_PARAMETER,
              maxCut: parse6decimal('0.01'),
            },
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.makerFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            makerFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.makerFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              makerFee: parse6decimal('0.1'),
            },
            {
              ...PROTOCOL_PARAMETER,
              maxCut: parse6decimal('0.01'),
            },
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.takerFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            takerFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.takerFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              takerFee: parse6decimal('0.1'),
            },
            {
              ...PROTOCOL_PARAMETER,
              maxCut: parse6decimal('0.01'),
            },
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.riskFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            riskFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.riskFee).to.equal(parse6decimal('1'))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              riskFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.maxPendingGlobal', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            maxPendingGlobal: BigNumber.from(2).pow(16).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.maxPendingGlobal).to.equal(BigNumber.from(2).pow(16).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              maxPendingGlobal: BigNumber.from(2).pow(16),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.maxPendingLocal', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            maxPendingLocal: BigNumber.from(2).pow(16).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.maxPendingLocal).to.equal(BigNumber.from(2).pow(16).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              maxPendingLocal: BigNumber.from(2).pow(16),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.maxPriceDeviation', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            maxPriceDeviation: BigNumber.from(2).pow(24).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.maxPriceDeviation).to.equal(BigNumber.from(2).pow(24).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              maxPriceDeviation: BigNumber.from(2).pow(24),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.flags', async () => {
      it('saves closed', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            closed: true,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.closed).to.equal(true)
      })

      it('saves settle', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            settle: true,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.settle).to.equal(true)
      })
    })
  })
})
