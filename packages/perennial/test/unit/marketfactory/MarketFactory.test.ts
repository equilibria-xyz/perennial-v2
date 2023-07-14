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
  IPayoffFactory,
  IOracleFactory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { BigNumber, constants } from 'ethers'

const { ethers } = HRE

describe('MarketFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let payoffFactory: FakeContract<IPayoffFactory>
  let payoffProvider: FakeContract<IPayoffProvider>
  let oracleFactory: FakeContract<IOracleFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>

  let factory: MarketFactory
  let marketImpl: Market

  beforeEach(async () => {
    ;[user, owner] = await ethers.getSigners()
    oracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    payoffFactory = await smock.fake<IPayoffFactory>('IPayoffFactory')
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
      expect(parameter.maxPendingIds).to.equal(0)
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
        name: 'Squeeth',
        symbol: 'SQTH',
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }
      const marketParameter = {
        maintenance: parse6decimal('0.3'),
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        takerFee: 0,
        takerSkewFee: 0,
        takerImpactFee: 0,
        makerFee: 0,
        makerImpactFee: 0,
        positionFee: 0,
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('1000'),
        utilizationCurve: {
          minRate: parse6decimal('0.10'),
          maxRate: parse6decimal('0.10'),
          targetRate: parse6decimal('0.10'),
          targetUtilization: parse6decimal('1'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
        minMaintenance: parse6decimal('100'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.payoffs.whenCalledWith(payoffProvider.address).returns(true)

      const marketAddress = await factory.callStatic.create(marketDefinition, marketParameter)
      await expect(factory.connect(owner).create(marketDefinition, marketParameter))
        .to.emit(factory, 'InstanceCreated')
        .withArgs(marketAddress)
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition, marketParameter)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
    })

    it('creates the market w/ zero payoff', async () => {
      const marketDefinition = {
        name: 'Squeeth',
        symbol: 'SQTH',
        token: dsu.address,
        oracle: oracle.address,
        payoff: constants.AddressZero,
      }
      const marketParameter = {
        maintenance: parse6decimal('0.3'),
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        takerFee: 0,
        takerSkewFee: 0,
        takerImpactFee: 0,
        makerFee: 0,
        makerImpactFee: 0,
        positionFee: 0,
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('1000'),
        utilizationCurve: {
          minRate: parse6decimal('0.10'),
          maxRate: parse6decimal('0.10'),
          targetRate: parse6decimal('0.10'),
          targetUtilization: parse6decimal('1'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
        minMaintenance: parse6decimal('100'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      const marketAddress = await factory.callStatic.create(marketDefinition, marketParameter)
      await expect(factory.connect(owner).create(marketDefinition, marketParameter))
        .to.emit(factory, 'InstanceCreated')
        .withArgs(marketAddress)
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition, marketParameter)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
    })

    it('reverts when invalid payoff', async () => {
      const marketDefinition = {
        name: 'Squeeth',
        symbol: 'SQTH',
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }
      const marketParameter = {
        maintenance: parse6decimal('0.3'),
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        takerFee: 0,
        takerSkewFee: 0,
        takerImpactFee: 0,
        makerFee: 0,
        makerImpactFee: 0,
        positionFee: 0,
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('1000'),
        utilizationCurve: {
          minRate: parse6decimal('0.10'),
          maxRate: parse6decimal('0.10'),
          targetRate: parse6decimal('0.10'),
          targetUtilization: parse6decimal('1'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
        minMaintenance: parse6decimal('100'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.payoffs.whenCalledWith(payoffProvider.address).returns(false)

      await expect(factory.connect(owner).create(marketDefinition, marketParameter)).to.revertedWithCustomError(
        factory,
        'FactoryInvalidPayoffError',
      )
    })

    it('reverts when invalid oracle', async () => {
      const marketDefinition = {
        name: 'Squeeth',
        symbol: 'SQTH',
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }
      const marketParameter = {
        maintenance: parse6decimal('0.3'),
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        takerFee: 0,
        takerSkewFee: 0,
        takerImpactFee: 0,
        makerFee: 0,
        makerImpactFee: 0,
        positionFee: 0,
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('1000'),
        utilizationCurve: {
          minRate: parse6decimal('0.10'),
          maxRate: parse6decimal('0.10'),
          targetRate: parse6decimal('0.10'),
          targetUtilization: parse6decimal('1'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
        minMaintenance: parse6decimal('100'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(false)
      payoffFactory.payoffs.whenCalledWith(payoffProvider.address).returns(true)

      await expect(factory.connect(owner).create(marketDefinition, marketParameter)).to.revertedWithCustomError(
        factory,
        'FactoryInvalidOracleError',
      )
    })

    it('reverts when already registered', async () => {
      const marketDefinition = {
        name: 'Squeeth',
        symbol: 'SQTH',
        token: dsu.address,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }
      const marketParameter = {
        maintenance: parse6decimal('0.3'),
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        takerFee: 0,
        takerSkewFee: 0,
        takerImpactFee: 0,
        makerFee: 0,
        makerImpactFee: 0,
        positionFee: 0,
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('1000'),
        utilizationCurve: {
          minRate: parse6decimal('0.10'),
          maxRate: parse6decimal('0.10'),
          targetRate: parse6decimal('0.10'),
          targetUtilization: parse6decimal('1'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
        minMaintenance: parse6decimal('100'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)
      payoffFactory.payoffs.whenCalledWith(payoffProvider.address).returns(true)

      await factory.connect(owner).create(marketDefinition, marketParameter)

      await expect(factory.connect(owner).create(marketDefinition, marketParameter)).to.revertedWithCustomError(
        factory,
        'FactoryAlreadyRegisteredError',
      )
    })
  })

  describe('#updateParameter', async () => {
    const newParameter = {
      maxPendingIds: BigNumber.from(5),
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
      expect(parameter.maxPendingIds).to.equal(newParameter.maxPendingIds)
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

  //TODO (coveragehint): operator
})
