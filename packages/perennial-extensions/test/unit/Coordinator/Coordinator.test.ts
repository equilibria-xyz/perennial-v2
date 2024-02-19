import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { Coordinator, Coordinator__factory, IERC20Metadata, IMarket } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Coordinator', () => {
  let market: FakeContract<IMarket>
  let token: FakeContract<IERC20Metadata>
  let owner: SignerWithAddress
  let feeClaimer: SignerWithAddress
  let riskParameterUpdater: SignerWithAddress
  let coordinator: Coordinator
  const riskParameter = {
    margin: parse6decimal('0.3'),
    maintenance: parse6decimal('0.3'),
    takerFee: {
      linearFee: 0,
      proportionalFee: 0,
      adiabaticFee: 0,
      scale: parse6decimal('100'),
    },
    makerFee: {
      linearFee: 0,
      proportionalFee: 0,
      adiabaticFee: 0,
      scale: parse6decimal('100'),
    },
    makerLimit: parse6decimal('1000'),
    efficiencyLimit: parse6decimal('0.2'),
    liquidationFee: parse6decimal('0.50'),
    utilizationCurve: {
      minRate: 0,
      maxRate: parse6decimal('5.00'),
      targetRate: parse6decimal('0.80'),
      targetUtilization: parse6decimal('0.80'),
    },
    pController: {
      k: parse6decimal('40000'),
      max: parse6decimal('1.20'),
    },
    minMargin: parse6decimal('500'),
    minMaintenance: parse6decimal('500'),
    staleAfter: 7200,
    makerReceiveOnly: false,
  }

  beforeEach(async () => {
    ;[owner, feeClaimer, riskParameterUpdater] = await ethers.getSigners()
    market = await smock.fake<IMarket>('IMarket')
    token = await smock.fake<IERC20Metadata>('IERC20Metadata')
    token.transfer.returns(true)
    market.token.returns(token.address)

    coordinator = await new Coordinator__factory(owner).deploy()
  })

  describe('#constructor', () => {
    it('should set the owner', async () => {
      expect(await coordinator.owner()).to.eq(owner.address)
    })

    it('should leave the feeClaimer and riskParameterUpdater uninitialized', async () => {
      expect(await coordinator.feeClaimer()).to.eq(constants.AddressZero)
      expect(await coordinator.riskParameterUpdater()).to.eq(constants.AddressZero)
    })
  })

  describe('#setFeeClaimer', () => {
    it('should revert if not called by the owner', async () => {
      await expect(coordinator.connect(feeClaimer).setFeeClaimer(feeClaimer.address)).to.be.revertedWithCustomError(
        coordinator,
        'OwnableNotOwnerError',
      )
    })

    it('should set the feeClaimer', async () => {
      await coordinator.setFeeClaimer(feeClaimer.address)
      expect(await coordinator.feeClaimer()).to.eq(feeClaimer.address)
    })
  })

  describe('#setRiskParameterUpdater', () => {
    it('should revert if not called by the owner', async () => {
      await expect(
        coordinator.connect(riskParameterUpdater).setRiskParameterUpdater(riskParameterUpdater.address),
      ).to.be.revertedWithCustomError(coordinator, 'OwnableNotOwnerError')
    })

    it('should set the riskParameterUpdater', async () => {
      await coordinator.setRiskParameterUpdater(riskParameterUpdater.address)
      expect(await coordinator.riskParameterUpdater()).to.eq(riskParameterUpdater.address)
    })
  })

  describe('#claimFee', () => {
    it('should revert if not called by the feeClaimer', async () => {
      await expect(coordinator.connect(owner).claimFee(market.address)).to.be.revertedWithCustomError(
        coordinator,
        'NotFeeClaimer',
      )
    })

    it('should call claimFee on the market', async () => {
      await coordinator.setFeeClaimer(feeClaimer.address)
      await coordinator.connect(feeClaimer).claimFee(market.address)
      expect(market.claimFee).to.have.been.called
      expect(token.transfer).to.have.been.called
    })
  })

  describe('#updateRiskParameter', () => {
    it('should revert if not called by the riskParameterUpdater', async () => {
      await expect(
        coordinator.connect(owner).updateRiskParameter(market.address, riskParameter),
      ).to.be.revertedWithCustomError(coordinator, 'NotRiskParameterUpdater')
    })

    it('should call updateRiskParameters on the market', async () => {
      await coordinator.setRiskParameterUpdater(riskParameterUpdater.address)
      await coordinator.connect(riskParameterUpdater).updateRiskParameter(market.address, riskParameter)
      expect(market.updateRiskParameter).to.have.been.called
    })
  })
})
