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
  positionFee: 3,
  oracleFee: 4,
  riskFee: 5,
  maxPendingGlobal: 10,
  maxPendingLocal: 11,
  settlementFee: 6,
  takerCloseAlways: false,
  makerCloseAlways: false,
  closed: false,
  settle: false,
}

const PROTOCOL_PARAMETER: ProtocolParameterStruct = {
  protocolFee: 0,
  maxFee: parse6decimal('1'),
  maxFeeAbsolute: BigNumber.from(2).pow(48).sub(1),
  maxCut: parse6decimal('1'),
  maxRate: parse6decimal('1'),
  minMaintenance: 0,
  minEfficiency: 0,
  referralFee: 0,
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
      expect(value.positionFee).to.equal(3)
      expect(value.oracleFee).to.equal(4)
      expect(value.riskFee).to.equal(5)
      expect(value.maxPendingGlobal).to.equal(10)
      expect(value.maxPendingLocal).to.equal(11)
      expect(value.settlementFee).to.equal(6)
      expect(value.takerCloseAlways).to.equal(false)
      expect(value.makerCloseAlways).to.equal(false)
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

    context('.positionFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            positionFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.positionFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              positionFee: parse6decimal('0.1'),
            },
            {
              ...PROTOCOL_PARAMETER,
              maxCut: parse6decimal('0.01'),
            },
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            oracleFee: parse6decimal('1'),
            riskFee: 0,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.oracleFee).to.equal(parse6decimal('1'))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              oracleFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.riskFee', async () => {
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            oracleFee: 0,
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

    context('.oracleFee + .riskFee', () => {
      it('saves if in range (oracleFee + riskFee < 1', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            oracleFee: parse6decimal('0.75'),
            riskFee: parse6decimal('0.25'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.oracleFee).to.equal(parse6decimal('0.75'))
        expect(value.riskFee).to.equal(parse6decimal('0.25'))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              oracleFee: parse6decimal('0.75'),
              riskFee: parse6decimal('0.25').add(1),
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

    context('.settlementFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          marketParameter.validateAndStore(
            {
              ...VALID_MARKET_PARAMETER,
              settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(marketParameterStorage, 'MarketParameterStorageInvalidError')
      })
    })

    context('.flags', async () => {
      it('saves takerCloseAlways', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            takerCloseAlways: true,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.takerCloseAlways).to.equal(true)
      })

      it('saves makerCloseAlways', async () => {
        await marketParameter.validateAndStore(
          {
            ...VALID_MARKET_PARAMETER,
            makerCloseAlways: true,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await marketParameter.read()
        expect(value.makerCloseAlways).to.equal(true)
      })

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
