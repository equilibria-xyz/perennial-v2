import HRE from 'hardhat'
import { impersonate } from '../../../../common/testutil'
import { deployProductOnFork } from '../helpers/setupHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarket,
  IMarketFactory,
  IMakerVault,
  IMakerVault__factory,
  IMargin,
  IOracleFactory,
  IOracleProvider,
  IVaultFactory,
  IVaultFactory__factory,
  MakerVault__factory,
  VaultFactory__factory,
} from '../../../types/generated'
import { BigNumber, constants, utils } from 'ethers'
import { deployProtocol, fundWallet, settle } from '@perennial/v2-core/test/integration/helpers/setupHelpers'
import { OracleReceipt, DEFAULT_ORACLE_RECEIPT, parse6decimal } from '../../../../common/testutil/types'
import { MarketFactory, ProxyAdmin, TransparentUpgradeableProxy__factory } from '@perennial/v2-core/types/generated'
import { IOracle, IOracle__factory, OracleFactory } from '@perennial/v2-oracle/types/generated'
import { reset } from '../../../../common/testutil/time'

const { ethers } = HRE
use(smock.matchers)

const STARTING_TIMESTAMP = BigNumber.from(1646456563)
const LEGACY_ORACLE_DELAY = 3600
const ETH_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000001'
const BTC_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000002'
const UNSUPPORTED_TOKEN_ADDRESS = '0x92e187a03b6cd19cb6af293ba17f2745fd2357d5'
const UNSUPPORTED_TOKEN_HOLDER = '0x48DdD27a4d54CD3e8c34F34F7e66e998442DBcE3'

