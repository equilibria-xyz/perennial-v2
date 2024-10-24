import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  GlobalStorageLib,
  GlobalStorageLib__factory,
  GlobalTester,
  GlobalTester__factory,
} from '../../../types/generated'
import { BigNumber, BigNumberish } from 'ethers'
import { OracleReceipt, parse6decimal, DEFAULT_GLOBAL } from '../../../../common/testutil/types'
import { GlobalStruct, MarketParameterStruct } from '../../../types/generated/contracts/Market'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'
import { OracleReceiptStruct } from '../../../types/generated/contracts/interfaces/IOracleProvider'
import { VersionAccumulationResponseStruct } from '../../../types/generated/contracts/test/GlobalTester'

const { ethers } = HRE
use(smock.matchers)

function generateAccumulationResult(
  marketFee: BigNumberish,
  settlementFee: BigNumberish,
  marketExposure: BigNumberish,
): VersionAccumulationResponseStruct {
  return {
    marketFee,
    settlementFee,
    marketExposure,
  }
}

function generateOracleReceipt(oracleFee: BigNumberish): OracleReceiptStruct {
  return {
    settlementFee: 0,
    oracleFee,
  }
}

function generateMarketParameter(riskFee: BigNumberish): MarketParameterStruct {
  return {
    fundingFee: 0,
    interestFee: 0,
    makerFee: 0,
    takerFee: 0,
    maxPendingGlobal: 0,
    maxPendingLocal: 0,
    maxPriceDeviation: 0,
    riskFee,
    closed: false,
    settle: false,
  }
}

function generateProtocolParameter(protocolFee: BigNumberish): ProtocolParameterStruct {
  return {
    maxFee: 0,
    maxLiquidationFee: 0,
    maxCut: 0,
    maxRate: 0,
    minMaintenance: 0,
    minEfficiency: 0,
    referralFee: 0,
    minScale: 0,
    maxStaleAfter: 172800, // 2 days
  }
}

describe('Global', () => {
  let owner: SignerWithAddress

  let globalStorageLib: GlobalStorageLib
  let global: GlobalTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    globalStorageLib = await new GlobalStorageLib__factory(owner).deploy()
    global = await new GlobalTester__factory(
      { 'contracts/types/Global.sol:GlobalStorageLib': globalStorageLib.address },
      owner,
    ).deploy()
  })

  describe('#store', async () => {
    it('stores a new value', async () => {
      await global.store({
        currentId: 1,
        latestId: 10,
        protocolFee: 2,
        oracleFee: 3,
        riskFee: 4,
        pAccumulator: {
          _value: 6,
          _skew: 7,
        },
        latestPrice: 9,
        exposure: 8,
      })

      const value = await global.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(10)
      expect(value.protocolFee).to.equal(2)
      expect(value.oracleFee).to.equal(3)
      expect(value.riskFee).to.equal(4)
      expect(value.pAccumulator._value).to.equal(6)
      expect(value.pAccumulator._skew).to.equal(7)
      expect(value.latestPrice).to.equal(9)
      expect(value.exposure).to.equal(8)
    })

    context('.currentId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          currentId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.currentId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            currentId: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.latestId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          latestId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.latestId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            latestId: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.protocolFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          protocolFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.protocolFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            protocolFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.oracleFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          oracleFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.oracleFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            oracleFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.riskFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          riskFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.riskFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            riskFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.latestPrice', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          latestPrice: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.latestPrice).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if latestPrice out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            latestPrice: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.exposure', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          exposure: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.exposure).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            exposure: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.pAccumulator._value', async () => {
      const STORAGE_SIZE = 31
      it('saves if in range (above)', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          pAccumulator: {
            _value: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
            _skew: 0,
          },
        })
        const value = await global.read()
        expect(value.pAccumulator._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          pAccumulator: {
            _value: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
            _skew: 0,
          },
        })
        const value = await global.read()
        expect(value.pAccumulator._value).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if currentId out of range (above)', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            pAccumulator: {
              _value: BigNumber.from(2).pow(STORAGE_SIZE),
              _skew: 0,
            },
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })

      it('reverts if currentId out of range (below)', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            pAccumulator: {
              _value: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
              _skew: 0,
            },
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })

    context('.pAccumulator._skew', async () => {
      const STORAGE_SIZE = 23
      it('saves if in range (above)', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          pAccumulator: {
            _value: 0,
            _skew: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await global.read()
        expect(value.pAccumulator._skew).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          pAccumulator: {
            _value: 0,
            _skew: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          },
        })
        const value = await global.read()
        expect(value.pAccumulator._skew).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if currentId out of range (above)', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            pAccumulator: {
              _value: 0,
              _skew: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })

      it('reverts if currentId out of range (below)', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            pAccumulator: {
              _value: 0,
              _skew: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            },
          }),
        ).to.be.revertedWithCustomError(globalStorageLib, 'GlobalStorageInvalidError')
      })
    })
  })

  describe('#update', async () => {
    context('zero settlement fee', async () => {
      it('no fees', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0),
          generateOracleReceipt(0),
        )

        const value = await global.read()
        expect(value.latestId).to.equal(1)
      })

      it('risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.1')),
          generateOracleReceipt(0),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(111)
        expect(value.riskFee).to.equal(12)
      })

      it('risk fee 100%', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('1.0')),
          generateOracleReceipt(0),
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(123)
      })

      it('risk fee >100%', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('1.1')),
            generateOracleReceipt(0),
          ),
        ).revertedWithPanic(0x11)
      })

      it('oracle fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(111)
        expect(value.oracleFee).to.equal(12)
      })

      it('oracle fee 100%', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0),
          generateOracleReceipt(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(123)
      })

      it('oracle fee >100%', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(0),
            generateOracleReceipt(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('oracle / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.3')),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(78)
        expect(value.oracleFee).to.equal(12)
        expect(value.riskFee).to.equal(33)
      })

      it('oracle / risk fee 100%', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('1.0')),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.riskFee).to.equal(111)
      })

      it('exposure', async () => {
        await global.update(
          1,
          generateAccumulationResult(0, 0, 123),
          generateMarketParameter(parse6decimal('0.9')),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.exposure).to.equal(123)
      })
    })

    context('non-zero settlement fee', async () => {
      it('no fees', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(0),
          generateOracleReceipt(0),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(456)
      })

      it('risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('0.1')),
          generateOracleReceipt(0),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(111)
        expect(value.oracleFee).to.equal(456)
        expect(value.riskFee).to.equal(12)
      })

      it('risk fee 100%', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('1.0')),
          generateOracleReceipt(0),
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(123)
        expect(value.oracleFee).to.equal(456)
      })

      it('risk fee >100%', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(parse6decimal('1.1')),
            generateOracleReceipt(0),
          ),
        ).revertedWithPanic(0x11)
      })

      it('oracle fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(0),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(111)
        expect(value.oracleFee).to.equal(468)
      })

      it('oracle fee 100%', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(0),
          generateOracleReceipt(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(579)
      })

      it('oracle fee >100%', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(0),
            generateOracleReceipt(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('oracle / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('0.3')),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(78)
        expect(value.oracleFee).to.equal(468)
        expect(value.riskFee).to.equal(33)
      })

      it('oracle / risk fee 100%', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('1.0')),
          generateOracleReceipt(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(0)
        expect(value.oracleFee).to.equal(468)
        expect(value.riskFee).to.equal(111)
      })
    })
  })
})
