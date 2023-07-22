import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { GlobalTester, GlobalTester__factory } from '../../../types/generated'
import { BigNumber, BigNumberish } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { MarketParameterStruct } from '../../../types/generated/contracts/Market'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'

const { ethers } = HRE
use(smock.matchers)

function generateMarketParameter(oracleFee: BigNumberish, riskFee: BigNumberish): MarketParameterStruct {
  return {
    fundingFee: 0,
    interestFee: 0,
    oracleFee,
    positionFee: 0,
    settlementFee: 0,
    maxPendingGlobal: 0,
    maxPendingLocal: 0,
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
    riskFee,
    closed: false,
    makerCloseAlways: false,
    takerCloseAlways: false,
  }
}

function generateProtocolParameter(protocolFee: BigNumberish): ProtocolParameterStruct {
  return {
    protocolFee,
    maxFee: 0,
    maxFeeAbsolute: 0,
    maxCut: 0,
    maxRate: 0,
    minMaintenance: 0,
    minEfficiency: 0,
  }
}

describe('Global', () => {
  let owner: SignerWithAddress

  let global: GlobalTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    global = await new GlobalTester__factory(owner).deploy()
  })

  describe('#store', async () => {
    it('stores a new value', async () => {
      await global.store({
        currentId: 1,
        latestId: 10,
        protocolFee: 2,
        oracleFee: 3,
        riskFee: 4,
        donation: 5,
        pAccumulator: {
          _value: 6,
          _skew: 7,
        },
        latestPrice: 8,
      })

      const value = await global.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(10)
      expect(value.protocolFee).to.equal(2)
      expect(value.oracleFee).to.equal(3)
      expect(value.riskFee).to.equal(4)
      expect(value.donation).to.equal(5)
      expect(value.pAccumulator._value).to.equal(6)
      expect(value.pAccumulator._skew).to.equal(7)
      expect(value.latestPrice).to.equal(8)
    })

    context('.currentId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await global.store({
          currentId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.currentId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            currentId: BigNumber.from(2).pow(STORAGE_SIZE),
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.latestId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await global.store({
          currentId: 0,
          latestId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.latestId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: BigNumber.from(2).pow(STORAGE_SIZE),
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.protocolFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.protocolFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: BigNumber.from(2).pow(STORAGE_SIZE),
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.riskFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.riskFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: BigNumber.from(2).pow(STORAGE_SIZE),
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.donation', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.donation).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: BigNumber.from(2).pow(STORAGE_SIZE),
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.pAccumulator._value', async () => {
      const STORAGE_SIZE = 31
      it('saves if in range (above)', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.pAccumulator._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
            _skew: 0,
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.pAccumulator._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if currentId out of range (above)', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: BigNumber.from(2).pow(STORAGE_SIZE),
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })

      it('reverts if currentId out of range (below)', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
              _skew: 0,
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.pAccumulator._skew', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range (above)', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.pAccumulator._skew).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          },
          latestPrice: 0,
        })
        const value = await global.read()
        expect(value.pAccumulator._skew).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if currentId out of range (above)', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: BigNumber.from(2).pow(STORAGE_SIZE),
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })

      it('reverts if currentId out of range (below)', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            },
            latestPrice: 0,
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })

    context('.latestPrice', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.latestPrice).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await global.store({
          currentId: 0,
          latestId: 0,
          protocolFee: 0,
          oracleFee: 0,
          riskFee: 0,
          donation: 0,
          pAccumulator: {
            _value: 0,
            _skew: 0,
          },
          latestPrice: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await global.read()
        expect(value.latestPrice).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if currentId out of range (above)', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })

      it('reverts if currentId out of range (below)', async () => {
        await expect(
          global.store({
            currentId: 0,
            latestId: 0,
            protocolFee: 0,
            oracleFee: 0,
            riskFee: 0,
            donation: 0,
            pAccumulator: {
              _value: 0,
              _skew: 0,
            },
            latestPrice: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(global, 'GlobalStorageInvalidError')
      })
    })
  })

  describe('#incrementFees', async () => {
    context('zero keeper', async () => {
      it('no fees', async () => {
        await global.incrementFees(123, 0, generateMarketParameter(0, 0), generateProtocolParameter(0))

        const value = await global.read()
        expect(value.donation).to.equal(123)
      })

      it('protocol fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(0, 0),
          generateProtocolParameter(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('risk fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle / risk fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.riskFee).to.equal(36)
        expect(value.donation).to.equal(75)
      })

      it('oracle / risk fee zero donation', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.9')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.riskFee).to.equal(110)
        expect(value.donation).to.equal(1) // due to rounding
      })

      it('oracle / risk fee over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(0),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.riskFee).to.equal(9)
        expect(value.donation).to.equal(90)
      })

      it('protocol / risk fee zero marketFee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.riskFee).to.equal(0)
        expect(value.donation).to.equal(0)
      })

      it('protocol / risk fee zero donation', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(0, parse6decimal('1.0')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.riskFee).to.equal(99)
        expect(value.donation).to.equal(0)
      })

      it('protocol / risk fee protocol over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(0, parse6decimal('0.1')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee oracle over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(0, parse6decimal('1.1')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(9)
        expect(value.donation).to.equal(90)
      })

      it('protocol / oracle fee zero marketFee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(0)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle fee zero donation', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('1.0'), 0),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(99)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle fee protocol over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(parse6decimal('0.1'), 0),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee oracle over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(parse6decimal('1.1'), 0),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(9)
        expect(value.riskFee).to.equal(29)
        expect(value.donation).to.equal(61)
      })

      it('protocol / oracle / risk fee zero marketFee', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(0)
        expect(value.riskFee).to.equal(0)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle / risk fee zero donation', async () => {
        await global.incrementFees(
          123,
          0,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.9')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(9)
        expect(value.riskFee).to.equal(89)
        expect(value.donation).to.equal(1) // due to rounding
      })

      it('protocol / oracle / risk fee protocol over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee oracle over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })
    })

    context('non-zero keeper', async () => {
      it('no fees', async () => {
        await global.incrementFees(123, 456, generateMarketParameter(0, 0), generateProtocolParameter(0))

        const value = await global.read()
        expect(value.donation).to.equal(123)
      })

      it('protocol fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(0, 0),
          generateProtocolParameter(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('risk fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(468)
        expect(value.donation).to.equal(111)
      })

      it('oracle / risk fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(468)
        expect(value.riskFee).to.equal(36)
        expect(value.donation).to.equal(75)
      })

      it('oracle / risk fee zero donation', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.9')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(468)
        expect(value.riskFee).to.equal(110)
        expect(value.donation).to.equal(1) // due to rounding
      })

      it('oracle / risk fee over', async () => {
        await expect(
          global.incrementFees(
            123,
            456,
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(0),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.riskFee).to.equal(9)
        expect(value.donation).to.equal(90)
        expect(value.oracleFee).to.equal(456)
      })

      it('protocol / risk fee zero marketFee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.riskFee).to.equal(0)
        expect(value.donation).to.equal(0)
        expect(value.oracleFee).to.equal(456)
      })

      it('protocol / risk fee zero donation', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(0, parse6decimal('1.0')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.riskFee).to.equal(99)
        expect(value.donation).to.equal(0)
        expect(value.oracleFee).to.equal(456)
      })

      it('protocol / risk fee protocol over', async () => {
        await expect(
          global.incrementFees(
            123,
            456,
            generateMarketParameter(0, parse6decimal('0.1')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee oracle over', async () => {
        await expect(
          global.incrementFees(
            123,
            456,
            generateMarketParameter(0, parse6decimal('1.1')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(465)
        expect(value.donation).to.equal(90)
      })

      it('protocol / oracle fee zero marketFee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(456)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle fee zero donation', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('1.0'), 0),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(555)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle fee protocol over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            generateMarketParameter(parse6decimal('0.1'), 0),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee oracle over', async () => {
        await expect(
          global.incrementFees(
            123,
            456,
            generateMarketParameter(parse6decimal('1.1'), 0),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(465)
        expect(value.riskFee).to.equal(29)
        expect(value.donation).to.equal(61)
      })

      it('protocol / oracle / risk fee zero marketFee', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(456)
        expect(value.riskFee).to.equal(0)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle / risk fee zero donation', async () => {
        await global.incrementFees(
          123,
          456,
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.9')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(465)
        expect(value.riskFee).to.equal(89)
        expect(value.donation).to.equal(1) // due to rounding
      })

      it('protocol / oracle / risk fee protocol over', async () => {
        await expect(
          global.incrementFees(
            123,
            456,
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee oracle over', async () => {
        await expect(
          global.incrementFees(
            123,
            456,
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })
    })
  })

  describe('#update', async () => {
    it('updates the latestPrice', async () => {
      await global.update(12, 123)
      expect((await global.read()).latestId).to.equal(12)
      expect((await global.read()).latestPrice).to.equal(123)

      await global.update(23, 456)
      expect((await global.read()).latestId).to.equal(23)
      expect((await global.read()).latestPrice).to.equal(456)

      await global.update(34, 0)
      expect((await global.read()).latestId).to.equal(34)
      expect((await global.read()).latestPrice).to.equal(0)
    })
  })
})
