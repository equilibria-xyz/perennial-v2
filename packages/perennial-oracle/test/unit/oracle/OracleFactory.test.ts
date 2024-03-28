import { smock, FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  IERC20Metadata,
  OracleFactory,
  Oracle,
  Oracle__factory,
  OracleFactory__factory,
  IOracleProviderFactory,
  IOracleProvider,
  IFactory,
  IInstance,
  IOracle,
  IMarket,
} from '../../../types/generated'
import { constants } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { impersonate } from '../../../../common/testutil'
const { ethers } = HRE
use(smock.matchers)

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

describe('OracleFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let dsu: FakeContract<IERC20Metadata>
  let marketFactory: FakeContract<IFactory>
  let subOracleFactory: FakeContract<IOracleProviderFactory>
  let subOracleFactory2: FakeContract<IOracleProviderFactory>
  let subOracle: FakeContract<IOracleProvider>
  let subOracle2: FakeContract<IOracleProvider>
  let subOracleFactorySigner: SignerWithAddress

  let factory: OracleFactory
  let oracleImpl: Oracle

  beforeEach(async () => {
    ;[user, owner] = await ethers.getSigners()
    marketFactory = await smock.fake<IFactory>('IFactory')
    subOracleFactory = await smock.fake<IOracleProviderFactory>('IOracleProviderFactory')
    subOracleFactory2 = await smock.fake<IOracleProviderFactory>('IOracleProviderFactory')
    subOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    subOracle2 = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    oracleImpl = await new Oracle__factory(owner).deploy()
    factory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    subOracleFactorySigner = await impersonate.impersonateWithBalance(
      subOracleFactory.address,
      ethers.utils.parseEther('1000'),
    )
    await factory.initialize(dsu.address)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await factory.implementation()).to.equal(oracleImpl.address)
      expect(await factory.owner()).to.equal(owner.address)
      expect(await factory.pauser()).to.equal(constants.AddressZero)
    })

    it('reverts if already initialized', async () => {
      await expect(factory.initialize(dsu.address))
        .to.be.revertedWithCustomError(factory, 'InitializableAlreadyInitializedError')
        .withArgs(3)
    })
  })

  describe('#create', async () => {
    beforeEach(async () => {
      await factory.connect(owner).register(subOracleFactory.address)
    })

    it('creates the oracle', async () => {
      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)

      const oracleAddress = await factory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)
      await expect(factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address))
        .to.emit(factory, 'InstanceRegistered')
        .withArgs(oracleAddress)
        .to.emit(factory, 'OracleCreated')
        .withArgs(oracleAddress, PYTH_ETH_USD_PRICE_FEED)

      expect(await factory.oracles(PYTH_ETH_USD_PRICE_FEED)).to.equal(oracleAddress)

      const oracle = Oracle__factory.connect(oracleAddress, owner)
      expect(await oracle.factory()).to.equal(factory.address)
    })

    it('reverts when factory not registered', async () => {
      const subOracleFactory2 = await smock.fake<IOracleProviderFactory>('IOracleProviderFactory')
      subOracleFactory2.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)

      await expect(
        factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address),
      ).to.revertedWithCustomError(factory, 'OracleFactoryNotRegisteredError')
    })

    it('reverts when already registered', async () => {
      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)

      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)

      await expect(
        factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address),
      ).to.revertedWithCustomError(factory, 'OracleFactoryAlreadyCreatedError')
    })

    it('reverts when invalid id', async () => {
      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(constants.AddressZero)

      await expect(
        factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address),
      ).to.revertedWithCustomError(factory, 'OracleFactoryInvalidIdError')
    })

    it('reverts if not owner', async () => {
      await expect(
        factory.connect(user).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address),
      ).to.revertedWithCustomError(factory, 'OwnableNotOwnerError')
    })
  })

  describe('#update', async () => {
    beforeEach(async () => {
      await factory.connect(owner).register(subOracleFactory.address)
      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)
    })

    it('update the factory', async () => {
      await factory.connect(owner).register(subOracleFactory2.address)

      const oracleAddress = await factory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)
      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)
      const oracle = Oracle__factory.connect(oracleAddress, owner)
      const mockOracle = await smock.fake<IOracle>('IOracle', { address: oracle.address })
      mockOracle.update.whenCalledWith(subOracle2.address).returns()

      subOracleFactory2.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle2.address)

      await factory.connect(owner).update(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address)

      expect(mockOracle.update).to.be.calledWith(subOracle2.address)
    })

    it('reverts factory not registered', async () => {
      await expect(
        factory.connect(owner).update(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address),
      ).to.be.revertedWithCustomError(factory, 'OracleFactoryNotRegisteredError')
    })

    it('reverts oracle not created', async () => {
      await factory.connect(owner).register(subOracleFactory2.address)

      await expect(
        factory.connect(owner).update(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address),
      ).to.be.revertedWithCustomError(factory, 'OracleFactoryNotCreatedError')
    })

    it('reverts oracle not instance', async () => {
      await factory.connect(owner).register(subOracleFactory2.address)

      const oracleAddress = await factory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)
      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)
      const oracle = Oracle__factory.connect(oracleAddress, owner)
      const mockOracle = await smock.fake<IOracle>('IOracle', { address: oracle.address })
      mockOracle.update.whenCalledWith(subOracle2.address).returns()

      subOracleFactory2.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(ethers.constants.AddressZero)

      await expect(
        factory.connect(owner).update(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address),
      ).to.be.revertedWithCustomError(factory, 'OracleFactoryInvalidIdError')
    })

    it('reverts if not owner', async () => {
      await expect(
        factory.connect(user).update(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address),
      ).to.be.revertedWithCustomError(factory, 'OwnableNotOwnerError')
    })
  })

  describe('#register', async () => {
    it('registers the factory', async () => {
      await expect(factory.register(subOracleFactory.address))
        .to.emit(factory, 'FactoryRegistered')
        .withArgs(subOracleFactory.address)

      expect(await factory.factories(subOracleFactory.address)).to.equal(true)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).register(subOracleFactory.address)).to.be.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#authorize', async () => {
    it('authorizes the caller', async () => {
      await expect(factory.authorize(marketFactory.address))
        .to.emit(factory, 'CallerAuthorized')
        .withArgs(marketFactory.address)

      expect(await factory.callers(marketFactory.address)).to.equal(true)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).authorize(marketFactory.address)).to.be.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#updateMaxClaim', async () => {
    it('updates max claim', async () => {
      await expect(factory.updateMaxClaim(parse6decimal('11')))
        .to.emit(factory, 'MaxClaimUpdated')
        .withArgs(parse6decimal('11'))

      expect(await factory.maxClaim()).to.equal(parse6decimal('11'))
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateMaxClaim(parse6decimal('11'))).to.be.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#claim', async () => {
    beforeEach(async () => {
      await factory.connect(owner).register(subOracleFactory.address)
      await factory.updateMaxClaim(parse6decimal('10'))
    })

    it('claims the assets', async () => {
      dsu.transfer.whenCalledWith(subOracleFactorySigner.address, parse6decimal('10').mul(1e12)).returns(true)

      await factory.connect(subOracleFactorySigner).claim(parse6decimal('10'))

      expect(dsu.transfer).to.have.been.calledWith(subOracleFactorySigner.address, parse6decimal('10').mul(1e12))
    })

    it('reverts if above max claim', async () => {
      await expect(factory.connect(user).claim(parse6decimal('11'))).to.be.revertedWithCustomError(
        factory,
        'OracleFactoryClaimTooLargeError',
      )
    })

    it('reverts if not instance', async () => {
      await expect(factory.connect(user).claim(parse6decimal('10'))).to.be.revertedWithCustomError(
        factory,
        'OracleFactoryNotRegisteredError',
      )
    })
  })

  describe('#authorized', async () => {
    let subFactory: FakeContract<IFactory>
    let subInstance: FakeContract<IInstance>

    beforeEach(async () => {
      subFactory = await smock.fake<IFactory>('IFactory')
      subInstance = await smock.fake<IInstance>('IInstance')
    })

    it('true if instance', async () => {
      await factory.connect(owner).authorize(subFactory.address)
      subFactory.instances.whenCalledWith(subInstance.address).returns(true)
      subInstance.factory.returns(subFactory.address)

      expect(await factory.authorized(subInstance.address)).to.be.true
    })

    it('false if not registered', async () => {
      subFactory.instances.whenCalledWith(subInstance.address).returns(true)
      subInstance.factory.returns(subFactory.address)

      expect(await factory.authorized(subInstance.address)).to.be.false
    })

    it('false if not instance', async () => {
      await factory.connect(owner).authorize(subFactory.address)
      subFactory.instances.whenCalledWith(subInstance.address).returns(false)
      subInstance.factory.returns(subFactory.address)

      expect(await factory.authorized(subInstance.address)).to.be.false
    })
  })

  describe('#fund', () => {
    let fakeMarket: FakeContract<IMarket>

    beforeEach(async () => {
      fakeMarket = await smock.fake<IMarket>('IMarket')
      await factory.connect(owner).register(subOracleFactory.address)

      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)

      const oracleAddress = await factory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)
      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address)

      fakeMarket.oracle.returns(oracleAddress)
    })

    it('claims its fees', async () => {
      await factory.connect(user).fund(fakeMarket.address)

      expect(fakeMarket.claimFee).to.have.been.called
    })

    it('reverts if not an instance', async () => {
      fakeMarket.oracle.reset()
      fakeMarket.oracle.returns(user.address)
      await expect(factory.connect(user).fund(fakeMarket.address)).to.be.revertedWithCustomError(
        factory,
        'FactoryNotInstanceError',
      )
    })
  })
})
