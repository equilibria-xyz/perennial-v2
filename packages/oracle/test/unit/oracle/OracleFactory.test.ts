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
    await factory.initialize()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await factory.implementation()).to.equal(oracleImpl.address)
      expect(await factory.owner()).to.equal(owner.address)
      expect(await factory.pauser()).to.equal(constants.AddressZero)
    })

    it('reverts if already initialized', async () => {
      await expect(factory.initialize())
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

      const oracleAddress = await factory.callStatic.create(
        PYTH_ETH_USD_PRICE_FEED,
        subOracleFactory.address,
        'ETH-USD',
      )
      await expect(factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD'))
        .to.emit(factory, 'InstanceRegistered')
        .withArgs(oracleAddress)
        .to.emit(factory, 'OracleCreated')
        .withArgs(oracleAddress, PYTH_ETH_USD_PRICE_FEED)

      expect(await factory.oracles(PYTH_ETH_USD_PRICE_FEED)).to.equal(oracleAddress)
      expect(await factory.ids(oracleAddress)).to.equal(PYTH_ETH_USD_PRICE_FEED)

      const oracle = Oracle__factory.connect(oracleAddress, owner)
      expect(await oracle.factory()).to.equal(factory.address)
    })

    it('reverts when factory not registered', async () => {
      const subOracleFactory2 = await smock.fake<IOracleProviderFactory>('IOracleProviderFactory')
      subOracleFactory2.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)

      await expect(
        factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory2.address, 'ETH-USD'),
      ).to.revertedWithCustomError(factory, 'OracleFactoryNotRegisteredError')
    })

    it('reverts when already registered', async () => {
      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(subOracle.address)

      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD')

      await expect(
        factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD'),
      ).to.revertedWithCustomError(factory, 'OracleFactoryAlreadyCreatedError')
    })

    it('reverts when invalid id', async () => {
      subOracleFactory.oracles.whenCalledWith(PYTH_ETH_USD_PRICE_FEED).returns(constants.AddressZero)

      await expect(
        factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD'),
      ).to.revertedWithCustomError(factory, 'OracleFactoryInvalidIdError')
    })

    it('reverts if not owner', async () => {
      await expect(
        factory.connect(user).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD'),
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

      const oracleAddress = await factory.callStatic.create(
        PYTH_ETH_USD_PRICE_FEED,
        subOracleFactory.address,
        'ETH-USD',
      )
      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD')
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

      const oracleAddress = await factory.callStatic.create(
        PYTH_ETH_USD_PRICE_FEED,
        subOracleFactory.address,
        'ETH-USD',
      )
      await factory.connect(owner).create(PYTH_ETH_USD_PRICE_FEED, subOracleFactory.address, 'ETH-USD')
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
})
