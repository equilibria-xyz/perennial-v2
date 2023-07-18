import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { RiskParameterTester, RiskParameterTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { RiskParameterStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

describe('RiskParameter', () => {
  let owner: SignerWithAddress

  let riskParameter: RiskParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    riskParameter = await new RiskParameterTester__factory(owner).deploy()
  })

  describe('#store', () => {
    const VALID_RISK_PARAMETER: RiskParameterStruct = {
      maintenance: 1,
      takerFee: 2,
      takerSkewFee: 3,
      takerImpactFee: 4,
      makerFee: 5,
      makerImpactFee: 6,
      makerLimit: 7,
      efficiencyLimit: 8,
      liquidationFee: 9,
      minLiquidationFee: 10,
      maxLiquidationFee: 11,
      utilizationCurve: {
        minRate: 1,
        maxRate: 2,
        targetRate: 3,
        targetUtilization: 4,
      },
      pController: {
        k: 1,
        max: 2,
      },
      minMaintenance: 12,
      staleAfter: 13,
      makerReceiveOnly: false,
    }

    it('stores a new value', async () => {
      await riskParameter.store(VALID_RISK_PARAMETER)

      const value = await riskParameter.read()
      expect(value.maintenance).to.equal(1)
      expect(value.takerFee).to.equal(2)
      expect(value.takerSkewFee).to.equal(3)
      expect(value.takerImpactFee).to.equal(4)
      expect(value.makerFee).to.equal(5)
      expect(value.makerImpactFee).to.equal(6)
      expect(value.makerLimit).to.equal(7)
      expect(value.efficiencyLimit).to.equal(8)
      expect(value.liquidationFee).to.equal(9)
      expect(value.minLiquidationFee).to.equal(10)
      expect(value.maxLiquidationFee).to.equal(11)
      expect(value.utilizationCurve.minRate).to.equal(1)
      expect(value.utilizationCurve.maxRate).to.equal(2)
      expect(value.utilizationCurve.targetRate).to.equal(3)
      expect(value.utilizationCurve.targetUtilization).to.equal(4)
      expect(value.pController.k).to.equal(1)
      expect(value.pController.max).to.equal(2)
      expect(value.minMaintenance).to.equal(12)
      expect(value.staleAfter).to.equal(13)
      expect(value.makerReceiveOnly).to.equal(false)
    })

    describe('.makerLimit', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          makerLimit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.makerLimit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            makerLimit: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.pController_k', () => {
      const STORAGE_SIZE = 40
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          pController: {
            ...VALID_RISK_PARAMETER.pController,
            k: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await riskParameter.read()
        expect(value.pController.k).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            pController: {
              ...VALID_RISK_PARAMETER.pController,
              k: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_minRate', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          utilizationCurve: {
            ...VALID_RISK_PARAMETER.utilizationCurve,
            minRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await riskParameter.read()
        expect(value.utilizationCurve.minRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              minRate: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_maxRate', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          utilizationCurve: {
            ...VALID_RISK_PARAMETER.utilizationCurve,
            maxRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await riskParameter.read()
        expect(value.utilizationCurve.maxRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              maxRate: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_targetUtilization', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          utilizationCurve: {
            ...VALID_RISK_PARAMETER.utilizationCurve,
            targetUtilization: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await riskParameter.read()
        expect(value.utilizationCurve.targetUtilization).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              targetUtilization: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerFee', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          takerFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.takerFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            takerFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerFee', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          makerFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.makerFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            makerFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.maintenance', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          maintenance: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.maintenance).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            maintenance: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerReceiveOnly', () => {
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          makerReceiveOnly: true,
        })
        const value = await riskParameter.read()
        expect(value.makerReceiveOnly).to.be.true
      })
    })

    describe('.utilizationCurve_targetRate', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          utilizationCurve: {
            ...VALID_RISK_PARAMETER.utilizationCurve,
            targetRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await riskParameter.read()
        expect(value.utilizationCurve.targetRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              targetRate: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.pController_max', () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          pController: {
            ...VALID_RISK_PARAMETER.pController,
            max: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
        })
        const value = await riskParameter.read()
        expect(value.pController.max).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            pController: {
              ...VALID_RISK_PARAMETER.pController,
              max: BigNumber.from(2).pow(STORAGE_SIZE),
            },
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerSkewFee', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          takerSkewFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.takerSkewFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            takerSkewFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerImpactFee', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          takerImpactFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.takerImpactFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            takerImpactFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerImpactFee', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          makerImpactFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.makerImpactFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            makerImpactFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.minMaintenance', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          minMaintenance: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.minMaintenance).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            minMaintenance: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.staleAfter', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          staleAfter: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.staleAfter).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            staleAfter: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.liquidationFee', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          liquidationFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.liquidationFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            liquidationFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.minLiquidationFee', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          minLiquidationFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.minLiquidationFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            minLiquidationFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.maxLiquidationFee', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          maxLiquidationFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.maxLiquidationFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            maxLiquidationFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.efficiencyLimit', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.store({
          ...VALID_RISK_PARAMETER,
          efficiencyLimit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await riskParameter.read()
        expect(value.efficiencyLimit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.store({
            ...VALID_RISK_PARAMETER,
            efficiencyLimit: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })
  })
})
