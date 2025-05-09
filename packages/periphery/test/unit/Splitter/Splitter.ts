import { smock, FakeContract } from '@defi-wonderland/smock'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  IFeeCoordinator,
  FeeCoordinator__factory,
  FeeSplitter__factory,
  IEmptySetReserve,
  IERC20Metadata,
  IFeeSplitter,
  IMarket,
  IMarketFactory,
} from '../../../types/generated'

const { ethers } = HRE
use(smock.matchers)

describe.only('Splitter', () => {
  let marketA: FakeContract<IMarket>
  let marketB: FakeContract<IMarket>
  let dsu: FakeContract<IERC20Metadata>
  let usdc: FakeContract<IERC20Metadata>
  let reserve: FakeContract<IEmptySetReserve>
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let beneficiary: SignerWithAddress
  let beneficiaryA: SignerWithAddress
  let beneficiaryB: SignerWithAddress
  let marketFactory: FakeContract<IMarketFactory>
  let feeSplitterImpl: IFeeSplitter
  let feeCoordinator: IFeeCoordinator

  beforeEach(async () => {
    ;[owner, user, beneficiary, beneficiaryA, beneficiaryB] = await ethers.getSigners()
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    marketA = await smock.fake<IMarket>('IMarket')
    marketB = await smock.fake<IMarket>('IMarket')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    usdc = await smock.fake<IERC20Metadata>('IERC20Metadata')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    marketA.token.returns(dsu.address)
    marketB.token.returns(dsu.address)
    marketFactory.instances.whenCalledWith(marketA.address).returns(true)
    marketFactory.instances.whenCalledWith(marketB.address).returns(true)

    feeSplitterImpl = await new FeeSplitter__factory(owner).deploy(dsu.address, usdc.address, reserve.address)
    feeCoordinator = await new FeeCoordinator__factory(owner).deploy(marketFactory.address, feeSplitterImpl.address)
  })

  describe('#constructor', () => {
    it('should set the implementation and market factory', async () => {
      expect(await feeCoordinator.marketFactory()).to.eq(marketFactory.address)
      expect(await feeCoordinator.implementation()).to.eq(feeSplitterImpl.address)
    })
  })

  describe('initialized', () => {
    beforeEach(async () => {
      await feeCoordinator.initialize()
    })

    describe('#initialize', () => {
      it('should set the owner ', async () => {
        expect(await feeCoordinator.owner()).to.eq(owner.address)
      })

      it('should revert if called again', async () => {
        await expect(feeCoordinator.initialize()).to.be.revertedWithCustomError(
          feeCoordinator,
          'InitializableAlreadyInitializedError',
        )
      })
    })

    describe('#register', () => {
      it('should revert if market is not valid', async () => {
        const marketC = await smock.fake<IMarket>('IMarket')
        marketFactory.instances.whenCalledWith(marketC.address).returns(false)

        await expect(feeCoordinator.register(marketC.address)).to.be.revertedWithCustomError(
          feeCoordinator,
          'FeeCoordinatorInvalidMarketError',
        )
      })

      it('should regsiter valid market', async () => {
        await feeCoordinator.register(marketA.address)
        await feeCoordinator.register(marketB.address)

        expect(await feeCoordinator.markets()).to.deep.eq([marketA.address, marketB.address])
      })
    })

    describe('#create', () => {
      it('should revert if not called by the owner', async () => {
        await expect(feeCoordinator.connect(user).create(beneficiary.address)).to.be.revertedWithCustomError(
          feeCoordinator,
          'OwnableNotOwnerError',
        )
      })

      it('should create a new fee splitter', async () => {
        const feeSplitter = FeeSplitter__factory.connect(
          await feeCoordinator.callStatic.create(beneficiary.address),
          owner,
        )
        await feeCoordinator.connect(owner).create(beneficiary.address)

        expect(await feeCoordinator.instances(feeSplitter.address)).to.eq(true)
        expect(await feeSplitter.beneficiary()).to.eq(beneficiary.address)
      })
    })

    describe('#updateBeneficiary', () => {
      let feeSplitter: IFeeSplitter

      beforeEach(async () => {
        feeSplitter = FeeSplitter__factory.connect(await feeCoordinator.callStatic.create(beneficiary.address), owner)
        await feeCoordinator.connect(owner).create(beneficiary.address)
      })

      it('should revert if not called by the owner', async () => {
        await expect(feeSplitter.connect(user).updateBeneficiary(beneficiaryA.address)).to.be.revertedWithCustomError(
          feeSplitter,
          'InstanceNotOwnerError',
        )
      })

      it('should update the beneficiary', async () => {
        await expect(feeSplitter.updateBeneficiary(beneficiaryA.address))
          .to.emit(feeSplitter, 'BeneficiaryUpdated')
          .withArgs(beneficiaryA.address)
        expect(await feeSplitter.beneficiary()).to.eq(beneficiaryA.address)
      })
    })

    describe('#updateSplit', () => {
      let feeSplitter: IFeeSplitter

      beforeEach(async () => {
        feeSplitter = FeeSplitter__factory.connect(await feeCoordinator.callStatic.create(beneficiary.address), owner)
        await feeCoordinator.connect(owner).create(beneficiary.address)
      })

      it('should revert if not called by the owner', async () => {
        await expect(
          feeSplitter.connect(user).updateSplit(beneficiaryA.address, utils.parseUnits('0.1', 6)),
        ).to.be.revertedWithCustomError(feeSplitter, 'InstanceNotOwnerError')
      })

      it('should revert if the sum of splits is greater than 100%', async () => {
        await feeSplitter.updateSplit(beneficiaryA.address, utils.parseUnits('0.5', 6))
        await expect(
          feeSplitter.updateSplit(beneficiaryB.address, utils.parseUnits('0.6', 6)),
        ).to.be.revertedWithCustomError(feeSplitter, 'FeeSplitterOverflowError')
      })

      it('should update the split', async () => {
        await expect(feeSplitter.updateSplit(beneficiaryA.address, utils.parseUnits('0.1', 6)))
          .to.emit(feeSplitter, 'SplitUpdated')
          .withArgs(beneficiaryA.address, utils.parseUnits('0.1', 6))
        expect(await feeSplitter.beneficiaries()).to.deep.eq([beneficiaryA.address])
        expect(await feeSplitter.splits(beneficiaryA.address)).to.eq(utils.parseUnits('0.1', 6))
      })
    })

    describe('#poke', () => {
      let feeSplitter: IFeeSplitter
      let usdcPreUnwrapCall: boolean

      beforeEach(async () => {
        feeSplitter = FeeSplitter__factory.connect(await feeCoordinator.callStatic.create(beneficiary.address), owner)
        await feeCoordinator.connect(owner).create(beneficiary.address)
        await feeSplitter.updateSplit(beneficiaryA.address, utils.parseUnits('0.2', 6))
        await feeSplitter.updateSplit(beneficiaryB.address, utils.parseUnits('0.3', 6))

        await feeCoordinator.register(marketA.address)
        await feeCoordinator.register(marketB.address)
      })

      it('should claim, unwrap, and distribute fees', async () => {
        marketA.claimFee.returns(utils.parseUnits('1200', 6))
        marketB.claimFee.returns(utils.parseUnits('3500', 6))

        dsu.balanceOf.whenCalledWith(feeSplitter.address).returns(utils.parseUnits('4700', 18))
        reserve.redeem.whenCalledWith(utils.parseUnits('4700', 18)).returns(() => {
          usdcPreUnwrapCall = true // set flag to true directly prior to first USDC balanceOf call
        })
        usdc.balanceOf.whenCalledWith(feeSplitter.address).returns(() => {
          if (usdcPreUnwrapCall) return utils.parseUnits('4700', 6) // return 4700 if first call
          else return utils.parseUnits('2350', 6) // return 2350 if second call
        })

        usdc.transfer.whenCalledWith(beneficiaryA.address, utils.parseUnits('940', 6)).returns(() => {
          usdcPreUnwrapCall = false // set flag to false directly before second USDC balanceOf call
          return true
        })
        usdc.transfer.whenCalledWith(beneficiaryB.address, utils.parseUnits('1410', 6)).returns(() => {
          usdcPreUnwrapCall = false // set flag to false directly before second USDC balanceOf call
          return true
        })

        usdc.transfer.whenCalledWith(beneficiary.address, utils.parseUnits('2350', 6)).returns(true)

        await feeCoordinator.poke()

        expect(marketA.claimFee).to.have.been.calledWith(feeSplitter.address)
        expect(marketB.claimFee).to.have.been.calledWith(feeSplitter.address)

        expect(dsu.balanceOf).to.have.been.calledWith(feeSplitter.address)
        expect(reserve.redeem).to.have.been.calledWith(utils.parseUnits('4700', 18))
        expect(usdc.balanceOf).to.have.been.calledWith(feeSplitter.address)

        expect(usdc.transfer).to.have.been.calledWith(beneficiary.address, utils.parseUnits('2350', 6))
        expect(usdc.transfer).to.have.been.calledWith(beneficiaryA.address, utils.parseUnits('940', 6))
        expect(usdc.transfer).to.have.been.calledWith(beneficiaryB.address, utils.parseUnits('1410', 6))
      })
    })
  })
})
