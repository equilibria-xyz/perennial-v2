import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, utils } from 'ethers'
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
  let comptroller: SignerWithAddress
  let coordinator: SignerWithAddress
  let coordinatorContract: Coordinator
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
      min: parse6decimal('-1.20'),
      max: parse6decimal('1.20'),
    },
    minMargin: parse6decimal('500'),
    minMaintenance: parse6decimal('500'),
    staleAfter: 7200,
    makerReceiveOnly: false,
  }

  beforeEach(async () => {
    ;[owner, comptroller, coordinator] = await ethers.getSigners()
    market = await smock.fake<IMarket>('IMarket')
    token = await smock.fake<IERC20Metadata>('IERC20Metadata')
    token.transfer.returns(true)
    market.token.returns(token.address)

    coordinatorContract = await new Coordinator__factory(owner).deploy()
  })

  describe('#constructor', () => {
    it('should set the owner', async () => {
      expect(await coordinatorContract.owner()).to.eq(owner.address)
    })

    it('should leave the comptroller and coordinator uninitialized', async () => {
      expect(await coordinatorContract.comptroller()).to.eq(constants.AddressZero)
      expect(await coordinatorContract.coordinator()).to.eq(constants.AddressZero)
    })
  })

  describe('#setComptroller', () => {
    it('should revert if not called by the owner', async () => {
      await expect(
        coordinatorContract.connect(comptroller).setComptroller(comptroller.address),
      ).to.be.revertedWithCustomError(coordinatorContract, 'OwnableNotOwnerError')
    })

    it('should set the comptroller', async () => {
      await coordinatorContract.setComptroller(comptroller.address)
      expect(await coordinatorContract.comptroller()).to.eq(comptroller.address)
    })
  })

  describe('#setCoordinator', () => {
    it('should revert if not called by the owner', async () => {
      await expect(
        coordinatorContract.connect(coordinator).setCoordinator(coordinator.address),
      ).to.be.revertedWithCustomError(coordinatorContract, 'OwnableNotOwnerError')
    })

    it('should set the coordinator', async () => {
      await coordinatorContract.setCoordinator(coordinator.address)
      expect(await coordinatorContract.coordinator()).to.eq(coordinator.address)
    })
  })

  describe('#claimFee', () => {
    it('should revert if not called by the comptroller', async () => {
      await expect(coordinatorContract.connect(owner).claimFee(market.address)).to.be.revertedWithCustomError(
        coordinatorContract,
        'NotComptroller',
      )
    })

    it('should call claimFee on the market', async () => {
      await coordinatorContract.setComptroller(comptroller.address)
      await coordinatorContract.connect(comptroller).claimFee(market.address)
      expect(market.claimFee).to.have.been.calledWith(coordinatorContract.address)
      expect(token.transfer).to.have.been.calledWith(comptroller.address, 0)
    })
  })

  describe('#updateRiskParameter', () => {
    it('should revert if not called by the coordinator', async () => {
      await expect(
        coordinatorContract.connect(owner).updateRiskParameter(market.address, riskParameter),
      ).to.be.revertedWithCustomError(coordinatorContract, 'NotCoordinator')
    })

    it('should call updateRiskParameters on the market', async () => {
      await coordinatorContract.setCoordinator(coordinator.address)
      await coordinatorContract.connect(coordinator).updateRiskParameter(market.address, riskParameter)
      expect(market.updateRiskParameter).to.have.been.called
    })
  })
})
