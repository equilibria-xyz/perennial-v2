import { smock, FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { IReward, IERC20, Reward, Reward__factory, IFactory, IInstance } from '../../../types/generated'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'

const { ethers } = HRE

use(smock.matchers)

describe('Reward', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let underlying: FakeContract<IERC20>
  let factory: FakeContract<IFactory>
  let instance: FakeContract<IInstance>
  let instanceSigner: SignerWithAddress

  let reward: Reward

  beforeEach(async () => {
    ;[user, owner] = await ethers.getSigners()
    underlying = await smock.fake<IReward>('IERC20')
    factory = await smock.fake<IFactory>('IFactory')
    instance = await smock.fake<IInstance>('IInstance')
    factory.instances.whenCalledWith(instance.address).returns(true)
    instance.factory.returns(factory.address)
    instanceSigner = await impersonateWithBalance(instance.address, ethers.utils.parseEther('10'))

    reward = await new Reward__factory(owner).deploy(underlying.address, ethers.utils.parseEther('2'))
    await reward.initialize()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await reward.underlying()).to.equal(underlying.address)
      expect(await reward.exchangeRate()).to.equal(ethers.utils.parseEther('2'))
    })

    it('reverts if already initialized', async () => {
      await expect(reward.initialize())
        .to.be.revertedWithCustomError(factory, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#register', async () => {
    it('registers the operator', async () => {
      await expect(reward.register(factory.address))
        .to.emit(reward, 'RewardOperatorRegistered')
        .withArgs(factory.address)

      expect(await reward.operators(factory.address)).to.equal(true)
    })

    it('reverts if not owner', async () => {
      await expect(reward.connect(user).register(factory.address)).to.be.revertedWithCustomError(
        reward,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#transferFrom', async () => {
    it('reverts if not owner', async () => {
      await expect(reward.transferFrom(user.address, instance.address, 0)).to.be.revertedWithCustomError(
        reward,
        'RewardNotSupportedError',
      )
    })
  })

  describe('#approve', async () => {
    it('reverts if not owner', async () => {
      await expect(reward.connect(user).approve(instance.address, 0)).to.be.revertedWithCustomError(
        reward,
        'RewardNotSupportedError',
      )
    })
  })

  describe('#mint', async () => {
    it('mints the balance', async () => {
      await expect(reward.connect(owner).mint(instance.address, ethers.utils.parseEther('1000')))
        .to.emit(reward, 'Transfer')
        .withArgs(ethers.constants.AddressZero, instance.address, ethers.utils.parseEther('1000'))

      expect(await reward.balanceOf(instance.address)).to.equal(ethers.utils.parseEther('1000'))
    })

    it('reverts if not owner', async () => {
      await expect(
        reward.connect(user).mint(instance.address, ethers.utils.parseEther('1000')),
      ).to.be.revertedWithCustomError(reward, 'OwnableNotOwnerError')
    })
  })

  describe('#redeem', async () => {
    it('redeems the balance', async () => {
      underlying.transfer.whenCalledWith(user.address, ethers.utils.parseEther('2000')).returns(true)

      await reward.connect(owner).mint(user.address, ethers.utils.parseEther('1000'))

      await expect(reward.connect(user).redeem(ethers.utils.parseEther('1000')))
        .to.emit(reward, 'Transfer')
        .withArgs(user.address, ethers.constants.AddressZero, ethers.utils.parseEther('1000'))

      expect(await reward.balanceOf(user.address)).to.equal(ethers.utils.parseEther('0'))
      expect(underlying.transfer).to.have.been.called
    })

    it('redeems less than the balance', async () => {
      underlying.transfer.whenCalledWith(user.address, ethers.utils.parseEther('1998')).returns(true)

      await reward.connect(owner).mint(user.address, ethers.utils.parseEther('1000'))

      await expect(reward.connect(user).redeem(ethers.utils.parseEther('999')))
        .to.emit(reward, 'Transfer')
        .withArgs(user.address, ethers.constants.AddressZero, ethers.utils.parseEther('999'))

      expect(await reward.balanceOf(user.address)).to.equal(ethers.utils.parseEther('1'))
      expect(underlying.transfer).to.have.been.called
    })

    it('reverts if amount too high', async () => {
      underlying.transfer.whenCalledWith(user.address, ethers.utils.parseEther('2000')).returns(true)

      await reward.connect(owner).mint(user.address, ethers.utils.parseEther('1000'))

      await expect(reward.connect(user).redeem(ethers.utils.parseEther('1001'))).to.be.revertedWith(
        'ERC20: burn amount exceeds balance',
      )
    })
  })

  describe('#transfer', async () => {
    beforeEach(async () => {
      await reward.register(factory.address)
    })

    it('transfers the balance if operator', async () => {
      await reward.connect(owner).mint(instance.address, ethers.utils.parseEther('1000'))
      await expect(reward.connect(instanceSigner).transfer(user.address, ethers.utils.parseEther('1000')))
        .to.emit(reward, 'Transfer')
        .withArgs(instance.address, user.address, ethers.utils.parseEther('1000'))
      expect(await reward.balanceOf(user.address)).to.equal(ethers.utils.parseEther('1000'))
    })

    it('reverts if not operator', async () => {
      const factory2 = await smock.fake<IFactory>('IFactory')
      const instance2 = await smock.fake<IInstance>('IInstance')
      factory2.instances.whenCalledWith(instance2.address).returns(true)
      instance2.factory.returns(factory2.address)
      const instanceSigner2 = await impersonateWithBalance(instance2.address, ethers.utils.parseEther('10'))

      await reward.connect(owner).mint(instance2.address, ethers.utils.parseEther('1000'))

      await expect(
        reward.connect(instanceSigner2).transfer(user.address, ethers.utils.parseEther('1000')),
      ).to.be.revertedWithCustomError(reward, 'RewardNotOperatorError')
    })

    it('reverts if not factory of operator', async () => {
      const factory2 = await smock.fake<IFactory>('IFactory')
      const instance2 = await smock.fake<IInstance>('IInstance')
      factory2.instances.whenCalledWith(instance2.address).returns(false)
      instance2.factory.returns(factory2.address)
      const instanceSigner2 = await impersonateWithBalance(instance2.address, ethers.utils.parseEther('10'))
      await reward.register(factory2.address)

      await reward.connect(owner).mint(instance2.address, ethers.utils.parseEther('1000'))

      await expect(
        reward.connect(instanceSigner2).transfer(user.address, ethers.utils.parseEther('1000')),
      ).to.be.revertedWithCustomError(reward, 'RewardNotOperatorError')
    })

    it('reverts if not instance', async () => {
      await reward.connect(owner).mint(user.address, ethers.utils.parseEther('1000'))

      await expect(
        reward.connect(user).transfer(instance.address, ethers.utils.parseEther('1000')),
      ).to.be.revertedWithoutReason()
    })
  })
})
