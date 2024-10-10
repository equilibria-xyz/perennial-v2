import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  RiskParameterStorageLib,
  RiskParameterStorageLib__factory,
  RiskParameterTester,
  RiskParameterTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { RiskParameterStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal } from '../../../../common/testutil/types'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'

const { ethers } = HRE
use(smock.matchers)

export const VALID_RISK_PARAMETER: RiskParameterStruct = {
  margin: 15,
  maintenance: 1,
  takerFee: {
    linearFee: 2,
    proportionalFee: 3,
    adiabaticFee: 18,
    scale: 4000000,
  },
  makerFee: {
    linearFee: 5,
    proportionalFee: 6,
    scale: 17000000,
  },
  makerLimit: 7000000,
  efficiencyLimit: 500000,
  liquidationFee: 9,
  utilizationCurve: {
    minRate: 101,
    maxRate: 102,
    targetRate: 103,
    targetUtilization: 104,
  },
  pController: {
    k: 201,
    min: 203,
    max: 202,
  },
  minMargin: 16,
  minMaintenance: 12,
  staleAfter: 13,
  makerReceiveOnly: false,
}

const PROTOCOL_PARAMETER: ProtocolParameterStruct = {
  maxFee: parse6decimal('1'),
  maxLiquidationFee: BigNumber.from(2).pow(32).sub(1),
  maxCut: parse6decimal('0.9'),
  maxRate: parse6decimal('0.8'),
  minMaintenance: 1,
  minEfficiency: parse6decimal('0.5'),
  referralFee: 0,
  minScale: parse6decimal('0.10'),
  maxStaleAfter: 3600,
}

