import { smock, FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
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
} from '../../../types/generated'
import { constants } from 'ethers'

const { ethers } = HRE

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

describe('OracleFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let dsu: FakeContract<IERC20Metadata>
  let marketFactory: FakeContract<IFactory>
  let subOracleFactory: FakeContract<IOracleProviderFactory>
  let subOracle: FakeContract<IOracleProvider>

  let factory: OracleFactory
  let oracleImpl: Oracle

  beforeEach(async () => {
    ;[user, owner] = await ethers.getSigners()
    marketFactory = await smock.fake<IFactory>('IFactory')
    subOracleFactory = await smock.fake<IOracleProviderFactory>('IOracleProviderFactory')
    subOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    oracleImpl = await new Oracle__factory(owner).deploy()
    factory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
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
        .to.be.revertedWithCustomError(factory, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
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
        .to.emit(factory, 'InstanceCreated')
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
        'UOwnableNotOwnerError',
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
        'UOwnableNotOwnerError',
      )
    })
  })
})
