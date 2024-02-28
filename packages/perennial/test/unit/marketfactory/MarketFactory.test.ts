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
  IFactory,
  CheckpointLib__factory,
  InvariantLib__factory,
  VersionLib__factory,
  CheckpointStorageLib__factory,
  MarketParameterStorageLib__factory,
  GlobalStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  VersionStorageLib__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { constants } from 'ethers'

const { ethers } = HRE

describe('MarketFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
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
    marketImpl = await new Market__factory(
      {
        'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
        'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
        'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
        'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
          await new CheckpointStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Global.sol:GlobalStorageLib': (await new GlobalStorageLib__factory(owner).deploy()).address,
        'contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
          await new MarketParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageGlobalLib': (
          await new PositionStorageGlobalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageLocalLib': (
          await new PositionStorageLocalLib__factory(owner).deploy()
        ).address,
        'contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
          await new RiskParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Version.sol:VersionStorageLib': (await new VersionStorageLib__factory(owner).deploy()).address,
      },
      owner,
    ).deploy()
    factory = await new MarketFactory__factory(owner).deploy(oracleFactory.address, marketImpl.address)
    await factory.initialize()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
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
        .to.be.revertedWithCustomError(factory, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#create', async () => {
    it('creates the market', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
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

    it('creates the market w/ zero payoff', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
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

    it('reverts when invalid oracle', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(false)

      await expect(factory.connect(owner).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'FactoryInvalidOracleError',
      )
    })

    it('reverts when already registered', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

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
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      await expect(factory.connect(user).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
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
      referralFee: parse6decimal('0.2'),
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
      expect(parameter.referralFee).to.equal(newParameter.referralFee)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#updateReferralFee', async () => {
    const newParameter = {
      protocolFee: parse6decimal('0.50'),
      maxFee: parse6decimal('0.01'),
      maxFeeAbsolute: parse6decimal('1000'),
      maxCut: parse6decimal('0.50'),
      maxRate: parse6decimal('10.00'),
      minMaintenance: parse6decimal('0.01'),
      minEfficiency: parse6decimal('0.1'),
      referralFee: parse6decimal('0.2'),
    }

    it('updates the parameters', async () => {
      await expect(factory.updateReferralFee(user.address, parse6decimal('0.3')))
        .to.emit(factory, 'ReferralFeeUpdated')
        .withArgs(user.address, parse6decimal('0.3'))

      expect(await factory.referralFee(user.address)).to.equal(parse6decimal('0.3'))
    })

    it('reverts if not owner', async () => {
      await expect(
        factory.connect(user).updateReferralFee(user.address, parse6decimal('0.3')),
      ).to.be.revertedWithCustomError(factory, 'OwnableNotOwnerError')
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
})
