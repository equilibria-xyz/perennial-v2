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
import { parse6decimal } from '../../../../common/testutil/types'
import {
  GlobalStruct,
  MarketParameterStruct,
  VersionAccumulationResultStruct,
} from '../../../types/generated/contracts/Market'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'

const { ethers } = HRE
use(smock.matchers)

const DEFAULT_GLOBAL: GlobalStruct = {
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
  exposure: 0,
}

function generateAccumulationResult(
  marketFee: BigNumberish,
  settlementFee: BigNumberish,
  marketExposure: BigNumberish,
): VersionAccumulationResultStruct {
  const interestFee = BigNumber.from(marketFee).div(10)
  const fundingFee = BigNumber.from(marketFee).div(5)
  const positionFeeProtocol = BigNumber.from(marketFee).sub(interestFee).sub(fundingFee)

  return {
    positionFee: 0,
    positionFeeMaker: 0,
    positionFeeProtocol,
    positionFeeSubtractive: 0,
    positionFeeExposure: 0,
    positionFeeExposureMaker: 0,
    positionFeeExposureProtocol: marketExposure,
    positionFeeImpact: 0,
    fundingMaker: 0,
    fundingLong: 0,
    fundingShort: 0,
    fundingFee,
    interestMaker: 0,
    interestLong: 0,
    interestShort: 0,
    interestFee,
    pnlMaker: 0,
    pnlLong: 0,
    pnlShort: 0,
    settlementFee,
    liquidationFee: 0,
  }
}

function generateMarketParameter(oracleFee: BigNumberish, riskFee: BigNumberish): MarketParameterStruct {
  return {
    fundingFee: 0,
    interestFee: 0,
    oracleFee,
    positionFee: 0,
    settlementFee: 0,
    maxPendingGlobal: 0,
    maxPendingLocal: 0,
    riskFee,
    closed: false,
    settle: false,
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
    referralFee: 0,
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
        donation: 5,
        pAccumulator: {
          _value: 6,
          _skew: 7,
        },
        exposure: 8,
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

    context('.donation', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await global.store({
          ...DEFAULT_GLOBAL,
          donation: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await global.read()
        expect(value.donation).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          global.store({
            ...DEFAULT_GLOBAL,
            donation: BigNumber.from(2).pow(STORAGE_SIZE),
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
          generateMarketParameter(0, 0),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.latestId).to.equal(1)
        expect(value.donation).to.equal(123)
      })

      it('protocol fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0, 0),
          generateProtocolParameter(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.riskFee).to.equal(36)
        expect(value.donation).to.equal(75)
      })

      it('oracle / risk fee zero donation', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(0),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.riskFee).to.equal(9)
        expect(value.donation).to.equal(90)
      })

      it('protocol / risk fee zero marketFee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.riskFee).to.equal(0)
        expect(value.donation).to.equal(0)
      })

      it('protocol / risk fee zero donation', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(0, parse6decimal('0.1')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee oracle over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(0, parse6decimal('1.1')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(9)
        expect(value.donation).to.equal(90)
      })

      it('protocol / oracle fee zero marketFee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(0)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle fee zero donation', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('0.1'), 0),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee oracle over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('1.1'), 0),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
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
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
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
        await global.update(
          1,
          generateAccumulationResult(123, 0, 0),
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.9')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(9)
        expect(value.riskFee).to.equal(89)
        expect(value.donation).to.equal(1) // due to rounding
      })

      it('exposure', async () => {
        await global.update(
          1,
          generateAccumulationResult(0, 0, 123),
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.9')),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.exposure).to.equal(123)
      })

      it('protocol / oracle / risk fee protocol over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee oracle over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })
    })

    context('non-zero settlement fee', async () => {
      it('no fees', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(0, 0),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.donation).to.equal(123)
      })

      it('protocol fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(0, 0),
          generateProtocolParameter(parse6decimal('0.1')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(0, parse6decimal('0.1')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(468)
        expect(value.donation).to.equal(111)
      })

      it('oracle / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
          generateProtocolParameter(0),
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(468)
        expect(value.riskFee).to.equal(36)
        expect(value.donation).to.equal(75)
      })

      it('oracle / risk fee zero donation', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(0),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(0, parse6decimal('0.1')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / risk fee oracle over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(0, parse6decimal('1.1')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('0.2')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(24)
        expect(value.oracleFee).to.equal(465)
        expect(value.donation).to.equal(90)
      })

      it('protocol / oracle fee zero marketFee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
          generateMarketParameter(parse6decimal('0.1'), 0),
          generateProtocolParameter(parse6decimal('1.0')),
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(123)
        expect(value.oracleFee).to.equal(456)
        expect(value.donation).to.equal(0)
      })

      it('protocol / oracle fee zero donation', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 0, 0),
            generateMarketParameter(parse6decimal('0.1'), 0),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle fee oracle over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(parse6decimal('1.1'), 0),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee', async () => {
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
        await global.update(
          1,
          generateAccumulationResult(123, 456, 0),
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
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('0.3')),
            generateProtocolParameter(parse6decimal('1.1')),
          ),
        ).revertedWithPanic(0x11)
      })

      it('protocol / oracle / risk fee oracle over', async () => {
        await expect(
          global.update(
            1,
            generateAccumulationResult(123, 456, 0),
            generateMarketParameter(parse6decimal('0.1'), parse6decimal('1.0')),
            generateProtocolParameter(parse6decimal('0.2')),
          ),
        ).revertedWithPanic(0x11)
      })
    })
  })
})
