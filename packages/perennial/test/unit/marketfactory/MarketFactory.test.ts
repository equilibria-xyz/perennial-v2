import { smock, FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  MarketFactory,
  Market,
  MarketFactory__factory,
  Market__factory,
  IOracleProvider,
  IERC20Metadata,
  IPayoffProvider,
  IMarket,
  IFactory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { constants } from 'ethers'

const { ethers } = HRE

describe('MarketFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let payoffFactory: FakeContract<IFactory>
  let payoffProvider: FakeContract<IPayoffProvider>
  let oracleFactory: FakeContract<IFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>

  let factory: MarketFactory
  let marketImpl: Market

  beforeEach(async () => {
    ;[user, owner] = await ethers.getSigners()
    oracleFactory = await smock.fake<IFactory>('IFactory')
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    payoffFactory = await smock.fake<IFactory>('IFactory')
    payoffProvider = await smock.fake<IPayoffProvider>('IPayoffProvider')
    marketImpl = await new Market__factory(owner).deploy()
    factory = await new MarketFactory__factory(owner).deploy(
      oracleFactory.address,
      payoffFactory.address,
      marketImpl.address,
    )
    await factory.initialize()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await factory.payoffFactory()).to.equal(payoffFactory.address)
      expect(await factory.implementation()).to.equal(marketImpl.address)
      expect(await factory.owner()).to.equal(owner.address)
      expect(await factory.pauser()).to.equal(constants.AddressZero)

      const parameter = await factory.parameter()
      expect(parameter.protocolFee).to.equal(0)
      expect(parameter.maxFee).to.equal(0)
      expect(parameter.maxFeeAbsolute).to.equal(0)
      expect(parameter.maxCut).to.equal(0)
      expect(parameter.maxRate).to.equal(0)
      expect(parameter.minMaintenance).to.equal(0)
      expect(parameter.minEfficiency).to.equal(0)
    })

    it('reverts if already initialized', async () => {
      await expect(factory.initialize())
        .to.be.revertedWithCustomError(factory, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#create', async () => {
    it('creates the market', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.instances.whenCalledWith(payoffProvider.address).returns(true)

      const marketAddress = await factory.callStatic.create(marketDefinition)
      await expect(factory.connect(owner).create(marketDefinition))
        .to.emit(factory, 'InstanceRegistered')
        .withArgs(marketAddress)
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
    })

    it('creates the market w/ zero payoff', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: constants.AddressZero,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      const marketAddress = await factory.callStatic.create(marketDefinition)
      await expect(factory.connect(owner).create(marketDefinition))
        .to.emit(factory, 'InstanceRegistered')
        .withArgs(marketAddress)
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
    })

    it('reverts when invalid payoff', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.instances.whenCalledWith(payoffProvider.address).returns(false)

      await expect(factory.connect(owner).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'FactoryInvalidPayoffError',
      )
    })

    it('reverts when invalid oracle', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(false)
      payoffFactory.instances.whenCalledWith(payoffProvider.address).returns(true)

      await expect(factory.connect(owner).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'FactoryInvalidOracleError',
      )
    })

    it('reverts when already registered', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.instances.whenCalledWith(payoffProvider.address).returns(true)

      await factory.connect(owner).create(marketDefinition)

      await expect(factory.connect(owner).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'FactoryAlreadyRegisteredError',
      )
    })

    it('reverts when not owner', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.instances.whenCalledWith(payoffProvider.address).returns(true)

      await expect(factory.connect(user).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'UOwnableNotOwnerError',
      )
    })
  })

  describe('#updateParameter', async () => {
    const newParameter = {
      protocolFee: parse6decimal('0.50'),
      maxFee: parse6decimal('0.01'),
      maxFeeAbsolute: parse6decimal('1000'),
      maxCut: parse6decimal('0.50'),
      maxRate: parse6decimal('10.00'),
      minMaintenance: parse6decimal('0.01'),
      minEfficiency: parse6decimal('0.1'),
    }

    it('updates the parameters', async () => {
      await expect(factory.updateParameter(newParameter)).to.emit(factory, 'ParameterUpdated').withArgs(newParameter)

      const parameter = await factory.parameter()
      expect(parameter.protocolFee).to.equal(newParameter.protocolFee)
      expect(parameter.maxFee).to.equal(newParameter.maxFee)
      expect(parameter.maxFeeAbsolute).to.equal(newParameter.maxFeeAbsolute)
      expect(parameter.maxCut).to.equal(newParameter.maxCut)
      expect(parameter.maxRate).to.equal(newParameter.maxRate)
      expect(parameter.minMaintenance).to.equal(newParameter.minMaintenance)
      expect(parameter.minEfficiency).to.equal(newParameter.minEfficiency)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        factory,
        'UOwnableNotOwnerError',
      )
    })
  })

  describe('#updateOperator', async () => {
    it('updates the operator status', async () => {
      await expect(factory.connect(user).updateOperator(owner.address, true))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, owner.address, true)

      expect(await factory.operators(user.address, owner.address)).to.equal(true)

      await expect(factory.connect(user).updateOperator(owner.address, false))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, owner.address, false)

      expect(await factory.operators(user.address, owner.address)).to.equal(false)
    })
  })

  describe('#fund', async () => {
    let marketAddress: string
    let fakeMarket: FakeContract<IMarket>

    beforeEach(async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
        payoff: constants.AddressZero,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      marketAddress = await factory.callStatic.create(marketDefinition)
      await factory.connect(owner).create(marketDefinition)
      fakeMarket = await smock.fake<IMarket>('IMarket', { address: marketAddress })
    })

    it('claims its fees', async () => {
      await factory.connect(user).fund(marketAddress)

      expect(fakeMarket.claimFee).to.have.been.called
    })

    it('reverts if not an instance', async () => {
      await expect(factory.connect(user).fund(user.address)).to.be.revertedWithCustomError(
        factory,
        'FactoryNotInstanceError',
      )
    })
  })
})