describe('RiskParameter', () => {
  let owner: SignerWithAddress

  let riskParameterStorage: RiskParameterStorageLib
  let riskParameter: RiskParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    riskParameterStorage = await new RiskParameterStorageLib__factory(owner).deploy()
    riskParameter = await new RiskParameterTester__factory(
      {
        'contracts/types/RiskParameter.sol:RiskParameterStorageLib': riskParameterStorage.address,
      },
      owner,
    ).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await riskParameter.validateAndStore(VALID_RISK_PARAMETER, PROTOCOL_PARAMETER)

      const value = await riskParameter.read()
      expect(value.margin).to.equal(15)
      expect(value.maintenance).to.equal(1)
      expect(value.takerFee.linearFee).to.equal(2)
      expect(value.takerFee.proportionalFee).to.equal(3)
      expect(value.takerFee.adiabaticFee).to.equal(18)
      expect(value.takerFee.scale).to.equal(4000000)
      expect(value.makerFee.linearFee).to.equal(5)
      expect(value.makerFee.proportionalFee).to.equal(6)
      expect(value.makerFee.scale).to.equal(17000000)
      expect(value.makerLimit).to.equal(7000000)
      expect(value.efficiencyLimit).to.equal(500000)
      expect(value.liquidationFee).to.equal(9)
      expect(value.utilizationCurve.minRate).to.equal(101)
      expect(value.utilizationCurve.maxRate).to.equal(102)
      expect(value.utilizationCurve.targetRate).to.equal(103)
      expect(value.utilizationCurve.targetUtilization).to.equal(104)
      expect(value.pController.k).to.equal(201)
      expect(value.pController.min).to.equal(203)
      expect(value.pController.max).to.equal(202)
      expect(value.minMargin).to.equal(16)
      expect(value.minMaintenance).to.equal(12)
      expect(value.staleAfter).to.equal(13)
      expect(value.makerReceiveOnly).to.equal(false)
    })

    describe('.makerLimit', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              ...VALID_RISK_PARAMETER.takerFee,
              scale: BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000),
            }, // allow larger makerLimit
            makerFee: {
              ...VALID_RISK_PARAMETER.makerFee,
              scale: BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000),
            }, // allow larger makerLimit
            makerLimit: BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerLimit).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000))
      })

      it('reverts if out of range', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerLimit: BigNumber.from(2).pow(STORAGE_SIZE).mul(1000000),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if truncation would violate protocol limits', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerLimit: parse6decimal('3.9'),
              efficiencyLimit: parse6decimal('1'),
              takerFee: {
                linearFee: 2,
                proportionalFee: 3,
                adiabaticFee: 18,
                scale: parse6decimal('1.95'),
              },
            },
            {
              ...PROTOCOL_PARAMETER,
              minScale: parse6decimal('0.50'),
              minEfficiency: parse6decimal('1'),
            },
          ),
          // truncation of makerLimit and takerFee.scale leave makerLimit=3, takerFee.scale=1,
          // exceeding protocol efficiency limit
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.margin', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            margin: parse6decimal('1').sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.margin).to.equal(parse6decimal('1').sub(1))
      })

      it('reverts if invalid (below)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              margin: 0,
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if invalid (above)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              margin: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if invalid (maintenance)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              maintenance: 11,
              margin: 10,
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.maintenance', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            maintenance: parse6decimal('1').sub(1),
            margin: parse6decimal('1').sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.maintenance).to.equal(parse6decimal('1').sub(1))
      })

      it('reverts if invalid (below)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              maintenance: 0,
              margin: 0,
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if invalid (above)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              maintenance: parse6decimal('1').add(1),
              margin: parse6decimal('1').add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
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

    describe('.pController.max', () => {
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.pController.min', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            pController: {
              ...VALID_RISK_PARAMETER.pController,
              min: -parse6decimal('0.8'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.pController.min).to.equal(parse6decimal('-0.8'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              pController: {
                ...VALID_RISK_PARAMETER.pController,
                min: -parse6decimal('0.8').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerFee.linearFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              ...VALID_RISK_PARAMETER.takerFee,
              linearFee: parse6decimal('1'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerFee.linearFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                linearFee: parse6decimal('1').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerFee.proportionalFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              ...VALID_RISK_PARAMETER.takerFee,
              proportionalFee: parse6decimal('1'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerFee.proportionalFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                linearFee: parse6decimal('1').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerFee.adiabaticFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              ...VALID_RISK_PARAMETER.takerFee,
              adiabaticFee: parse6decimal('1'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerFee.adiabaticFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                adiabaticFee: parse6decimal('1').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.takerFee.scale', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            takerFee: {
              ...VALID_RISK_PARAMETER.takerFee,
              scale: BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.takerFee.scale).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000))
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                scale: parse6decimal('1.4').sub(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              takerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                scale: BigNumber.from(2).pow(STORAGE_SIZE).mul(1000000),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerFee.linearFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerFee: {
              ...VALID_RISK_PARAMETER.makerFee,
              linearFee: parse6decimal('1'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerFee.linearFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                linearFee: parse6decimal('1').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerFee.proportionalFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerFee: {
              ...VALID_RISK_PARAMETER.makerFee,
              proportionalFee: parse6decimal('1'),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerFee.proportionalFee).to.equal(parse6decimal('1'))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                linearFee: parse6decimal('1').add(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.makerFee.scale', () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            makerFee: {
              ...VALID_RISK_PARAMETER.makerFee,
              scale: BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000),
            },
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.makerFee.scale).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1).mul(1000000))
      })

      it('reverts if out of range (below)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerFee: {
                ...VALID_RISK_PARAMETER.takerFee,
                scale: parse6decimal('1.4').sub(1),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if out of range (above)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              makerFee: {
                ...VALID_RISK_PARAMETER.makerFee,
                scale: BigNumber.from(2).pow(STORAGE_SIZE).mul(1000000),
              },
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.minMargin', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            minMargin: BigNumber.from(2).pow(48).sub(1),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.minMargin).to.equal(BigNumber.from(2).pow(48).sub(1))
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              minMargin: BigNumber.from(2).pow(48),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if less than minMaintenance', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              minMaintenance: BigNumber.from(2).pow(48).sub(1),
              minMargin: BigNumber.from(2).pow(48).sub(1).sub(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.minMaintenance', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            minMargin: BigNumber.from(2).pow(48).sub(1),
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
              minMargin: BigNumber.from(2).pow(48),
              minMaintenance: BigNumber.from(2).pow(48),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.staleAfter', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            staleAfter: BigNumber.from(1800),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.staleAfter).to.equal(BigNumber.from(1800))
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
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if invalid', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              staleAfter: BigNumber.from(PROTOCOL_PARAMETER.maxStaleAfter).add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.liquidationFee', () => {
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            liquidationFee: parse6decimal('0.9'),
            minMargin: parse6decimal('0.9'),
            minMaintenance: parse6decimal('0.9'),
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
              liquidationFee: BigNumber.from(PROTOCOL_PARAMETER.maxLiquidationFee).add(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })

    describe('.efficiencyLimit', () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await riskParameter.validateAndStore(
          {
            ...VALID_RISK_PARAMETER,
            efficiencyLimit: parse6decimal('0.5'),
          },
          PROTOCOL_PARAMETER,
        )
        const value = await riskParameter.read()
        expect(value.efficiencyLimit).to.equal(parse6decimal('0.5'))
      })

      it('reverts if invalid (below)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              efficiencyLimit: parse6decimal('0.5').sub(1),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })

      it('reverts if invalid (above)', async () => {
        await expect(
          riskParameter.validateAndStore(
            {
              ...VALID_RISK_PARAMETER,
              efficiencyLimit: BigNumber.from(2).pow(STORAGE_SIZE),
            },
            PROTOCOL_PARAMETER,
          ),
        ).to.be.revertedWithCustomError(riskParameterStorage, 'RiskParameterStorageInvalidError')
      })
    })
  })
})
