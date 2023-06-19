import { smock, FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  Factory,
  Market,
  Factory__factory,
  Market__factory,
  IOracleProvider,
  IERC20Metadata,
  IPayoffProvider,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { BigNumber } from 'ethers'

const { ethers } = HRE

describe('Factory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let treasury: SignerWithAddress
  let pauser: SignerWithAddress
  let payoffProvider: FakeContract<IPayoffProvider>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>
  let reward: FakeContract<IERC20Metadata>

  let factory: Factory
  let marketImpl: Market

  beforeEach(async () => {
    ;[user, owner, treasury, pauser] = await ethers.getSigners()
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    reward = await smock.fake<IERC20Metadata>('IERC20Metadata')
    payoffProvider = await smock.fake<IPayoffProvider>('IPayoffProvider')
    marketImpl = await new Market__factory(owner).deploy()
    factory = await new Factory__factory(owner).deploy(marketImpl.address)
    await factory.initialize()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await factory.implementation()).to.equal(marketImpl.address)
      expect(await factory.owner()).to.equal(owner.address)
      expect(await factory.treasury()).to.equal(owner.address)
      expect(await factory.pauser()).to.equal(owner.address)

      const parameter = await factory.parameter()
      expect(parameter.paused).to.equal(false)
      expect(parameter.protocolFee).to.equal(0)
      expect(parameter.liquidationFee).to.equal(0)
      expect(parameter.minCollateral).to.equal(0)
      expect(parameter.maxPendingIds).to.equal(0)
    })

    it('reverts if already initialized', async () => {
      await expect(factory.initialize())
        .to.be.revertedWithCustomError(factory, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#updateTreasury', async () => {
    it('updates the treasury', async () => {
      await expect(factory.connect(owner).updateTreasury(treasury.address))
        .to.emit(factory, 'TreasuryUpdated')
        .withArgs(treasury.address)
      expect(await factory.treasury()).to.equal(treasury.address)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateTreasury(treasury.address)).to.be.revertedWithCustomError(
        factory,
        'UOwnableNotOwnerError',
      )
    })
  })

  describe('#updatePauser', async () => {
    it('updates the pauser', async () => {
      await expect(factory.connect(owner).updatePauser(pauser.address))
        .to.emit(factory, 'PauserUpdated')
        .withArgs(pauser.address)
      expect(await factory.pauser()).to.equal(pauser.address)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updatePauser(pauser.address)).to.be.revertedWithCustomError(
        factory,
        'UOwnableNotOwnerError',
      )
    })
  })

  describe('#createMarket', async () => {
    it('creates the market', async () => {
      const marketDefinition = {
        name: 'Squeeth',
        symbol: 'SQTH',
        token: dsu.address,
        reward: reward.address,
      }
      const marketParameter = {
        maintenance: parse6decimal('0.3'),
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        takerFee: 0,
        makerFee: 0,
        positionFee: 0,
        makerLiquidity: parse6decimal('0.2'),
        makerLimit: parse6decimal('1000'),
        closed: false,
        utilizationCurve: {
          minRate: parse6decimal('0.10'),
          maxRate: parse6decimal('0.10'),
          targetRate: parse6decimal('0.10'),
          targetUtilization: parse6decimal('1'),
        },
        pController: {
          value: 0,
          _k: parse6decimal('40000'),
          _skew: 0,
          _max: parse6decimal('1.20'),
        },
        makerRewardRate: 0,
        longRewardRate: 0,
        shortRewardRate: 0,
        oracle: oracle.address,
        payoff: payoffProvider.address,
      }

      const marketAddress = await factory.callStatic.createMarket(marketDefinition, marketParameter)
      await expect(factory.connect(user).createMarket(marketDefinition, marketParameter))
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition, marketParameter)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
      expect(await market.pendingOwner()).to.equal(user.address)
    })
  })

  describe('#updateParameter', async () => {
    const newParameter = {
      protocolFee: parse6decimal('0.50'),
      liquidationFee: parse6decimal('0.50'),
      minCollateral: parse6decimal('500'),
      maxPendingIds: BigNumber.from(5),
      paused: false,
    }

    it('updates the parameters', async () => {
      await expect(factory.updateParameter(newParameter)).to.emit(factory, 'ParameterUpdated').withArgs(newParameter)

      const parameter = await factory.parameter()
      expect(parameter.paused).to.equal(newParameter.paused)
      expect(parameter.protocolFee).to.equal(newParameter.protocolFee)
      expect(parameter.liquidationFee).to.equal(newParameter.liquidationFee)
      expect(parameter.minCollateral).to.equal(newParameter.minCollateral)
      expect(parameter.maxPendingIds).to.equal(newParameter.maxPendingIds)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        factory,
        'UOwnableNotOwnerError',
      )
    })
  })

  describe('#updatePaused', async () => {
    beforeEach(async () => {
      await factory.updatePauser(pauser.address)
    })

    it('updates the protocol paused state', async () => {
      const parameter = { ...(await factory.parameter()) }
      parameter.paused = true
      expect((await factory.parameter()).paused).to.equal(false)
      await expect(factory.connect(pauser).updatePaused(true)).to.emit(factory, 'ParameterUpdated')

      parameter.paused = false
      expect((await factory.parameter()).paused).to.equal(true)
      await expect(factory.connect(pauser).updatePaused(false)).to.emit(factory, 'ParameterUpdated')

      expect((await factory.parameter()).paused).to.equal(false)
    })

    it('reverts if not pauser', async () => {
      await expect(factory.connect(owner).updatePaused(true)).to.be.revertedWithCustomError(
        factory,
        `FactoryNotPauserError`,
      )
      await expect(factory.connect(user).updatePaused(true)).to.be.revertedWithCustomError(
        factory,
        `FactoryNotPauserError`,
      )
    })
  })

  //TODO (coveragehint): operator
})
