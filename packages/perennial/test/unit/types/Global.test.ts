import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { GlobalTester, GlobalTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)
describe.only('Global', () => {
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

    context('.pAccumulator._value', async () => {
      const STORAGE_SIZE = 31
      it('saves if in range (above)', async () => {
        await global.store({
          currentId: 0,
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
        await global.incrementFees(
          123,
          0,
          {
            closed: false,
            fundingFee: 0,
            interestFee: 0,
            oracleFee: 0,
            positionFee: 0,
            riskFee: 0,
          },
          {
            liquidationFee: 0,
            maxLiquidationFee: 0,
            maxPendingIds: 0,
            minCollateral: 0,
            protocolFee: 0,
            settlementFee: 0,
          },
        )

        const value = await global.read()
        expect(value.donation).to.equal(123)
      })

      it('protocol fee', async () => {
        await global.incrementFees(
          123,
          0,
          {
            closed: false,
            fundingFee: 0,
            interestFee: 0,
            oracleFee: 0,
            positionFee: 0,
            riskFee: 0,
          },
          {
            liquidationFee: 0,
            maxLiquidationFee: 0,
            maxPendingIds: 0,
            minCollateral: 0,
            protocolFee: parse6decimal('0.1'),
            settlementFee: 0,
          },
        )

        const value = await global.read()
        expect(value.protocolFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('risk fee', async () => {
        await global.incrementFees(
          123,
          0,
          {
            closed: false,
            fundingFee: 0,
            interestFee: 0,
            oracleFee: 0,
            positionFee: 0,
            riskFee: parse6decimal('0.1'),
          },
          {
            liquidationFee: 0,
            maxLiquidationFee: 0,
            maxPendingIds: 0,
            minCollateral: 0,
            protocolFee: 0,
            settlementFee: 0,
          },
        )

        const value = await global.read()
        expect(value.riskFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle fee', async () => {
        await global.incrementFees(
          123,
          0,
          {
            closed: false,
            fundingFee: 0,
            interestFee: 0,
            oracleFee: parse6decimal('0.1'),
            positionFee: 0,
            riskFee: 0,
          },
          {
            liquidationFee: 0,
            maxLiquidationFee: 0,
            maxPendingIds: 0,
            minCollateral: 0,
            protocolFee: 0,
            settlementFee: 0,
          },
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.donation).to.equal(111)
      })

      it('oracle / risk fee', async () => {
        await global.incrementFees(
          123,
          0,
          {
            closed: false,
            fundingFee: 0,
            interestFee: 0,
            oracleFee: parse6decimal('0.1'),
            positionFee: 0,
            riskFee: parse6decimal('0.3'),
          },
          {
            liquidationFee: 0,
            maxLiquidationFee: 0,
            maxPendingIds: 0,
            minCollateral: 0,
            protocolFee: 0,
            settlementFee: 0,
          },
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
          {
            closed: false,
            fundingFee: 0,
            interestFee: 0,
            oracleFee: parse6decimal('0.1'),
            positionFee: 0,
            riskFee: parse6decimal('0.9'),
          },
          {
            liquidationFee: 0,
            maxLiquidationFee: 0,
            maxPendingIds: 0,
            minCollateral: 0,
            protocolFee: 0,
            settlementFee: 0,
          },
        )

        const value = await global.read()
        expect(value.oracleFee).to.equal(12)
        expect(value.riskFee).to.equal(111)
        expect(value.donation).to.equal(0)
      })

      it('oracle / risk fee over', async () => {
        await expect(
          global.incrementFees(
            123,
            0,
            {
              closed: false,
              fundingFee: 0,
              interestFee: 0,
              oracleFee: parse6decimal('0.1'),
              positionFee: 0,
              riskFee: parse6decimal('1.0'),
            },
            {
              liquidationFee: 0,
              maxLiquidationFee: 0,
              maxPendingIds: 0,
              minCollateral: 0,
              protocolFee: 0,
              settlementFee: 0,
            },
          ),
        ).revertedWithPanic(0x11)
      })

      // TODO: protocol / risk

      // TODO: protocol / oracle

      // TODO: protocol / oracle / risk
    })

    // TODO: keeper
  })

  describe('#update', async () => {
    it('updates the latestPrice', async () => {
      await global.update(123)
      expect((await global.read()).latestPrice).to.equal(123)

      await global.update(456)
      expect((await global.read()).latestPrice).to.equal(456)

      await global.update(0)
      expect((await global.read()).latestPrice).to.equal(0)
    })
  })
})
