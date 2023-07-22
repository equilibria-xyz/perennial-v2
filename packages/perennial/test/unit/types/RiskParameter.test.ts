import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { RiskParameterTester, RiskParameterTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { RiskParameterStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal } from '../../../../common/testutil/types'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'

const { ethers } = HRE
use(smock.matchers)

export const VALID_RISK_PARAMETER: RiskParameterStruct = {
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
    minRate: 101,
    maxRate: 102,
    targetRate: 103,
    targetUtilization: 104,
  },
  pController: {
    k: 201,
    max: 202,
  },
  minMaintenance: 12,
  staleAfter: 13,
  makerReceiveOnly: false,
  virtualTaker: 14,
}

const PROTOCOL_PARAMETER: ProtocolParameterStruct = {
  protocolFee: 0,
  maxFee: parse6decimal('1'),
  maxFeeAbsolute: BigNumber.from(2).pow(48).sub(1),
  maxCut: parse6decimal('0.9'),
  maxRate: parse6decimal('0.8'),
  minMaintenance: 1,
  minEfficiency: 2,
}

describe('RiskParameter', () => {
  let owner: SignerWithAddress

  let riskParameter: RiskParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    riskParameter = await new RiskParameterTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await riskParameter.validateAndStore(VALID_RISK_PARAMETER, PROTOCOL_PARAMETER)

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
      expect(value.utilizationCurve.minRate).to.equal(101)
      expect(value.utilizationCurve.maxRate).to.equal(102)
      expect(value.utilizationCurve.targetRate).to.equal(103)
      expect(value.utilizationCurve.targetUtilization).to.equal(104)
      expect(value.pController.k).to.equal(201)
      expect(value.pController.max).to.equal(202)
      expect(value.minMaintenance).to.equal(12)
      expect(value.staleAfter).to.equal(13)
      expect(value.makerReceiveOnly).to.equal(false)
      expect(value.virtualTaker).to.equal(14)
    })

    describe('.makerLimit', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerLimit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerLimit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerLimit: BigNumber.from(2).pow(STORAGE_SIZE),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.pController_k', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            pController: {
              ...VALID_RISK_PARAMETER.pController,
              k: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.pController.k).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              pController: {
                ...VALID_RISK_PARAMETER.pController,
                k: BigNumber.from(2).pow(STORAGE_SIZE),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_minRate', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              minRate: parse6decimal('0.8'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.utilizationCurve.minRate).to.equal(parse6decimal('0.8'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              utilizationCurve: {
                ...VALID_RISK_PARAMETER.utilizationCurve,
                minRate: parse6decimal('0.8').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_maxRate', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              maxRate: parse6decimal('0.8'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.utilizationCurve.maxRate).to.equal(parse6decimal('0.8'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              utilizationCurve: {
                ...VALID_RISK_PARAMETER.utilizationCurve,
                maxRate: parse6decimal('0.8').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_targetRate', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              targetRate: parse6decimal('0.8'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.utilizationCurve.targetRate).to.equal(parse6decimal('0.8'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              utilizationCurve: {
                ...VALID_RISK_PARAMETER.utilizationCurve,
                targetRate: parse6decimal('0.8').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.utilizationCurve_targetUtilization', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            utilizationCurve: {
              ...VALID_RISK_PARAMETER.utilizationCurve,
              targetUtilization: parse6decimal('1'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.utilizationCurve.targetUtilization).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              utilizationCurve: {
                ...VALID_RISK_PARAMETER.utilizationCurve,
                targetUtilization: parse6decimal('1').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.maintenance', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            maintenance: 1,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.maintenance).to.equal(1)
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              maintenance: 0,
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerReceiveOnly', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerReceiveOnly: true,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerReceiveOnly).to.be.true
      })
    })

    describe('.pController_max', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            pController: {
              ...VALID_RISK_PARAMETER.pController,
              max: parse6decimal('0.8'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.pController.max).to.equal(parse6decimal('0.8'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              pController: {
                ...VALID_RISK_PARAMETER.pController,
                max: parse6decimal('0.8').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerSkewFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerSkewFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerSkewFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerSkewFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerImpactFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerImpactFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerImpactFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerImpactFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerImpactFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerImpactFee: parse6decimal('1'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerImpactFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerImpactFee: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.minMaintenance', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            minMaintenance: BigNumber.from(2).pow(48).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.minMaintenance).to.equal(BigNumber.from(2).pow(48).sub(1))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              minMaintenance: BigNumber.from(2).pow(48),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })

      it('reverts if less than minLiquidationFee', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              minLiquidationFee: BigNumber.from(2).pow(48).sub(1),
              minMaintenance: BigNumber.from(2).pow(48).sub(1).sub(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.staleAfter', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            staleAfter: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.staleAfter).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              staleAfter: BigNumber.from(2).pow(STORAGE_SIZE),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.virtualTaker', () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            virtualTaker: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.virtualTaker).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              virtualTaker: BigNumber.from(2).pow(STORAGE_SIZE),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.liquidationFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            liquidationFee: parse6decimal('0.9'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.liquidationFee).to.equal(parse6decimal('0.9'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              liquidationFee: parse6decimal('0.9').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.minLiquidationFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            minLiquidationFee: BigNumber.from(2).pow(48).sub(1),
            minMaintenance: BigNumber.from(2).pow(48).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.minLiquidationFee).to.equal(BigNumber.from(2).pow(48).sub(1))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              minLiquidationFee: BigNumber.from(2).pow(48),
              minMaintenance: BigNumber.from(2).pow(48).sub(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.maxLiquidationFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            maxLiquidationFee: BigNumber.from(2).pow(48).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.maxLiquidationFee).to.equal(BigNumber.from(2).pow(48).sub(1))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              maxLiquidationFee: BigNumber.from(2).pow(48),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.efficiencyLimit', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            efficiencyLimit: 2,
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.efficiencyLimit).to.equal(2)
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              efficiencyLimit: 1,
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameter, 'RiskParameterStorageInvalidError')
      })
    })
  })
})