describe('MakerVault', () => {
  let vault: IMakerVault
  let asset: IERC20Metadata
  let vaultFactory: IVaultFactory
  let factory: IMarketFactory
  let oracleFactory: OracleFactory
  let vaultOracleFactory: FakeContract<IOracleFactory>
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let btcUser1: SignerWithAddress
  let btcUser2: SignerWithAddress
  let perennialUser: SignerWithAddress
  let liquidator: SignerWithAddress
  let other: SignerWithAddress
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber
  let oracle: FakeContract<IOracleProvider>
  let margin: IMargin
  let market: IMarket
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcMarket: IMarket
  let vaultSigner: SignerWithAddress
  let marketFactory: MarketFactory
  let proxyAdmin: ProxyAdmin
  let coordinator: SignerWithAddress

  async function updateOracle(
    newPrice?: BigNumber,
    newPriceBtc?: BigNumber,
    newReceipt?: OracleReceipt,
    newReceiptBtc?: OracleReceipt,
  ) {
    await _updateOracle(oracle, newPrice, newReceipt)
    await _updateOracle(btcOracle, newPriceBtc, newReceiptBtc)
  }

  async function settleUnderlying(account: SignerWithAddress) {
    await settle(market, account)
    await settle(btcMarket, account)
  }

  async function _updateOracle(
    oracleMock: FakeContract<IOracleProvider>,
    newPrice?: BigNumber,
    newReceipt?: OracleReceipt,
  ) {
    const [currentTimestamp, currentPrice] = await oracleMock.latest()
    const [, currentReceipt] = await oracleMock.at(currentTimestamp)
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    oracleMock.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    oracleMock.request.whenCalledWith(user.address).returns()
    oracleMock.latest.returns(newVersion)
    oracleMock.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracleMock.at.whenCalledWith(newVersion.timestamp).returns([newVersion, newReceipt ?? currentReceipt])
  }

  async function position() {
    return (await market.positions(vault.address)).maker
  }

  async function btcPosition() {
    return (await btcMarket.positions(vault.address)).maker
  }

  async function collateralInVault() {
    return await margin.isolatedBalances(vault.address, market.address)
  }

  async function btcCollateralInVault() {
    return await margin.isolatedBalances(vault.address, btcMarket.address)
  }

  async function totalCollateralInVault() {
    return (await collateralInVault())
      .add(await btcCollateralInVault())
      .add(await margin.crossMarginBalances(vault.address))
      .mul(1e12)
      .add(await asset.balanceOf(vault.address))
  }

  async function currentPositionGlobal(market: IMarket) {
    const currentPosition = { ...(await market.position()) }
    const pending = await market.pending()

    currentPosition.maker = currentPosition.maker.add(pending.makerPos).sub(pending.makerNeg)
    currentPosition.long = currentPosition.long.add(pending.longNeg).sub(pending.longNeg)
    currentPosition.short = currentPosition.short.add(pending.shortPos).sub(pending.shortNeg)

    return currentPosition
  }

  async function currentPositionLocal(market: IMarket) {
    const currentPosition = { ...(await market.positions(vault.address)) }
    const pending = await market.pendings(vault.address)

    currentPosition.maker = currentPosition.maker.add(pending.makerPos).sub(pending.makerNeg)
    currentPosition.long = currentPosition.long.add(pending.longNeg).sub(pending.longNeg)
    currentPosition.short = currentPosition.short.add(pending.shortPos).sub(pending.shortNeg)

    return currentPosition
  }

  const fixture = async () => {
    const instanceVars = await deployProtocol()
    margin = instanceVars.margin

    let pauser
    ;[owner, pauser, user, user2, btcUser1, btcUser2, liquidator, perennialUser, other, coordinator] =
      await ethers.getSigners()
    factory = instanceVars.marketFactory
    oracleFactory = instanceVars.oracleFactory
    marketFactory = instanceVars.marketFactory
    proxyAdmin = instanceVars.proxyAdmin

    vaultOracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    await oracleFactory.connect(owner).register(vaultOracleFactory.address)

    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    const realVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('2620237388'),
      valid: true,
    }
    originalOraclePrice = realVersion.price

    oracle.status.returns([realVersion, realVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    oracle.request.whenCalledWith(user.address).returns()
    oracle.latest.returns(realVersion)
    oracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracle.at.whenCalledWith(realVersion.timestamp).returns([realVersion, DEFAULT_ORACLE_RECEIPT])

    btcOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    const btcRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('38838362695'),
      valid: true,
    }
    btcOriginalOraclePrice = btcRealVersion.price

    btcOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcOracle.request.whenCalledWith(user.address).returns()
    btcOracle.latest.returns(btcRealVersion)
    btcOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcOracle.at.whenCalledWith(btcRealVersion.timestamp).returns([btcRealVersion, DEFAULT_ORACLE_RECEIPT])

    vaultOracleFactory.instances.whenCalledWith(oracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(oracle.address)
    vaultOracleFactory.instances.whenCalledWith(btcOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcOracle.address)

    const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
      instanceVars.marketFactory.address, // dummy contract
      instanceVars.proxyAdmin.address,
      [],
    )

    vaultOracleFactory.instances.whenCalledWith(oracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(oracle.address)
    vaultOracleFactory.instances.whenCalledWith(btcOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcOracle.address)

    const rootOracle = IOracle__factory.connect(
      await instanceVars.oracleFactory
        .connect(owner)
        .callStatic.create(ETH_PRICE_FEE_ID, vaultOracleFactory.address, 'ETH-USD'),
      owner,
    )
    await instanceVars.oracleFactory.connect(owner).create(ETH_PRICE_FEE_ID, vaultOracleFactory.address, 'ETH-USD')

    leverage = parse6decimal('4.0')
    maxCollateral = parse6decimal('500000')

    const btcRootOracle = IOracle__factory.connect(
      await instanceVars.oracleFactory
        .connect(owner)
        .callStatic.create(BTC_PRICE_FEE_ID, vaultOracleFactory.address, 'BTC-USD'),
      owner,
    )
    await instanceVars.oracleFactory.connect(owner).create(BTC_PRICE_FEE_ID, vaultOracleFactory.address, 'BTC-USD')

    market = await deployProductOnFork({
      factory: instanceVars.marketFactory,
      owner: owner,
      oracle: rootOracle.address,
      makerLimit: parse6decimal('1000'),
      minMargin: parse6decimal('50'),
      minMaintenance: parse6decimal('50'),
      synBook: {
        d0: 0,
        d1: 0,
        d2: 0,
        d3: 0,
        scale: parse6decimal('100'),
      },
    })
    btcMarket = await deployProductOnFork({
      factory: instanceVars.marketFactory,
      owner: owner,
      oracle: btcRootOracle.address,
      minMargin: parse6decimal('50'),
      minMaintenance: parse6decimal('50'),
      synBook: {
        d0: 0,
        d1: 0,
        d2: 0,
        d3: 0,
        scale: parse6decimal('10'),
      },
    })

    await rootOracle.register(market.address)
    await btcRootOracle.register(btcMarket.address)

    const vaultImpl = await new MakerVault__factory(owner).deploy()
    const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
      instanceVars.marketFactory.address,
      vaultImpl.address,
      0,
    )
    await instanceVars.proxyAdmin.upgrade(vaultFactoryProxy.address, vaultFactoryImpl.address)
    vaultFactory = IVaultFactory__factory.connect(vaultFactoryProxy.address, owner)
    await vaultFactory.initialize()

    asset = IERC20Metadata__factory.connect(instanceVars.dsu.address, owner)

    await fundWallet(asset, owner)
    await asset.approve(vaultFactory.address, ethers.constants.MaxUint256)
    vault = IMakerVault__factory.connect(
      await vaultFactory.callStatic.create(instanceVars.dsu.address, market.address, parse6decimal('1.2'), 'Blue Chip'),
      owner,
    )
    await vaultFactory.create(instanceVars.dsu.address, market.address, parse6decimal('1.2'), 'Blue Chip')
    await vault.register(btcMarket.address)
    await vault.connect(owner).updateCoordinator(coordinator.address)
    await vault.connect(coordinator).updateLeverage(0, leverage)
    await vault.connect(coordinator).updateLeverage(1, leverage)
    await vault.connect(coordinator).updateWeights([0.8e6, 0.2e6])
    await vault.connect(owner).updateParameter({
      ...(await vault.parameter()),
      maxDeposit: maxCollateral,
      minDeposit: 0,
      profitShare: 0,
    })

    await Promise.all([
      asset.connect(liquidator).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(perennialUser).approve(vault.address, ethers.constants.MaxUint256),
      fundWallet(asset, liquidator),
      fundWallet(asset, perennialUser),
      fundWallet(asset, perennialUser),
      fundWallet(asset, perennialUser),
      fundWallet(asset, perennialUser),
      fundWallet(asset, perennialUser),
      fundWallet(asset, perennialUser),
      fundWallet(asset, perennialUser),
      fundWallet(asset, other),
      asset.connect(user).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(user2).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(btcUser1).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(other).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(user).approve(margin.address, ethers.constants.MaxUint256),
      asset.connect(user2).approve(margin.address, ethers.constants.MaxUint256),
      asset.connect(btcUser1).approve(margin.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(margin.address, ethers.constants.MaxUint256),
      asset.connect(other).approve(margin.address, ethers.constants.MaxUint256),
    ])

    // allow all accounts to interact with the vault
    await vault.connect(owner).updateAllowed(constants.AddressZero, true)

    // Seed markets with some activity
    const deposit = parse6decimal('100000')
    await margin.connect(user).deposit(user.address, deposit)
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](
        user.address,
        parse6decimal('200'),
        0,
        deposit,
        constants.AddressZero,
      )
    await margin.connect(user2).deposit(user2.address, deposit)
    await market
      .connect(user2)
      ['update(address,int256,int256,int256,address)'](
        user2.address,
        0,
        parse6decimal('100'),
        deposit,
        constants.AddressZero,
      )
    await margin.connect(btcUser1).deposit(btcUser1.address, deposit)
    await btcMarket
      .connect(btcUser1)
      ['update(address,int256,int256,int256,address)'](
        btcUser1.address,
        parse6decimal('20'),
        0,
        deposit,
        constants.AddressZero,
      )
    await margin.connect(btcUser2).deposit(btcUser2.address, deposit)
    await btcMarket
      .connect(btcUser2)
      ['update(address,int256,int256,int256,address)'](
        btcUser2.address,
        0,
        parse6decimal('10'),
        deposit,
        constants.AddressZero,
      )

    vaultSigner = await impersonate.impersonateWithBalance(vault.address, ethers.utils.parseEther('10'))

    return { instanceVars, vaultFactoryProxy, rootOracle }
  }

  beforeEach(async () => {
    await loadFixture(fixture)

    const realVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('2620237388'),
      valid: true,
    }
    originalOraclePrice = realVersion.price

    oracle.status.returns([realVersion, realVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    oracle.request.whenCalledWith(user.address).returns()
    oracle.latest.returns(realVersion)
    oracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracle.at.whenCalledWith(realVersion.timestamp).returns([realVersion, DEFAULT_ORACLE_RECEIPT])

    const btcRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('38838362695'),
      valid: true,
    }
    btcOriginalOraclePrice = btcRealVersion.price

    btcOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcOracle.request.whenCalledWith(user.address).returns()
    btcOracle.latest.returns(btcRealVersion)
    btcOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcOracle.at.whenCalledWith(btcRealVersion.timestamp).returns([btcRealVersion, DEFAULT_ORACLE_RECEIPT])

    vaultOracleFactory.instances.whenCalledWith(oracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(oracle.address)
    vaultOracleFactory.instances.whenCalledWith(btcOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcOracle.address)
  })

  after(async () => {
    await reset()
  })

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(
        vault.initialize(asset.address, market.address, parse6decimal('5'), parse6decimal('1.2'), 'Blue Chip'),
      )
        .to.revertedWithCustomError(vault, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Perennial Maker Vault: Blue Chip')
    })
  })

  describe('#updateCoordinator', () => {
    it('updates coordinator', async () => {
      await expect(vault.connect(owner).updateCoordinator(coordinator.address))
        .to.emit(vault, 'CoordinatorUpdated')
        .withArgs(coordinator.address)

      expect(await vault.coordinator()).to.deep.contain(coordinator.address)
    })

    it('reverts when not owner', async () => {
      await expect(vault.connect(user).updateCoordinator(coordinator.address)).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#register', () => {
    let market3: IMarket
    let rootOracle3: IOracle

    beforeEach(async () => {
      const realVersion3 = {
        timestamp: STARTING_TIMESTAMP,
        price: BigNumber.from('13720000'),
        valid: true,
      }

      const oracle3 = await smock.fake<IOracleProvider>('IOracleProvider')
      oracle3.request.returns([realVersion3, realVersion3.timestamp.add(LEGACY_ORACLE_DELAY)])
      oracle3.latest.returns(realVersion3)
      oracle3.at.whenCalledWith(realVersion3.timestamp).returns(realVersion3)

      const LINK_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000003'
      vaultOracleFactory.instances.whenCalledWith(oracle3.address).returns(true)
      vaultOracleFactory.oracles.whenCalledWith(LINK_PRICE_FEE_ID).returns(oracle3.address)

      rootOracle3 = IOracle__factory.connect(
        await oracleFactory.connect(owner).callStatic.create(LINK_PRICE_FEE_ID, vaultOracleFactory.address, 'LINK-USD'),
        owner,
      )
      await oracleFactory.connect(owner).create(LINK_PRICE_FEE_ID, vaultOracleFactory.address, 'LINK-USD')

      market3 = await deployProductOnFork({
        factory: factory,
        owner: owner,
        oracle: rootOracle3.address,
        makerLimit: parse6decimal('1000000'),
        synBook: {
          d0: 0,
          d1: 0,
          d2: 0,
          d3: 0,
          scale: parse6decimal('100000'),
        },
      })
    })

    it('registers new market correctly', async () => {
      await expect(vault.connect(owner).register(market3.address))
        .to.emit(vault, 'MarketRegistered')
        .withArgs(2, market3.address)
    })

    it('reverts when not owner', async () => {
      await expect(vault.connect(user).register(market.address)).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })

    it('reverts when market already registered', async () => {
      await expect(vault.connect(owner).register(market.address)).to.be.revertedWithCustomError(
        vault,
        'VaultMarketExistsError',
      )
    })

    it('reverts when not real market', async () => {
      await expect(vault.connect(owner).register(constants.AddressZero)).to.be.revertedWithCustomError(
        vault,
        'VaultNotMarketError',
      )
    })

    it('reverts when the asset is incorrect', async () => {
      const unsupportedTokenHolder = await impersonate.impersonateWithBalance(
        UNSUPPORTED_TOKEN_HOLDER,
        utils.parseEther('10'),
      )
      const unsupportedToken = IERC20Metadata__factory.connect(UNSUPPORTED_TOKEN_ADDRESS, unsupportedTokenHolder)
      await unsupportedToken.transfer(owner.address, await vaultFactory.initialAmount())

      await expect(
        vaultFactory.create(UNSUPPORTED_TOKEN_ADDRESS, market.address, parse6decimal('1.1'), 'Unsupported'),
      ).to.be.revertedWithCustomError(vault, 'VaultIncorrectAssetError')
    })
  })

  describe('#updateParameter', () => {
    it('updates correctly', async () => {
      const newParameter = {
        maxDeposit: parse6decimal('1000000'),
        minDeposit: parse6decimal('10'),
        profitShare: parse6decimal('0.1'),
        leverageBuffer: parse6decimal('10'),
      }
      await expect(vault.connect(owner).updateParameter(newParameter))
        .to.emit(vault, 'ParameterUpdated')
        .withArgs(newParameter)

      const parameter = await vault.parameter()
      expect(parameter.maxDeposit).to.deep.contain(newParameter.maxDeposit)
      expect(parameter.minDeposit).to.deep.contain(newParameter.minDeposit)
      expect(parameter.profitShare).to.deep.contain(newParameter.profitShare)
      expect(parameter.leverageBuffer).to.deep.contain(newParameter.leverageBuffer)
    })

    it('reverts when not owner', async () => {
      const newParameter = {
        maxDeposit: parse6decimal('1000000'),
        minDeposit: parse6decimal('10'),
        profitShare: parse6decimal('0.1'),
        leverageBuffer: parse6decimal('1000000'),
      }
      await expect(vault.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#updateLeverage', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(coordinator).updateLeverage(1, parse6decimal('3')))
        .to.emit(vault, 'MarketUpdated')
        .withArgs(1, 0.2e6, parse6decimal('3'))

      expect((await vault.registrations(1)).weight).to.eq(0.2e6)
      expect((await vault.registrations(1)).leverage).to.eq(parse6decimal('3'))

      await expect(vault.connect(coordinator).updateLeverage(1, 0))
        .to.emit(vault, 'MarketUpdated')
        .withArgs(1, 0.2e6, 0)

      expect((await vault.registrations(1)).weight).to.eq(0.2e6)
      expect((await vault.registrations(1)).leverage).to.eq(0)
    })

    it('reverts when invalid marketId', async () => {
      await expect(vault.connect(coordinator).updateLeverage(2, parse6decimal('1'))).to.be.revertedWithCustomError(
        vault,
        'VaultMarketDoesNotExistError',
      )
    })

    it('reverts when not coordinator', async () => {
      await expect(vault.connect(user).updateLeverage(2, parse6decimal('1'))).to.be.revertedWithCustomError(
        vault,
        'VaultNotCoordinatorError',
      )
    })
  })

  describe('#updateWeights', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(coordinator).updateWeights([parse6decimal('0.4'), parse6decimal('0.6')]))
        .to.emit(vault, 'MarketUpdated')
        .withArgs(0, parse6decimal('0.4'), parse6decimal('4'))
        .to.emit(vault, 'MarketUpdated')
        .withArgs(1, parse6decimal('0.6'), parse6decimal('4'))

      expect((await vault.registrations(0)).weight).to.eq(0.4e6)
      expect((await vault.registrations(0)).leverage).to.eq(parse6decimal('4'))
      expect((await vault.registrations(1)).weight).to.eq(0.6e6)
      expect((await vault.registrations(1)).leverage).to.eq(parse6decimal('4'))
    })

    it('reverts when too few', async () => {
      await expect(vault.connect(coordinator).updateWeights([parse6decimal('1.0')])).to.be.revertedWithCustomError(
        vault,
        'VaultMarketDoesNotExistError',
      )
    })

    it('reverts when too many', async () => {
      await expect(
        vault.connect(coordinator).updateWeights([parse6decimal('0.2'), parse6decimal('0.2'), parse6decimal('0.6')]),
      ).to.be.revertedWithCustomError(vault, 'VaultMarketDoesNotExistError')
    })

    it('reverts when invalid aggregate', async () => {
      await expect(
        vault.connect(coordinator).updateWeights([parse6decimal('0.5'), parse6decimal('0.4')]),
      ).to.be.revertedWithCustomError(vault, 'VaultAggregateWeightError')
    })

    it('reverts when not coordinator', async () => {
      await expect(
        vault.connect(user).updateWeights([parse6decimal('0.4'), parse6decimal('0.6')]),
      ).to.be.revertedWithCustomError(vault, 'VaultNotCoordinatorError')
    })
  })

  describe('#updateCoordinator', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(owner).updateCoordinator(user.address))
        .to.emit(vault, 'CoordinatorUpdated')
        .withArgs(user.address)

      expect(await vault.coordinator()).to.equal(user.address)
    })

    it('reverts when not owner', async () => {
      await expect(vault.connect(user).updateCoordinator(user.address)).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#updateAllowed', () => {
    beforeEach(async () => {
      // Disable all accounts
      await vault.connect(owner).updateAllowed(constants.AddressZero, false)
    })

    it('updates allowed status correctly', async () => {
      await expect(vault.connect(owner).updateAllowed(user.address, false))
        .to.emit(vault, 'AllowedUpdated')
        .withArgs(user.address, false)
      expect(await vault.allowed(user.address)).to.be.false
      await expect(vault.connect(owner).updateAllowed(user.address, true))
        .to.emit(vault, 'AllowedUpdated')
        .withArgs(user.address, true)
      expect(await vault.allowed(user.address)).to.be.true
    })

    it('updates user position with only user allowed', async () => {
      // check user is not allowed to interact with the vault
      expect(await vault.allowed(user.address)).to.be.false
      expect(await vault.allowed(constants.AddressZero)).to.be.false

      // should revert if not allowed
      await expect(vault.connect(user).update(user.address, parse6decimal('10'), 0, 0)).to.be.revertedWithCustomError(
        vault,
        'VaultNotAllowedError',
      )

      // allow user to interact with the vault
      await expect(vault.connect(owner).updateAllowed(user.address, true))
        .to.emit(vault, 'AllowedUpdated')
        .withArgs(user.address, true)

      // should update allowed
      expect(await vault.allowed(user.address)).to.be.true

      // should not revert if allowed
      await expect(vault.connect(user).update(user.address, parse6decimal('10'), 0, 0)).to.not.be.reverted
    })

    it('updates user position with all accounts allowed', async () => {
      // check all accounts are not allowed to interact with the vault
      expect(await vault.allowed(constants.AddressZero)).to.be.false

      // should revert if not allowed
      await expect(vault.connect(user).update(user.address, parse6decimal('10'), 0, 0)).to.be.revertedWithCustomError(
        vault,
        'VaultNotAllowedError',
      )

      // allow all accounts to interact with the vault
      await expect(vault.connect(owner).updateAllowed(constants.AddressZero, true))
        .to.emit(vault, 'AllowedUpdated')
        .withArgs(constants.AddressZero, true)

      // should update allowed
      expect(await vault.allowed(constants.AddressZero)).to.be.true

      // should not revert if allowed
      await expect(vault.connect(user).update(user.address, parse6decimal('10'), 0, 0)).to.not.be.reverted
    })
  })

  describe('#settle', () => {
    it('simple deposits and redemptions', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('8'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.rebalance(user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('8008'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2002'))
      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.settle(user.address)
      const checkpoint2 = await vault.checkpoints(2)
      expect(checkpoint2.deposit).to.equal(largeDeposit)
      expect(checkpoint2.assets).to.equal(smallDeposit)
      expect(checkpoint2.shares).to.equal(smallDeposit)
      expect(checkpoint2.deposits).to.equal(1)
      expect(checkpoint2.timestamp).to.equal((await market.pendingOrders(vault.address, 2)).timestamp)

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('10010'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('10010'))
      expect(await vault.convertToAssets(parse6decimal('10010'))).to.equal(parse6decimal('10010'))
      expect(await vault.convertToShares(parse6decimal('10010'))).to.equal(parse6decimal('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage originalOraclePrice.
      expect(await position()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )

      // User 2 should not be able to redeem; they haven't deposited anything.
      await expect(vault.connect(user2).update(user2.address, 0, 1, 0)).to.be.revertedWithPanic(0x11)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.settle(user.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('414858')
      expect(await totalCollateralInVault()).to.equal(parse6decimal('10010').add(fundingAmount).mul(1e12))
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(parse6decimal('10010').add(fundingAmount))
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('10010').add(fundingAmount),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect((await vault.accounts(user.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
    })
  })

  describe('#deposit/#redeem/#claim/#rebalance', () => {
    it('simple deposits and redemptions', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('8'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.rebalance(user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('8008'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2002'))
      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.rebalance(user.address)
      const checkpoint2 = await vault.checkpoints(2)
      expect(checkpoint2.deposit).to.equal(largeDeposit)
      expect(checkpoint2.assets).to.equal(smallDeposit)
      expect(checkpoint2.shares).to.equal(smallDeposit)
      expect(checkpoint2.deposits).to.equal(1)
      expect(checkpoint2.timestamp).to.equal((await market.pendingOrders(vault.address, 2)).timestamp)

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('10010'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('10010'))
      expect(await vault.convertToAssets(parse6decimal('10010'))).to.equal(parse6decimal('10010'))
      expect(await vault.convertToShares(parse6decimal('10010'))).to.equal(parse6decimal('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage originalOraclePrice.
      expect(await position()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )

      // User 2 should not be able to redeem; they haven't deposited anything.
      await expect(vault.connect(user2).update(user2.address, 0, 1, 0)).to.be.revertedWithPanic(0x11)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('414858')
      expect(await totalCollateralInVault()).to.equal(parse6decimal('10010').add(fundingAmount).mul(1e12))
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(parse6decimal('10010').add(fundingAmount))
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('10010').add(fundingAmount),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect((await vault.accounts(user.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
    })

    it('simple deposits and redemptions (double withdrawal error check)', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('8'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.rebalance(user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('8008'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2002'))
      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.rebalance(user.address)
      const checkpoint2 = await vault.checkpoints(2)
      expect(checkpoint2.deposit).to.equal(largeDeposit)
      expect(checkpoint2.assets).to.equal(smallDeposit)
      expect(checkpoint2.shares).to.equal(smallDeposit)
      expect(checkpoint2.deposits).to.equal(1)
      expect(checkpoint2.timestamp).to.equal((await market.pendingOrders(vault.address, 2)).timestamp)

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('10010'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('10010'))
      expect(await vault.convertToAssets(parse6decimal('10010'))).to.equal(parse6decimal('10010'))
      expect(await vault.convertToShares(parse6decimal('10010'))).to.equal(parse6decimal('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage originalOraclePrice.
      expect(await position()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )

      const half = smallDeposit.add(largeDeposit).div(2).add(smallDeposit)
      await vault.connect(user).update(user.address, 0, half, 0)

      await updateOracle()
      await expect(vault.connect(user2).update(user2.address, smallDeposit, 0, 0)).to.not.reverted // this will create min position in the market
      await expect(vault.connect(user).update(user.address, 0, 0, half)).to.not.reverted // this will revert even though it's just claiming
    })

    it('multiple users', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('23238')
      const balanceOf2 = BigNumber.from('9999767625')
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect((await vault.accounts(user2.address)).shares).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(parse6decimal('11000').add(fundingAmount0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(
        parse6decimal('1000').add(balanceOf2),
      )
      expect(await vault.convertToAssets(parse6decimal('1000').add(balanceOf2))).to.equal(
        parse6decimal('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('11000').add(fundingAmount0))).to.equal(
        parse6decimal('1000').add(balanceOf2),
      )

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('64452')
      const fundingAmount2 = BigNumber.from('1022204')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('11000').add(fundingAmount).add(fundingAmount2).mul(1e12),
      )
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(parse6decimal('1000').add(fundingAmount))
      expect((await vault.accounts(user2.address)).assets).to.equal(parse6decimal('10000').add(fundingAmount2))
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('11000').add(fundingAmount).add(fundingAmount2),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await vault.connect(user2).update(user2.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user2.address)).to.equal(parse6decimal('100000').add(fundingAmount2).mul(1e12))
      expect((await vault.accounts(user2.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
    })

    it('pending order limits max position size', async () => {
      // settle pending orders from test setup to simplify the test
      await updateOracle()
      await market.connect(user).settle(user.address)
      await market.connect(user2).settle(user.address)
      await market.connect(btcUser1).settle(btcUser1.address)
      await market.connect(btcUser2).settle(btcUser2.address)

      const makerAvailable = (await market.riskParameter()).makerLimit.sub((await currentPositionGlobal(market)).maker)
      const reservedForVault = parse6decimal('5')

      // risk parameters limit maker position to 1000; let a non-vault user consume most of that
      await asset.connect(perennialUser).approve(margin.address, constants.MaxUint256)
      const nonVaultDeposit = parse6decimal('662500')
      await margin.connect(perennialUser).deposit(perennialUser.address, nonVaultDeposit)
      await market.connect(perennialUser)['update(address,int256,int256,int256,address)'](
        perennialUser.address,
        makerAvailable.sub(reservedForVault), // 795
        0,
        nonVaultDeposit,
        constants.AddressZero,
      )

      const deposit = parse6decimal('11000')
      await vault.connect(user).update(user.address, deposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // Now we should have opened positions.
      // The ETH position should be limited by a maxPosition influenced by perennialUser's pending order.
      expect(await position()).to.be.equal(reservedForVault)
      expect(await btcPosition()).to.be.equal(deposit.mul(leverage).div(5).div(btcOriginalOraclePrice))

      expect((await vault.accounts(user.address)).shares).to.equal(deposit)
      expect(await vault.totalAssets()).to.equal(deposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(deposit)
      expect(await vault.convertToAssets(deposit)).to.equal(deposit)
      expect(await vault.convertToShares(deposit)).to.equal(deposit)
    })

    it('deposit during redemption', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const largeDeposit = parse6decimal('2000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await vault.connect(user).update(user.address, 0, parse6decimal('400'), 0)
      await updateOracle()
      await vault.rebalance(user.address)
      await vault.rebalance(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit.add(largeDeposit).sub(parse6decimal('400')).mul(4).div(5).mul(leverage).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).sub(parse6decimal('400')).div(5).mul(leverage).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('13943')
      const balanceOf2 = BigNumber.from('1999953525')
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('600'))
      expect((await vault.accounts(user2.address)).shares).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(parse6decimal('2600').add(fundingAmount0))
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('2600')
          .add(fundingAmount0)
          .add((await vault.accounts(ethers.constants.AddressZero)).assets)
          .mul(1e12),
      )
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('600').add(balanceOf2))
      expect(await vault.convertToAssets(parse6decimal('600').add(balanceOf2))).to.equal(
        parse6decimal('2600').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('2600').add(fundingAmount0))).to.equal(
        parse6decimal('600').add(balanceOf2),
      )

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('49197')
      const fundingAmount2 = BigNumber.from('214051')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('3000').add(fundingAmount).add(fundingAmount2).mul(1e12),
      )
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(parse6decimal('1000').add(fundingAmount))
      expect((await vault.accounts(user2.address)).assets).to.equal(parse6decimal('2000').add(fundingAmount2))
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('3000').add(fundingAmount).add(fundingAmount2),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await vault.connect(user2).update(user2.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user2.address)).to.equal(parse6decimal('100000').add(fundingAmount2).mul(1e12))
      expect((await vault.accounts(user2.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
    })

    it('deposit / redemption global-local share sync', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      await vault.connect(owner).updateParameter({
        ...(await vault.parameter()),
        minDeposit: parse6decimal('10'),
      })

      const smallDeposit = parse6decimal('11000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      await vault.connect(user2).update(user2.address, smallDeposit, 0, 0)
      await vault.connect(user).update(user.address, 0, parse6decimal('10000'), 0)
      await updateOracle()
      await vault.settle(user.address)
      await vault.settle(user2.address)

      const localShares = (await vault.accounts(user.address)).shares.add((await vault.accounts(user2.address)).shares)
      expect(await vault.totalShares()).to.equal(localShares)
    })

    it('max redeem', async () => {
      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const shareAmount = BigNumber.from(parse6decimal('1000'))
      expect((await vault.accounts(user.address)).shares).to.equal(shareAmount)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const shareAmount2 = BigNumber.from('9999767625')
      expect((await vault.accounts(user.address)).shares).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to redeem more than balance.
      await expect(
        vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares.add(1), 0),
      ).to.be.revertedWithPanic(0x11)

      // But we should be able to redeem exactly balance.

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)

      // The oracle price hasn't changed yet, so we shouldn't be able to redeem any more.
      expect((await vault.accounts(user.address)).shares).to.equal(0)

      // But if we update the oracle price, we should be able to redeem the rest of our shares.
      await updateOracle()
      await vault.rebalance(user.address)

      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('max redeem with close limited (1st market)', async () => {
      const largeDeposit = parse6decimal('10000')

      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const currentPosition = await currentPositionGlobal(market)
      const currentNet = currentPosition.long.sub(currentPosition.short).abs()

      // Open taker position up to 100% utilization minus 1 ETH
      await asset.connect(perennialUser).approve(margin.address, constants.MaxUint256)
      const takerDeposit = parse6decimal('1000000')
      await margin.connect(perennialUser).deposit(perennialUser.address, takerDeposit)
      await market
        .connect(perennialUser)
        ['update(address,int256,int256,int256,address)'](
          perennialUser.address,
          0,
          currentPosition.maker.sub(currentNet).sub(parse6decimal('1')),
          takerDeposit,
          constants.AddressZero,
        )

      // Settle the take position
      await updateOracle()
      await vault.rebalance(user.address)

      // The vault can close 1 ETH of maker positions in the ETH market, which means the user can redeem 5/4 this amount
      const minPosition = BigNumber.from(11212633)
      const minCollateral = originalOraclePrice.mul(minPosition).div(leverage).mul(5).div(4)
      const totalCollateral = (await totalCollateralInVault()).div(1e12)
      const maxRedeem = await vault.convertToShares(totalCollateral.sub(minCollateral))

      await expect(vault.connect(user).update(user.address, 0, maxRedeem, 0)).to.be.revertedWithCustomError(
        vault,
        'MakerStrategyInsufficientAssetsError',
      )
      await expect(vault.connect(user).update(user.address, 0, maxRedeem.sub(parse6decimal('1')), 0)).to.not.be.reverted
    })

    it('max redeem with close limited (2nd market)', async () => {
      const largeDeposit = parse6decimal('10000')

      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const currentPosition = await currentPositionGlobal(btcMarket)
      const currentNet = currentPosition.long.sub(currentPosition.short).abs()

      // Open taker position up to 100% utilization minus 0.1 BTC
      await asset.connect(perennialUser).approve(margin.address, constants.MaxUint256)
      const takerDeposit = parse6decimal('1000000')
      await margin.connect(perennialUser).deposit(perennialUser.address, takerDeposit)
      await btcMarket
        .connect(perennialUser)
        ['update(address,int256,int256,int256,address)'](
          perennialUser.address,
          0,
          currentPosition.maker.sub(currentNet).sub(parse6decimal('0.1')),
          takerDeposit,
          constants.AddressZero,
        )

      // Settle the take position
      await updateOracle()
      await vault.rebalance(user.address)

      // The vault can close 1 BTC of maker positions in the BTC market, which means the user can redeem 5/1 this amount
      const minPosition = BigNumber.from(105981)
      const minCollateral = btcOriginalOraclePrice.mul(minPosition).div(leverage).mul(5)
      const totalCollateral = (await totalCollateralInVault()).div(1e12)
      const maxRedeem = await vault.convertToShares(totalCollateral.sub(minCollateral))

      await expect(vault.connect(user).update(user.address, 0, maxRedeem, 0)).to.be.revertedWithCustomError(
        vault,
        'MakerStrategyInsufficientAssetsError',
      )
      await expect(vault.connect(user).update(user.address, 0, maxRedeem.sub(parse6decimal('1')), 0)).to.not.be.reverted
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).update(user.address, parse6decimal('99000'), 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // vault starts balanced
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // price lowers, vault does one round of rebalancing but its maintenance's are still out-of-sync
      await updateOracle(parse6decimal('2000'))
      await vault.connect(user).update(user.address, 1, 0, 0)
      expect(await collateralInVault()).to.not.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // vault does another round of rebalancing and its maintenance's are now in-sync
      await updateOracle(parse6decimal('2000'))
      await vault.connect(user).update(user.address, 1, 0, 0)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // price raises, vault does one round of rebalancing but its maintenance's are still out-of-sync
      await updateOracle(originalOraclePrice)
      await vault.connect(user).update(user.address, 1, 0, 0)
      expect(await collateralInVault()).to.not.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // vault does one round of rebalancing but it maintenance's are still out-of-sync
      await updateOracle(originalOraclePrice)
      await vault.connect(user).update(user.address, 1, 0, 0)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))
    })

    it('rounds deposits correctly', async () => {
      const oddDepositAmount = parse6decimal('10000').add(1) // 10K + 1 wei

      await vault.connect(user).update(user.address, oddDepositAmount, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)
      expect(await asset.balanceOf(vault.address)).to.equal(0) // deposits everything into markets
      expect((await collateralInVault()).add(await btcCollateralInVault())).to.equal(oddDepositAmount)

      await vault.connect(user).update(user.address, oddDepositAmount, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)
    })

    it('operate on behalf', async () => {
      const largeDeposit = parse6decimal('10000')
      await expect(vault.connect(liquidator).update(user.address, largeDeposit, 0, 0)).to.revertedWithCustomError(
        vault,
        'VaultNotOperatorError',
      )
      await marketFactory.connect(user).updateOperator(liquidator.address, true)
      vault.connect(liquidator).update(user.address, largeDeposit, 0, 0)
      await marketFactory.connect(user).updateOperator(liquidator.address, false)

      await updateOracle()
      await vault.rebalance(user.address)

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10000'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('10000'))
      expect(await asset.balanceOf(liquidator.address)).to.equal(parse6decimal('190000').mul(1e12))
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').mul(1e12))

      await expect(
        vault.connect(liquidator).update(user.address, parse6decimal('10000'), 0, 0),
      ).to.revertedWithCustomError(vault, 'VaultNotOperatorError')
      await marketFactory.connect(user).updateOperator(liquidator.address, true)
      await vault.connect(liquidator).update(user.address, 0, parse6decimal('10000'), 0)
      await marketFactory.connect(user).updateOperator(liquidator.address, false)
      await updateOracle()
      await vault.rebalance(user.address)

      const fundingAmount = BigNumber.from('218864')
      await expect(
        vault.connect(liquidator).update(user.address, 0, 0, ethers.constants.MaxUint256),
      ).to.revertedWithCustomError(vault, 'VaultNotOperatorError')
      await marketFactory.connect(user).updateOperator(liquidator.address, true)
      await vault.connect(liquidator).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await marketFactory.connect(user).updateOperator(liquidator.address, false)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(parse6decimal('200000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').mul(1e12))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(margin.address, constants.MaxUint256)
      const makerDeposit = parse6decimal('400000')
      await margin.connect(perennialUser).deposit(perennialUser.address, makerDeposit)
      await market
        .connect(perennialUser)
        ['update(address,int256,int256,int256,address)'](
          perennialUser.address,
          parse6decimal('480'),
          0,
          makerDeposit,
          constants.AddressZero,
        )
      await updateOracle()
      await vault.rebalance(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal('205981')
    })

    it('exactly at makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(margin.address, constants.MaxUint256)
      const makerAvailable = (await market.riskParameter()).makerLimit.sub((await currentPositionGlobal(market)).maker)
      const makerDeposit = parse6decimal('400000')
      await margin.connect(perennialUser).deposit(perennialUser.address, makerDeposit)
      await market
        .connect(perennialUser)
        ['update(address,int256,int256,int256,address)'](
          perennialUser.address,
          makerAvailable,
          0,
          makerDeposit,
          constants.AddressZero,
        )

      await updateOracle()
      await vault.rebalance(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
    })

    it('close to taker', async () => {
      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(margin.address, constants.MaxUint256)
      const takerDeposit = parse6decimal('1000000')
      await margin.connect(perennialUser).deposit(perennialUser.address, takerDeposit)
      await market
        .connect(perennialUser)
        ['update(address,int256,int256,int256,address)'](
          perennialUser.address,
          0,
          parse6decimal('110'),
          takerDeposit,
          constants.AddressZero,
        )

      await updateOracle()
      await vault.rebalance(user.address)

      const makerAvailable = BigNumber.from(2212633)
      const redeemAvailable = await vault.convertToShares(
        originalOraclePrice.mul(makerAvailable).mul(5).div(4).div(leverage),
      )

      // Redeem should create a greater position delta than what's available
      await vault.connect(user).update(user.address, 0, redeemAvailable, 0)
      await updateOracle()
      await vault.rebalance(user.address)
    })

    it('deposit correctly calculates funds eligible for allocation', async () => {
      const ONE = parse6decimal('1')
      // two users deposit funds, vault is balanced
      await vault.connect(user).update(user.address, parse6decimal('50000'), 0, 0)
      await vault.connect(user2).update(user2.address, parse6decimal('25000'), 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)
      await vault.settle(user.address)
      await vault.settle(user2.address)
      const btcCollateral = await btcCollateralInVault()
      expect(await collateralInVault()).to.be.closeTo(btcCollateral.mul(4), ONE)

      // price drops from 38838 to 25535 while vault's maker position has short exposure
      await updateOracle(undefined, parse6decimal('25535'))

      // user2 converts all shares to assets
      await vault.connect(user2).update(user2.address, 0, ethers.constants.MaxUint256, 0)

      // in same version, user makes another deposit
      await vault.connect(user).update(user.address, parse6decimal('50000'), 0, 0)

      // settle and confirm positions did not exclude assets from the second deposit
      await updateOracle()
      await vault.settle(user.address)
      // position = assets * leverage / price = 85088.172487 * 4 / 2620.237388
      expect(await position()).to.be.closeTo(parse6decimal('129.893837'), ONE)
      // position = assets * leverage / price = 21272.043121 * 4 / 25535
      expect(await btcPosition()).to.be.closeTo(parse6decimal('3.332217'), ONE)
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
      const marketParameter = { ...(await market.parameter()) }
      const btcMarketParameter = { ...(await btcMarket.parameter()) }

      marketParameter.closed = true
      await market.connect(owner).updateParameter(marketParameter)
      btcMarketParameter.closed = true
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await updateOracle()
      await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance

      await updateOracle()
      await settleUnderlying(vaultSigner)

      // We should have closed all positions
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      marketParameter.closed = false
      await market.connect(owner).updateParameter(marketParameter)
      btcMarketParameter.closed = false
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await updateOracle()
      await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance

      await updateOracle()
      await settleUnderlying(vaultSigner)

      // Positions should be opened back up again
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
    })

    it.only('multiple users w/ makerFee', async () => {
      const marketParameter = { ...(await market.parameter()) }
      await market.updateParameter({
        ...marketParameter,
        makerFee: parse6decimal('0.001'),
      })
      const btcRiskParameters = { ...(await btcMarket.parameter()) }
      await btcMarket.updateParameter({
        ...btcRiskParameters,
        makerFee: parse6decimal('0.001'),
      })

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      const collateralForRebalance = parse6decimal('996').add(largeDeposit).add(10)
      expect(await position()).to.be.equal(collateralForRebalance.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.be.equal(collateralForRebalance.mul(leverage).div(5).div(btcOriginalOraclePrice))

      const balanceOf2 = BigNumber.from('9999782696')
      const totalAssets = BigNumber.from('10996023245')
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect((await vault.accounts(user2.address)).shares).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(totalAssets)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(
        parse6decimal('1000').add(balanceOf2),
      )
      expect(await vault.convertToAssets(parse6decimal('1000').add(balanceOf2))).to.equal(totalAssets)
      expect(await vault.convertToShares(totalAssets)).to.equal(parse6decimal('1000').add(balanceOf2))

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const marketLocalPreviousCurrentId = (await market.locals(vault.address)).currentId.sub(1)
      const btcMarketLocalPreviousCurrentId = (await btcMarket.locals(vault.address)).currentId.sub(1)

      const marketPreviousCurrenTimestamp = (await market.pendingOrders(vault.address, marketLocalPreviousCurrentId))
        .timestamp
      const btcMarketPreviousCurrenTimestamp = (
        await market.pendingOrders(vault.address, btcMarketLocalPreviousCurrentId)
      ).timestamp

      const currentTradeFee = (await market.checkpoints(vault.address, marketPreviousCurrenTimestamp)).tradeFee
      const btcCurrentTradeFee = (await btcMarket.checkpoints(vault.address, btcMarketPreviousCurrenTimestamp)).tradeFee

      const unclaimed1 = BigNumber.from('991920553')
      const unclaimed2 = BigNumber.from('9921195678')
      const finalTotalAssets = BigNumber.from('39840089') // last trade fee
      expect(await totalCollateralInVault()).to.equal(unclaimed1.add(unclaimed2).mul(1e12))
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect(currentTradeFee.add(btcCurrentTradeFee)).to.equal(finalTotalAssets)
      expect(await vault.totalAssets()).to.equal(finalTotalAssets)
      expect(await vault.totalShares()).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(unclaimed1)
      expect((await vault.accounts(user2.address)).assets).to.equal(unclaimed2)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(unclaimed1.add(unclaimed2))

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await vault.connect(user2).update(user2.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(finalTotalAssets)
      expect(await vault.totalShares()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(unclaimed1).sub(parse6decimal('1000')).mul(1e12),
      )
      expect(await asset.balanceOf(user2.address)).to.equal(
        parse6decimal('100000').add(unclaimed2).sub(parse6decimal('10000')).mul(1e12),
      )
      expect((await vault.accounts(user2.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)

      await updateOracle()
      await vault.rebalance(user.address)
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      // FIXME: actual is over 10x higher
      expect(await vault.totalAssets()).to.equal(parse6decimal('1000').add(0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.convertToAssets(parse6decimal('1000'))).to.equal(parse6decimal('1000').add(0))
      expect(await vault.convertToShares(parse6decimal('1000').add(0))).to.equal(parse6decimal('1000'))
    })

    it.only('multiple users w/ makerFee + settlement fee', async () => {
      const marketParameter = { ...(await market.parameter()) }
      await market.updateParameter({
        ...marketParameter,
        makerFee: parse6decimal('0.001'),
      })
      const btcRiskParameters = { ...(await btcMarket.parameter()) }
      await btcMarket.updateParameter({
        ...btcRiskParameters,
        makerFee: parse6decimal('0.001'),
      })

      const oracleRecteipt = { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('1.00') }
      await updateOracle(undefined, undefined, oracleRecteipt, oracleRecteipt)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      const tx = await vault.rebalance(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      const settlementFeeCharged = parse6decimal('1').mul(2)
      const linearFeeCharged = parse6decimal('2').mul(2)
      const collateralForRebalance = smallDeposit
        .add(largeDeposit)
        .sub(linearFeeCharged)
        .sub(settlementFeeCharged)
        .add(10)
      expect(await position()).to.be.equal(collateralForRebalance.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.be.equal(collateralForRebalance.mul(leverage).div(5).div(btcOriginalOraclePrice))

      const balanceOf2 = BigNumber.from('10017692486')
      const totalAssets = BigNumber.from('10994043690')
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect((await vault.accounts(user2.address)).shares).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(totalAssets)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(
        parse6decimal('1000').add(balanceOf2),
      )
      expect(await vault.convertToAssets(parse6decimal('1000').add(balanceOf2))).to.equal(totalAssets)
      expect(await vault.convertToShares(totalAssets)).to.equal(parse6decimal('1000').add(balanceOf2))

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const marketLocalPreviousCurrentId = (await market.locals(vault.address)).currentId.sub(1)
      const btcMarketLocalPreviousCurrentId = (await btcMarket.locals(vault.address)).currentId.sub(1)

      const marketPreviousCurrenTimestamp = (await market.pendingOrders(vault.address, marketLocalPreviousCurrentId))
        .timestamp
      const btcMarketPreviousCurrenTimestamp = (
        await market.pendingOrders(vault.address, btcMarketLocalPreviousCurrentId)
      ).timestamp

      const currentTradeFee = (await market.checkpoints(vault.address, marketPreviousCurrenTimestamp)).tradeFee
      const btcCurrentTradeFee = (await btcMarket.checkpoints(vault.address, btcMarketPreviousCurrenTimestamp)).tradeFee

      const currentSettlementFee = (await market.checkpoints(vault.address, marketPreviousCurrenTimestamp))
        .settlementFee
      const btcCurrentSettlementFee = (await btcMarket.checkpoints(vault.address, btcMarketPreviousCurrenTimestamp))
        .settlementFee

      const unclaimed1 = BigNumber.from('987960350')
      const unclaimed2 = BigNumber.from('9917600959')
      const finalTotalAssets = BigNumber.from('41832096') // last trade fee + settlement fee
      expect(await totalCollateralInVault()).to.equal(unclaimed1.add(unclaimed2).mul(1e12))
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect(currentTradeFee.add(btcCurrentTradeFee).add(currentSettlementFee).add(btcCurrentSettlementFee)).to.equal(
        finalTotalAssets,
      )
      expect(await vault.totalAssets()).to.equal(finalTotalAssets)
      expect(await vault.totalShares()).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(unclaimed1)
      expect((await vault.accounts(user2.address)).assets).to.equal(unclaimed2)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(unclaimed1.add(unclaimed2))

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await vault.connect(user2).update(user2.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(finalTotalAssets)
      expect(await vault.totalShares()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(unclaimed1).sub(parse6decimal('1000')).mul(1e12),
      )
      expect(await asset.balanceOf(user2.address)).to.equal(
        parse6decimal('100000').add(unclaimed2).sub(parse6decimal('10000')).mul(1e12),
      )
      expect((await vault.accounts(user2.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)

      await updateOracle()
      await vault.rebalance(user.address)
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      // FIXME: actual is over 10x higher
      expect(await vault.totalAssets()).to.equal(parse6decimal('1000').add(0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.convertToAssets(parse6decimal('1000'))).to.equal(parse6decimal('1000').add(0))
      expect(await vault.convertToShares(parse6decimal('1000').add(0))).to.equal(parse6decimal('1000'))
    })

    it('simple deposits and redemptions w/ factory initial amount', async () => {
      // re-setup vault w/ initial amount
      const vaultFactoryProxy2 = await new TransparentUpgradeableProxy__factory(owner).deploy(
        marketFactory.address, // dummy contract
        proxyAdmin.address,
        [],
      )
      const vaultImpl = await new MakerVault__factory(owner).deploy()
      const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
        marketFactory.address,
        vaultImpl.address,
        parse6decimal('1'),
      )
      await proxyAdmin.upgrade(vaultFactoryProxy2.address, vaultFactoryImpl.address)
      const vaultFactory2 = IVaultFactory__factory.connect(vaultFactoryProxy2.address, owner)
      await vaultFactory2.initialize()

      await fundWallet(asset, owner)
      await asset.approve(vaultFactory2.address, ethers.utils.parseEther('1'))
      const vault2 = IMakerVault__factory.connect(
        await vaultFactory2.callStatic.create(asset.address, market.address, parse6decimal('1.2'), 'Blue Chip'),
        owner,
      )
      await vaultFactory2.create(asset.address, market.address, parse6decimal('1.2'), 'Blue Chip')

      await updateOracle()

      await vault2.rebalance(vaultFactory2.address)

      expect((await vault2.accounts(vaultFactory2.address)).assets).to.equal(0)
      expect((await vault2.accounts(vaultFactory2.address)).shares).to.equal(parse6decimal('1'))
    })

    it('simple deposits and redemptions w/ factory initial amount (with fees)', async () => {
      const marketParameter = { ...(await market.parameter()) }
      await market.updateParameter({
        ...marketParameter,
        makerFee: parse6decimal('0.001'),
      })

      const oracleRecteipt = { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('1.00') }
      await updateOracle(undefined, undefined, oracleRecteipt, oracleRecteipt)

      // re-setup vault w/ initial amount
      const vaultFactoryProxy2 = await new TransparentUpgradeableProxy__factory(owner).deploy(
        marketFactory.address, // dummy contract
        proxyAdmin.address,
        [],
      )
      const vaultImpl = await new MakerVault__factory(owner).deploy()
      const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
        marketFactory.address,
        vaultImpl.address,
        parse6decimal('1'),
      )
      await proxyAdmin.upgrade(vaultFactoryProxy2.address, vaultFactoryImpl.address)
      const vaultFactory2 = IVaultFactory__factory.connect(vaultFactoryProxy2.address, owner)
      await vaultFactory2.initialize()

      await fundWallet(asset, owner)
      await asset.approve(vaultFactory2.address, ethers.utils.parseEther('1'))
      const vault2 = IMakerVault__factory.connect(
        await vaultFactory2.callStatic.create(asset.address, market.address, parse6decimal('1.2'), 'Blue Chip'),
        owner,
      )
      await vaultFactory2.create(asset.address, market.address, parse6decimal('1.2'), 'Blue Chip')

      await updateOracle()

      await vault2.rebalance(vaultFactory2.address)

      expect((await vault2.accounts(vaultFactory2.address)).assets).to.equal(0)
      expect((await vault2.accounts(vaultFactory2.address)).shares).to.equal(parse6decimal('1'))
    })

    it('zero address settle w/ settlement fee', async () => {
      const riskParameters = { ...(await market.riskParameter()) }
      await market.updateRiskParameter({
        ...riskParameters,
        synBook: {
          ...riskParameters.synBook,
          d0: parse6decimal('0.001'),
          d1: parse6decimal('0.002'),
          d2: parse6decimal('0.004'),
          d3: parse6decimal('0.008'),
        },
      })
      const btcRiskParameters = { ...(await btcMarket.riskParameter()) }
      await btcMarket.updateRiskParameter({
        ...btcRiskParameters,
        synBook: {
          ...riskParameters.synBook,
          d0: parse6decimal('0.001'),
          d1: parse6decimal('0.002'),
          d2: parse6decimal('0.004'),
          d3: parse6decimal('0.008'),
        },
      })

      const oracleRecteipt = { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('1.00') }
      await updateOracle(undefined, undefined, oracleRecteipt, oracleRecteipt)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(constants.AddressZero)
      await vault.rebalance(user.address)
      await vault.rebalance(user2.address)

      await vault.connect(user).update(user.address, 0, constants.MaxUint256, 0)
      await vault.connect(user2).update(user2.address, 0, constants.MaxUint256, 0)
      await updateOracle()
      await vault.rebalance(constants.AddressZero)
      await vault.rebalance(user.address)
      await vault.rebalance(user2.address)

      const totalAssets = BigNumber.from('10984291835')
      expect((await vault.accounts(constants.AddressZero)).assets).to.equal(totalAssets)
    })

    it('market positions reduces significantly with lower leverage buffer', async () => {
      await vault.connect(user).update(user.address, parse6decimal('10000'), 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)
      expect(await position()).to.be.equal(parse6decimal('12.212633'))
      expect(await btcPosition()).to.be.equal(parse6decimal('0.205981'))

      // set leverage buffer to 0.4
      const leverageBuffer = parse6decimal('0.4')
      await vault
        .connect(owner)
        .updateParameter({ maxDeposit: maxCollateral, minDeposit: parse6decimal('10'), profitShare: 0, leverageBuffer })
      await vault.connect(user).update(user.address, parse6decimal('10'), 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      // expect position to be reduced
      expect(await position()).to.be.equal(parse6decimal('4.889940'))
      expect(await btcPosition()).to.be.equal(parse6decimal('0.082475'))
    })

    it('reverts when below minDeposit', async () => {
      await vault.connect(owner).updateParameter({
        ...(await vault.parameter()),
        maxDeposit: maxCollateral,
        minDeposit: parse6decimal('10'),
      })
      await expect(vault.connect(user).update(user.address, parse6decimal('0.50'), 0, 0)).to.revertedWithCustomError(
        vault,
        'VaultInsufficientMinimumError',
      )
      await vault.connect(user).update(user.address, parse6decimal('10'), 0, 0)
      await updateOracle()

      await expect(vault.connect(user).update(user.address, 0, parse6decimal('0.50'), 0)).to.revertedWithCustomError(
        vault,
        'VaultInsufficientMinimumError',
      )
      await vault.connect(user).update(user.address, 0, parse6decimal('10'), 0)
      await updateOracle()

      await expect(vault.connect(user).update(user.address, 0, 0, parse6decimal('0.50'))).to.not.reverted // claim doesn't charge settlement fee
    })

    it('does not inflate checkpoint count', async () => {
      const oracleRecteipt = { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('1.00') }
      await updateOracle(undefined, undefined, oracleRecteipt, oracleRecteipt)

      const deposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, deposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const deposit2 = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, deposit2, 0, 0)

      const currentId = (await vault.accounts(ethers.constants.AddressZero)).current
      expect((await vault.checkpoints(currentId)).deposits).to.equal(1)
      await vault.connect(btcUser1).update(btcUser1.address, 0, 0, 0)
      expect((await vault.checkpoints(currentId)).deposits).to.equal(1)
    })

    it('doesnt bypass vault maxDeposit', async () => {
      await vault.connect(owner).updateParameter({
        maxDeposit: parse6decimal('100'),
        minDeposit: 0,
        profitShare: 0,
        leverageBuffer: parse6decimal('1.2'),
      })

      await updateOracle()

      const deposit1 = parse6decimal('100')
      await vault.connect(user).update(user.address, deposit1, 0, 0)

      await updateOracle()
      await vault.rebalance(user.address)

      const deposit2 = parse6decimal('10')
      await expect(vault.connect(user).update(user.address, deposit2, 0, 0)).to.be.reverted

      const redeem = parse6decimal('50')
      await vault.connect(user).update(user.address, 0, redeem, 0)

      await updateOracle()
      await vault.rebalance(user.address)

      const deposit3 = parse6decimal('100')
      await expect(vault.connect(user).update(user.address, deposit3, 0, 0)).to.be.reverted

      const deposit4 = parse6decimal('50').add(1)
      await expect(vault.connect(user).update(user.address, deposit4, 0, 0)).to.be.reverted

      const deposit5 = parse6decimal('50')
      await expect(vault.connect(user).update(user.address, deposit5, 0, 0)).to.not.be.reverted
    })

    it('profit shares', async () => {
      await vault.updateParameter({
        maxDeposit: maxCollateral,
        minDeposit: 0,
        profitShare: parse6decimal('0.5'),
        leverageBuffer: parse6decimal('1.2'),
      })
      await vault.updateCoordinator(coordinator.address)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('23238')
      const coordinatorProfit = fundingAmount0.div(2).sub(1) // 1:1 assets / shares
      const balanceOf2 = BigNumber.from('9999883802')
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect((await vault.accounts(user2.address)).shares).to.equal(balanceOf2)
      expect((await vault.accounts(coordinator.address)).shares).to.equal(coordinatorProfit)
      expect(await vault.totalAssets()).to.equal(parse6decimal('11000').add(fundingAmount0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(
        parse6decimal('1000').add(balanceOf2).add(coordinatorProfit),
      )
      expect(await vault.convertToAssets(parse6decimal('1000').add(balanceOf2).add(coordinatorProfit))).to.equal(
        parse6decimal('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('11000').add(fundingAmount0))).to.equal(
        parse6decimal('1000').add(balanceOf2).add(coordinatorProfit),
      )

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(user2.address)

      await vault
        .connect(coordinator)
        .update(coordinator.address, 0, (await vault.accounts(coordinator.address)).shares, 0)
      await updateOracle()
      await vault.rebalance(coordinator.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('64452')
      const fundingAmountMinusProfit = BigNumber.from('38036') // profit is less than half due to overcoming HWM
      const fundingAmount2 = BigNumber.from('1022204')
      const fundingAmount2MinusProfit = BigNumber.from('643179') // profit is less than half due to overcoming HWM
      const fundingAmount3 = BigNumber.from('2')
      const coordinatorProfit2 = fundingAmount
        .sub(fundingAmountMinusProfit)
        .add(fundingAmount2.sub(fundingAmount2MinusProfit))
        .add(fundingAmount3)
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('11000').add(fundingAmount).add(fundingAmount2).add(fundingAmount3).mul(1e12),
      )
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect((await vault.accounts(coordinator.address)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(parse6decimal('1000').add(fundingAmountMinusProfit))
      expect((await vault.accounts(user2.address)).assets).to.equal(
        parse6decimal('10000').add(fundingAmount2MinusProfit),
      )
      expect((await vault.accounts(coordinator.address)).assets).to.equal(coordinatorProfit2)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('11000').add(fundingAmount).add(fundingAmount2).add(fundingAmount3),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await vault.connect(user2).update(user2.address, 0, 0, ethers.constants.MaxUint256)
      await vault.connect(coordinator).update(coordinator.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(fundingAmountMinusProfit).mul(1e12),
      )
      expect(await asset.balanceOf(user2.address)).to.equal(
        parse6decimal('100000').add(fundingAmount2MinusProfit).mul(1e12),
      )
      expect(await asset.balanceOf(coordinator.address)).to.equal(coordinatorProfit2.mul(1e12))
      expect((await vault.accounts(user.address)).assets).to.equal(0)
      expect((await vault.accounts(user2.address)).assets).to.equal(0)
      expect((await vault.accounts(coordinator.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
    })

    it('credits profit shares when account is coordinator', async () => {
      await fundWallet(asset, coordinator),
        asset.connect(coordinator).approve(vault.address, ethers.constants.MaxUint256),
        await vault.updateParameter({
          maxDeposit: maxCollateral,
          minDeposit: 0,
          profitShare: parse6decimal('0.2'),
          leverageBuffer: parse6decimal('10'),
        })
      await vault.updateCoordinator(coordinator.address)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      // User and coordinator make deposits
      const deposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, deposit.mul(2).div(3), 0, 0)
      await updateOracle()
      await vault.rebalance(user.address)

      await vault.connect(coordinator).update(coordinator.address, deposit.div(3), 0, 0)
      await updateOracle()
      await vault.rebalance(coordinator.address)

      // Confirm positions were opened
      expect(await position()).to.be.equal(deposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.be.equal(deposit.mul(leverage).div(5).div(btcOriginalOraclePrice))

      const shares1 = deposit.mul(2).div(3)
      expect((await vault.accounts(user.address)).shares).to.equal(shares1)
      const shares2 = parse6decimal('3333.273688')
      const profitShares = BigNumber.from('29821')
      expect((await vault.accounts(coordinator.address)).shares).to.equal(shares2.add(profitShares))
    })

    it('reverts when paused', async () => {
      await vaultFactory.connect(owner).pause()
      await expect(vault.rebalance(user.address)).to.revertedWithCustomError(vault, 'InstancePausedError')
      await expect(vault.update(user.address, 0, 0, 0)).to.revertedWithCustomError(vault, 'InstancePausedError')
    })

    it('reverts when not single sided', async () => {
      await expect(vault.connect(user).update(user.address, 1, 1, 0)).to.revertedWithCustomError(
        vault,
        'VaultNotSingleSidedError',
      )
      await expect(vault.connect(user).update(user.address, 1, 0, 1)).to.revertedWithCustomError(
        vault,
        'VaultNotSingleSidedError',
      )
      await expect(vault.connect(user).update(user.address, 0, 1, 1)).to.revertedWithCustomError(
        vault,
        'VaultNotSingleSidedError',
      )
      await expect(vault.connect(user).update(user.address, 1, 1, 1)).to.revertedWithCustomError(
        vault,
        'VaultNotSingleSidedError',
      )
    })

    context('liquidation', () => {
      // attempts to redeem a small amount
      async function smallRedeem(account: SignerWithAddress) {
        return vault.connect(account).update(user.address, 0, 4, 0)
      }

      // Test setup establishes a market where takers have a long position, so vaults will have short exposure.
      context('short exposure', () => {
        it('rebalance position to redeem liquidatable vault', async () => {
          // Deposit 100k into the vault and establish initial oracle price (38838.362695).
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // Increase the oracle price such that the vault's maker position violates margin requirements.
          const price = parse6decimal('50000')
          await updateOracle(undefined, price)
          await btcMarket.connect(user).settle(vault.address)

          // Ensure maintenance requirement is violated.
          let collateral = await margin.isolatedBalances(vault.address, btcMarket.address)
          let position = (await btcMarket.positions(vault.address)).maker
          const maintenanceRatio = (await btcMarket.riskParameter()).maintenance
          let maintenanceRequired = position.mul(price).mul(maintenanceRatio).div(1e12)
          expect(collateral).to.be.lessThan(maintenanceRequired)

          // Perform a small redeem, rebalancing the position.
          await expect(smallRedeem(user)).to.not.be.reverted

          // Ensure maintenance requirement is no longer violated.
          collateral = await margin.isolatedBalances(vault.address, btcMarket.address)
          position = (await btcMarket.positions(vault.address)).maker
          maintenanceRequired = position.mul(price).mul(maintenanceRatio).div(1e12)
          expect(collateral).to.be.greaterThan(maintenanceRequired)

          // Redeem funds from the vault.
          await updateOracle()
          vault.connect(user).settle(user.address)
          await expect(vault.connect(user).update(user.address, 0, constants.MaxUint256, 0)).to.not.be.reverted
        })

        it('cannot redeem position which cannot be rebalanced to satisfy margin requirements', async () => {
          // Deposit 100k into the vault and establish initial oracle price (38838.362695).
          const depositAmount = parse6decimal('100000')
          await vault.connect(user).update(user.address, depositAmount, 0, 0)
          await updateOracle()

          // Increase the oracle price such that the vault's maker position violates margin requirements.
          await updateOracle(undefined, parse6decimal('99000'))

          // Ensure the full amount cannot be redeemed.
          await expect(vault.connect(user).update(user.address, 0, depositAmount, 0)).to.be.revertedWithCustomError(
            vault,
            'MakerStrategyInsufficientCollateralError',
          )

          // Ensure a small amount cannot be redeemed.
          await expect(smallRedeem(user)).to.be.revertedWithCustomError(
            vault,
            'MakerStrategyInsufficientCollateralError',
          )
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update increases the price, making the vault's position liquidatable.
          await updateOracle(undefined, parse6decimal('50000'))

          // 2. Settle accounts / Liquidate the vault's maker position.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('5149547500')
          await btcMarket.connect(user).close(vault.address, true, constants.AddressZero)
          expect(await margin.isolatedBalances(vault.address, btcMarket.address)).to.equal(
            BigNumber.from('4428767485').add(EXPECTED_LIQUIDATION_FEE),
          ) // no shortfall
          expect((await btcMarket.pendingOrders(vault.address, 2)).protection).to.equal(1)

          // 3. Settle the liquidation.
          // We should now be able to deposit.
          await updateOracle()
          await btcMarket.settle(vault.address)
          await vault.connect(other).update(other.address, 2, 0, 0)

          await updateOracle()
          await vault.connect(other).update(other.address, 0, 2, 0) // rebalance

          const finalPosition = BigNumber.from('109403638')
          const finalCollateral = BigNumber.from('72979255799')
          const btcFinalPosition = BigNumber.from('1105581')
          const btcFinalCollateral = BigNumber.from('16606131382')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update increases the price, making the vault's position liquidatable.
          await updateOracle(undefined, parse6decimal('80000'))

          // 2. Settle accounts / Liquidate the vault's maker position.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('8239276000')
          await btcMarket.connect(user).close(vault.address, true, constants.AddressZero)
          expect(await margin.isolatedBalances(vault.address, btcMarket.address)).to.equal(
            BigNumber.from('-26673235277').add(EXPECTED_LIQUIDATION_FEE),
          ) // shortfall
          expect((await btcMarket.pendingOrders(vault.address, 2)).protection).to.equal(1)

          // 3. Settle the liquidation.
          // We should now be able to deposit.
          await updateOracle()
          await btcMarket.settle(vault.address)
          await vault.connect(other).update(other.address, 2, 0, 0)

          await updateOracle()
          await vault.connect(other).update(other.address, 0, 2, 0) // rebalance

          const finalPosition = BigNumber.from('75194011')
          const finalCollateral = BigNumber.from('50928469809')
          const btcFinalPosition = BigNumber.from('354848')
          const btcFinalCollateral = BigNumber.from('10645247477')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })

      context('long exposure', () => {
        // Takers zero out their long positions and go short, such that vaults will have long exposure.
        beforeEach(async () => {
          await updateOracle()

          await market.connect(user2).close(user2.address, false, constants.AddressZero)
          await btcMarket.connect(btcUser2).close(btcUser2.address, false, constants.AddressZero)
          await updateOracle()

          // get utilization closer to target in order to trigger pnl on price deviation
          const deposit = parse6decimal('100000')
          await margin.connect(user2).deposit(user2.address, deposit)
          await market
            .connect(user2)
            ['update(address,int256,int256,int256,address)'](
              user2.address,
              0,
              parse6decimal('100').mul(-1),
              deposit,
              constants.AddressZero,
            )
          await margin.connect(btcUser2).deposit(btcUser2.address, deposit)
          await btcMarket
            .connect(btcUser2)
            ['update(address,int256,int256,int256,address)'](
              btcUser2.address,
              0,
              parse6decimal('10').mul(-1),
              deposit,
              constants.AddressZero,
            )
          await updateOracle()
          await vault.rebalance(user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update decreases the price, making the vault's position liquidatable.
          await updateOracle(undefined, parse6decimal('20000'))

          // 2. Settle accounts / Liquidate the vault's maker position.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('2059819000')
          await btcMarket.connect(user).close(vault.address, true, constants.AddressZero)
          expect(await margin.isolatedBalances(vault.address, btcMarket.address)).to.equal(
            BigNumber.from('350411418').add(EXPECTED_LIQUIDATION_FEE),
          ) // no shortfall
          expect((await btcMarket.pendingOrders(vault.address, 3)).protection).to.equal(1)

          // 3. Settle the liquidation.
          // We should now be able to deposit.
          await updateOracle()
          await btcMarket.settle(vault.address)
          await vault.connect(other).update(other.address, 2, 0, 0)

          await updateOracle()
          await vault.connect(other).update(other.address, 0, 2, 0) // rebalance

          const finalPosition = BigNumber.from('100648781')
          const finalCollateral = BigNumber.from('67336064576')
          const btcFinalPosition = BigNumber.from('2419855')
          const btcFinalCollateral = BigNumber.from('15080633668')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update decreases the price, making the vault's position liquidatable.
          await updateOracle(undefined, parse6decimal('19000'))

          // 2. Settle accounts / Liquidate the vault's maker position.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('1956828050')
          await btcMarket.connect(user).close(vault.address, true, constants.AddressZero)
          expect(await margin.isolatedBalances(vault.address, btcMarket.address)).to.equal(
            BigNumber.from('-480340107').add(EXPECTED_LIQUIDATION_FEE),
          ) // shortfall
          expect((await btcMarket.pendingOrders(vault.address, 3)).protection).to.equal(1)

          // 3. Settle the liquidation.
          // We should now be able to deposit.
          await updateOracle()
          await btcMarket.settle(vault.address)
          await vault.connect(other).update(other.address, 2, 0, 0)

          await updateOracle()
          await vault.connect(other).update(other.address, 0, 2, 0) // rebalance

          const finalPosition = BigNumber.from('99508411')
          const finalCollateral = BigNumber.from('66601006958')
          const btcFinalPosition = BigNumber.from('2500036')
          const btcFinalCollateral = BigNumber.from('14881928666')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })
    })

    context('insolvency', () => {
      it('gracefully unwinds upon totalClaimable insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
        await updateOracle()
        await vault.rebalance(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).update(user.address, 0, parse6decimal('80000'), 0)
        await updateOracle()
        await vault.rebalance(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('10000'))
        await market.connect(user).close(vault.address, true, constants.AddressZero)
        await settle(market, user2)
        await market.connect(user2).close(user2.address, false, constants.AddressZero)

        // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        await vault.connect(user).update(user.address, 0, 2, 0) // rebalance

        await updateOracle()
        await vault.rebalance(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('15751024242')
        const btcFinalPosition = BigNumber.from('0')
        const btcFinalCollateral = BigNumber.from('3937756060')
        const finalUnclaimed = BigNumber.from('80001128624')
        const vaultFinalCollateral = await asset.balanceOf(vault.address)
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect((await vault.accounts(user.address)).assets).to.equal(finalUnclaimed)
        expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(finalUnclaimed)

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)

        expect(await collateralInVault()).to.equal(0)
        expect(await btcCollateralInVault()).to.equal(0)
        expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('20000').sub(2)) // rebalance redeemed 2 shares
        expect((await vault.accounts(user.address)).assets).to.equal(0)
        expect((await vault.accounts(constants.AddressZero)).shares).to.equal(parse6decimal('20000').sub(2))
        expect((await vault.accounts(constants.AddressZero)).assets).to.equal(0)
        expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(
          initialBalanceOf.add(finalCollateral.add(btcFinalCollateral).mul(1e12)).add(vaultFinalCollateral),
        )

        // 7. Should no longer be able to deposit, vault is closed
        await updateOracle()
        await expect(vault.connect(user).update(user.address, 2, 0, 0)).to.revertedWithCustomError(
          vault,
          'VaultDepositLimitExceededError',
        )
      })

      it('gracefully unwinds upon total insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
        await updateOracle()

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).update(user.address, 0, parse6decimal('80000'), 0)
        await updateOracle()

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('20000'))
        await market.connect(user).close(vault.address, true, constants.AddressZero)
        await updateOracle()
        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('-109143672868')
        const btcFinalPosition = BigNumber.from('411963') // small position because vault is net negative and won't rebalance
        const btcFinalCollateral = BigNumber.from('20000833313')
        const finalUnclaimed = BigNumber.from('80001128624')
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect((await vault.accounts(user.address)).assets).to.equal(finalUnclaimed)
        expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(finalUnclaimed)

        // 6. Claim should be pro-rated
        await updateOracle()
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
        expect((await vault.accounts(user.address)).assets).to.equal(0)
        expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(initialBalanceOf)
      })
    })

    context('deleverage market', () => {
      beforeEach(async () => {
        // Seed vault with deposits
        const deposit0 = parse6decimal('1000')
        await vault.connect(user).update(user.address, deposit0, 0, 0)
        await updateOracle()
        await vault.rebalance(user.address)

        const deposit1 = parse6decimal('10000')
        await vault.connect(user2).update(user2.address, deposit1, 0, 0)
        await updateOracle()
        await vault.rebalance(user2.address)
      })

      it('handles setting leverage to 0', async () => {
        expect(await position()).to.be.equal(
          parse6decimal('11000').mul(leverage).mul(4).div(5).div(originalOraclePrice),
        )
        expect(await btcPosition()).to.be.equal(parse6decimal('11000').mul(leverage).div(5).div(btcOriginalOraclePrice))

        // Deleverage the ETH market
        await vault.connect(coordinator).updateLeverage(0, 0)

        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance
        await updateOracle()

        const currentPosition = await currentPositionLocal(market)
        expect(currentPosition.maker).to.equal(0)

        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance
        await updateOracle()

        expect(await position()).to.be.equal(0)
      })
    })

    context('close market', () => {
      beforeEach(async () => {
        // Seed vault with deposits
        const deposit0 = parse6decimal('1000')
        await vault.connect(user).update(user.address, deposit0, 0, 0)
        await updateOracle()
        await vault.rebalance(user.address)

        const deposit1 = parse6decimal('10000')
        await vault.connect(user2).update(user2.address, deposit1, 0, 0)
        await updateOracle()
        await vault.rebalance(user2.address)
      })

      it('handles setting weight to 0', async () => {
        expect(await position()).to.be.equal(
          parse6decimal('11000').mul(leverage).mul(4).div(5).div(originalOraclePrice),
        )
        expect(await btcPosition()).to.be.equal(parse6decimal('11000').mul(leverage).div(5).div(btcOriginalOraclePrice))

        // Close the ETH market
        await vault.connect(coordinator).updateWeights([0, parse6decimal('1')])

        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance
        await updateOracle()

        const currentPosition = await currentPositionLocal(market)
        expect(currentPosition.maker).to.equal(0)

        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance
        await updateOracle()

        expect(await position()).to.be.equal(0)
      })
    })

    context('add market', () => {
      beforeEach(async () => {
        // set ETH market to 0
        await vault.connect(coordinator).updateLeverage(0, 0)
        await vault.connect(coordinator).updateWeights([0, parse6decimal('1')])

        // Seed vault with deposits
        const deposit0 = parse6decimal('1000')
        await vault.connect(user).update(user.address, deposit0, 0, 0)
        await updateOracle()
        await vault.rebalance(user.address)

        const deposit1 = parse6decimal('10000')
        await vault.connect(user2).update(user2.address, deposit1, 0, 0)
        await updateOracle()
        await vault.rebalance(user2.address)
      })

      it('handles re-setting weight to non-0', async () => {
        expect(await position()).to.be.equal(0)
        expect(await btcPosition()).to.be.equal(parse6decimal('11000').mul(leverage).div(btcOriginalOraclePrice))

        // Open the ETH market
        await vault.connect(coordinator).updateLeverage(0, leverage)
        await vault.connect(coordinator).updateWeights([parse6decimal('0.9'), parse6decimal('0.1')])

        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance
        await updateOracle()

        const currentPosition = await currentPositionLocal(market)
        expect(currentPosition.maker).to.be.greaterThan(0)

        await vault.connect(user).update(user.address, 0, 1, 0) // redeem 1 share to trigger rebalance
        await updateOracle()

        expect(await position()).to.be.greaterThan(0)
      })
    })
  })
})
