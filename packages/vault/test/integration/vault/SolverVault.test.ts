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
  SolverVault__factory,
  IOracleProvider,
  VaultFactory__factory,
  IVaultFactory,
  ISolverVault__factory,
  ISolverVault,
  IVaultFactory__factory,
  IOracleFactory,
  IMarketFactory,
} from '../../../types/generated'
import { BigNumber, constants } from 'ethers'
import { deployProtocol, fundWallet, settle } from '@perennial/v2-core/test/integration/helpers/setupHelpers'
import { OracleReceipt, DEFAULT_ORACLE_RECEIPT, parse6decimal } from '../../../../common/testutil/types'
import {
  IMarketFactory__factory,
  IVerifier__factory,
  MarketFactory,
  ProxyAdmin,
  TransparentUpgradeableProxy__factory,
} from '@perennial/v2-core/types/generated'
import { IOracle, IOracle__factory, OracleFactory } from '@perennial/v2-oracle/types/generated'
import { IntentStruct } from '@perennial/v2-core/types/generated/contracts/Market'
import { signIntent } from '@perennial/v2-core/test/helpers/erc712'

const { ethers } = HRE
use(smock.matchers)

const STARTING_TIMESTAMP = BigNumber.from(1646456563)
const LEGACY_ORACLE_DELAY = 3600
const ETH_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000001'
const BTC_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000002'

describe('SolverVault', () => {
  let vault: ISolverVault
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
  let coordinator: SignerWithAddress
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber
  let oracle: FakeContract<IOracleProvider>
  let market: IMarket
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcMarket: IMarket

  async function updateOracle(
    newPrice?: BigNumber,
    newPriceBtc?: BigNumber,
    newReceipt?: OracleReceipt,
    newReceiptBtc?: OracleReceipt,
  ) {
    await _updateOracle(oracle, newPrice, newReceipt)
    await _updateOracle(btcOracle, newPriceBtc, newReceiptBtc)
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
    const pos = await market.positions(vault.address)
    return pos.long.sub(pos.short)
  }

  async function btcPosition() {
    const pos = await btcMarket.positions(vault.address)
    return pos.long.sub(pos.short)
  }

  async function collateralInVault() {
    return (await market.locals(vault.address)).collateral
  }

  async function btcCollateralInVault() {
    return (await btcMarket.locals(vault.address)).collateral
  }

  async function totalCollateralInVault() {
    return (await collateralInVault())
      .add(await btcCollateralInVault())
      .mul(1e12)
      .add(await asset.balanceOf(vault.address))
  }

  async function currentPositionLocal(market: IMarket, vault: ISolverVault) {
    const currentPosition = { ...(await market.positions(vault.address)) }
    const pending = await market.pendings(vault.address)

    currentPosition.maker = currentPosition.maker.add(pending.makerPos).sub(pending.makerNeg)
    currentPosition.long = currentPosition.long.add(pending.longPos).sub(pending.longNeg)
    currentPosition.short = currentPosition.short.add(pending.shortPos).sub(pending.shortNeg)

    return currentPosition
  }

  async function placeIntentOrder(
    vault: ISolverVault,
    taker: SignerWithAddress,
    maker: SignerWithAddress,
    market: IMarket,
    amount: BigNumber,
    price: BigNumber,
    nonce: number,
  ) {
    const intent: IntentStruct = {
      amount,
      price,
      fee: parse6decimal('0.5'),
      originator: constants.AddressZero,
      solver: constants.AddressZero,
      collateralization: 0,
      common: {
        account: taker.address,
        signer: taker.address,
        domain: market.address,
        nonce,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    const marketFactory = IMarketFactory__factory.connect(await market.factory(), owner)
    const verifier = IVerifier__factory.connect(await marketFactory.verifier(), owner)

    const signature = await signIntent(taker, verifier, intent)

    await market
      .connect(maker)
      [
        'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
      ](vault.address, intent, signature)
  }

  const fixture = async () => {
    const instanceVars = await deployProtocol()

    let pauser
    ;[owner, pauser, user, user2, btcUser1, btcUser2, liquidator, perennialUser, other, coordinator] =
      await ethers.getSigners()
    factory = instanceVars.marketFactory
    oracleFactory = instanceVars.oracleFactory

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
      token: instanceVars.dsu,
      owner: owner,
      oracle: rootOracle.address,
      makerLimit: parse6decimal('1000'),
      minMargin: parse6decimal('50'),
      minMaintenance: parse6decimal('50'),
      takerFee: {
        linearFee: 0,
        proportionalFee: 0,
        adiabaticFee: 0,
        scale: parse6decimal('100'),
      },
      makerFee: {
        linearFee: 0,
        proportionalFee: 0,
        scale: parse6decimal('100'),
      },
    })
    btcMarket = await deployProductOnFork({
      factory: instanceVars.marketFactory,
      token: instanceVars.dsu,
      owner: owner,
      oracle: btcRootOracle.address,
      minMargin: parse6decimal('50'),
      minMaintenance: parse6decimal('50'),
      takerFee: {
        linearFee: 0,
        proportionalFee: 0,
        adiabaticFee: 0,
        scale: parse6decimal('10'),
      },
      makerFee: {
        linearFee: 0,
        proportionalFee: 0,
        scale: parse6decimal('10'),
      },
    })

    await rootOracle.register(market.address)
    await btcRootOracle.register(btcMarket.address)

    const vaultImpl = await new SolverVault__factory(owner).deploy()
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
    vault = ISolverVault__factory.connect(
      await vaultFactory.callStatic.create(instanceVars.dsu.address, market.address, 'Blue Chip'),
      owner,
    )
    await vaultFactory.create(instanceVars.dsu.address, market.address, 'Blue Chip')
    await vault.register(btcMarket.address)
    await vault.updateLeverage(0, leverage)
    await vault.updateLeverage(1, leverage)
    await vault.updateWeights([0.8e6, 0.2e6])
    await vault.updateParameter({
      maxDeposit: maxCollateral,
      minDeposit: 0,
      profitShare: 0,
    })
    await vault.updateCoordinator(coordinator.address)

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
      asset.connect(user).approve(market.address, ethers.constants.MaxUint256),
      asset.connect(user2).approve(market.address, ethers.constants.MaxUint256),
      asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256),
      asset.connect(other).approve(market.address, ethers.constants.MaxUint256),
      asset.connect(other).approve(btcMarket.address, ethers.constants.MaxUint256),
    ])

    // Seed markets with some activity
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        user.address,
        parse6decimal('200'),
        0,
        0,
        parse6decimal('100000'),
        false,
      )
    await market
      .connect(user2)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        user2.address,
        0,
        parse6decimal('100'),
        0,
        parse6decimal('100000'),
        false,
      )
    await btcMarket
      .connect(btcUser1)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        btcUser1.address,
        parse6decimal('20'),
        0,
        0,
        parse6decimal('100000'),
        false,
      )
    await btcMarket
      .connect(btcUser2)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        btcUser2.address,
        0,
        parse6decimal('10'),
        0,
        parse6decimal('100000'),
        false,
      )

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

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(vault.initialize(asset.address, market.address, parse6decimal('5'), 'Blue Chip'))
        .to.revertedWithCustomError(vault, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Perennial Solver Vault: Blue Chip')
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
        token: asset,
        owner: owner,
        oracle: rootOracle3.address,
        makerLimit: parse6decimal('1000000'),
        takerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100000'),
        },
        makerFee: {
          linearFee: 0,
          proportionalFee: 0,
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
      const realVersion4 = {
        timestamp: STARTING_TIMESTAMP,
        price: BigNumber.from('13720000'),
        valid: true,
      }

      const oracle4 = await smock.fake<IOracleProvider>('IOracleProvider')
      oracle4.request.returns([realVersion4, realVersion4.timestamp.add(LEGACY_ORACLE_DELAY)])
      oracle4.latest.returns(realVersion4)
      oracle4.at.whenCalledWith(realVersion4.timestamp).returns([realVersion4, DEFAULT_ORACLE_RECEIPT])

      const LINK0_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000004'
      vaultOracleFactory.instances.whenCalledWith(oracle4.address).returns(true)
      vaultOracleFactory.oracles.whenCalledWith(LINK0_PRICE_FEE_ID).returns(oracle4.address)

      const rootOracle4 = IOracle__factory.connect(
        await oracleFactory
          .connect(owner)
          .callStatic.create(LINK0_PRICE_FEE_ID, vaultOracleFactory.address, 'LINK0-USD'),
        owner,
      )
      await oracleFactory.connect(owner).create(LINK0_PRICE_FEE_ID, vaultOracleFactory.address, 'LINK0-USD')

      const marketBadAsset = await deployProductOnFork({
        factory: factory,
        token: IERC20Metadata__factory.connect(constants.AddressZero, owner),
        owner: owner,
        oracle: rootOracle4.address,
        makerLimit: parse6decimal('1000000'),
        takerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100000'),
        },
        makerFee: {
          linearFee: 0,
          proportionalFee: 0,
          scale: parse6decimal('100000'),
        },
      })

      await expect(vault.connect(owner).register(marketBadAsset.address)).to.be.revertedWithCustomError(
        vault,
        'VaultIncorrectAssetError',
      )
    })
  })

  describe('#updateParameter', () => {
    it('updates correctly', async () => {
      const newParameter = {
        maxDeposit: parse6decimal('1000000'),
        minDeposit: parse6decimal('10'),
        profitShare: parse6decimal('0.1'),
      }
      await expect(vault.connect(owner).updateParameter(newParameter))
        .to.emit(vault, 'ParameterUpdated')
        .withArgs(newParameter)

      const parameter = await vault.parameter()
      expect(parameter.maxDeposit).to.deep.contain(newParameter.maxDeposit)
      expect(parameter.minDeposit).to.deep.contain(newParameter.minDeposit)
      expect(parameter.profitShare).to.deep.contain(newParameter.profitShare)
    })

    it('reverts when not owner', async () => {
      const newParameter = {
        maxDeposit: parse6decimal('1000000'),
        minDeposit: parse6decimal('10'),
        profitShare: parse6decimal('0.1'),
      }
      await expect(vault.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#updateLeverage', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(owner).updateLeverage(1, parse6decimal('3')))
        .to.emit(vault, 'MarketUpdated')
        .withArgs(1, 0.2e6, parse6decimal('3'))

      expect((await vault.registrations(1)).weight).to.eq(0.2e6)
      expect((await vault.registrations(1)).leverage).to.eq(parse6decimal('3'))

      await expect(vault.connect(owner).updateLeverage(1, 0)).to.emit(vault, 'MarketUpdated').withArgs(1, 0.2e6, 0)

      expect((await vault.registrations(1)).weight).to.eq(0.2e6)
      expect((await vault.registrations(1)).leverage).to.eq(0)
    })

    it('reverts when invalid marketId', async () => {
      await expect(vault.connect(owner).updateLeverage(2, parse6decimal('1'))).to.be.revertedWithCustomError(
        vault,
        'VaultMarketDoesNotExistError',
      )
    })

    it('reverts when not owner', async () => {
      await expect(vault.connect(user).updateLeverage(2, parse6decimal('1'))).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#updateWeights', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(owner).updateWeights([parse6decimal('0.4'), parse6decimal('0.6')]))
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
      await expect(vault.connect(owner).updateWeights([parse6decimal('1.0')])).to.be.revertedWithCustomError(
        vault,
        'VaultMarketDoesNotExistError',
      )
    })

    it('reverts when too many', async () => {
      await expect(
        vault.connect(owner).updateWeights([parse6decimal('0.2'), parse6decimal('0.2'), parse6decimal('0.6')]),
      ).to.be.revertedWithCustomError(vault, 'VaultMarketDoesNotExistError')
    })

    it('reverts when invalid aggregate', async () => {
      await expect(
        vault.connect(owner).updateWeights([parse6decimal('0.5'), parse6decimal('0.4')]),
      ).to.be.revertedWithCustomError(vault, 'VaultAggregateWeightError')
    })

    it('reverts when not owner', async () => {
      await expect(
        vault.connect(user).updateWeights([parse6decimal('0.4'), parse6decimal('0.6')]),
      ).to.be.revertedWithCustomError(vault, 'InstanceNotOwnerError')
    })
  })

  describe('#settle', () => {
    it('simple deposits and redemptions', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))

      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.settle(user.address)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await updateOracle()
      await vault.settle(user.address)

      const VAULT_PNL = parse6decimal('200')

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

      expect(await position()).to.equal(parse6decimal('10'))
      expect(await btcPosition()).to.equal(parse6decimal('1'))

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault.settle(user.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('-2097504')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('10010').add(VAULT_PNL).add(fundingAmount).mul(1e12),
      )
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(
        parse6decimal('10010').add(VAULT_PNL).add(fundingAmount),
      )
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('10010').add(VAULT_PNL).add(fundingAmount),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(VAULT_PNL).add(fundingAmount).mul(1e12),
      )
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
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))
      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault['rebalance(address)'](user.address)
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

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await expect(vault.connect(user).update(user.address, 0, 1, 0)) // trigger rebalance w/ capped closable
        .to.be.revertedWithCustomError(vault, 'SolverStrategyPendingTradeError')

      await updateOracle()
      await vault.settle(user.address)

      const VAULT_PNL = parse6decimal('200')

      // Now we should have opened positions.
      expect(await position()).to.equal(parse6decimal('10'))
      expect(await btcPosition()).to.equal(parse6decimal('1'))

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('-2097504')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('10010').add(VAULT_PNL).add(fundingAmount).mul(1e12),
      )
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect((await vault.accounts(user.address)).assets).to.equal(
        parse6decimal('10010').add(VAULT_PNL).add(fundingAmount),
      )
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(
        parse6decimal('10010').add(VAULT_PNL).add(fundingAmount),
      )

      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(VAULT_PNL).add(fundingAmount).mul(1e12),
      )
      expect((await vault.accounts(user.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)
    })

    it('multiple users w/ takerFee', async () => {
      await updateOracle()
      await vault.settle(constants.AddressZero)

      const marketParameter = { ...(await market.parameter()) }
      await market.updateParameter({
        ...marketParameter,
        takerFee: parse6decimal('0.001'),
      })
      const btcMarketParameter = { ...(await btcMarket.parameter()) }
      await btcMarket.updateParameter({
        ...btcMarketParameter,
        takerFee: parse6decimal('0.001'),
      })

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-1'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-0.1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        3,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        4,
      )

      await updateOracle()
      await vault['rebalance(address)'](user2.address)

      // Now we should have opened positions.
      expect(await position()).to.equal(parse6decimal('11'))
      expect(await btcPosition()).to.equal(parse6decimal('1.1'))

      const balanceOf2 = BigNumber.from('8197681703') // 2nd fill's profit hits prior to 2nd deposits settlement, ~20% profit
      const totalAssets = BigNumber.from('11219857072')

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
      await vault['rebalance(address)'](user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault['rebalance(address)'](user2.address)

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

      const unclaimed1 = BigNumber.from('1188061387')
      const unclaimed2 = BigNumber.from('9956260054')
      const finalTotalAssets = BigNumber.from('39999986') // last trade fee
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
      await vault['rebalance(address)'](user.address)
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('1000').add(0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.convertToAssets(parse6decimal('1000'))).to.equal(parse6decimal('1000').add(0))
      expect(await vault.convertToShares(parse6decimal('1000').add(0))).to.equal(parse6decimal('1000'))
    })

    it('multiple users w/ takerFee + settlement fee', async () => {
      await updateOracle()
      await vault.settle(constants.AddressZero)

      const marketParameter = { ...(await market.parameter()) }
      await market.updateParameter({
        ...marketParameter,
        takerFee: parse6decimal('0.001'),
      })
      const btcMarketParameter = { ...(await btcMarket.parameter()) }
      await btcMarket.updateParameter({
        ...btcMarketParameter,
        takerFee: parse6decimal('0.001'),
      })

      const oracleRecteipt = { ...DEFAULT_ORACLE_RECEIPT, settlementFee: parse6decimal('1.00') }
      await updateOracle(undefined, undefined, oracleRecteipt, oracleRecteipt)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-1'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-0.1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        3,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        4,
      )

      await updateOracle()
      await vault['rebalance(address)'](user2.address)

      // Now we should have opened positions.
      expect(await position()).to.equal(parse6decimal('11'))
      expect(await btcPosition()).to.equal(parse6decimal('1.1'))

      const balanceOf2 = BigNumber.from('8198130791') // 2nd fill's profit hits prior to 2nd deposits settlement, ~20% profit
      const totalAssets = BigNumber.from('11219790249')

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
      await vault['rebalance(address)'](user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault['rebalance(address)'](user2.address)

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

      const unclaimed1 = BigNumber.from('1185914704')
      const unclaimed2 = BigNumber.from('9953193909')
      const finalTotalAssets = BigNumber.from('42000026') // last trade fee + settlement fee
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
      await vault['rebalance(address)'](user.address)
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('1000').add(0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.convertToAssets(parse6decimal('1000'))).to.equal(parse6decimal('1000').add(0))
      expect(await vault.convertToShares(parse6decimal('1000').add(0))).to.equal(parse6decimal('1000'))
    })

    it('rounds deposits correctly', async () => {
      const oddDepositAmount = parse6decimal('10000').add(1) // 10K + 1 wei

      await vault.connect(user).update(user.address, oddDepositAmount, 0, 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)
      expect(await asset.balanceOf(vault.address)).to.equal(0) // deposits everything into markets
      expect((await collateralInVault()).add(await btcCollateralInVault())).to.equal(oddDepositAmount)

      await vault.connect(user).update(user.address, oddDepositAmount, 0, 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)
    })

    it('credits profit shares when account is coordinator', async () => {
      await fundWallet(asset, coordinator)
      asset.connect(coordinator).approve(vault.address, ethers.constants.MaxUint256),
        await vault.updateParameter({
          maxDeposit: maxCollateral,
          minDeposit: 0,
          profitShare: parse6decimal('0.3'),
        })
      await vault.updateCoordinator(coordinator.address)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const deposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, deposit.div(4), 0, 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)
      await vault['rebalance(address)'](coordinator.address)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('1'),
        originalOraclePrice.add(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('0.1'),
        btcOriginalOraclePrice.add(parse6decimal('100')),
        2,
      )
      await updateOracle()
      await vault['rebalance(address)'](user.address)
      await vault['rebalance(address)'](user2.address)

      // Confirm positions were opened
      expect(await position()).to.equal(parse6decimal('-1'))
      expect(await btcPosition()).to.equal(parse6decimal('-0.1'))

      await vault.connect(coordinator).update(coordinator.address, deposit.mul(3).div(4), 0, 0)
      await updateOracle()
      await vault['rebalance(address)'](coordinator.address)

      const shares1 = deposit.div(4)
      expect((await vault.accounts(user.address)).shares).to.equal(shares1)
      const shares2 = parse6decimal('7458.114680')
      const profitShares = BigNumber.from('5983616')
      expect((await vault.accounts(coordinator.address)).shares).to.equal(shares2.add(profitShares))
    })

    it('profit shares', async () => {
      await updateOracle()
      await vault.settle(constants.AddressZero)

      await vault.updateParameter({
        maxDeposit: maxCollateral,
        minDeposit: 0,
        profitShare: parse6decimal('0.5'),
      })
      await vault.updateCoordinator(coordinator.address)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-1'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-0.1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        3,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        4,
      )

      await updateOracle()
      await vault['rebalance(address)'](user2.address)

      // Now we should have opened positions.
      expect(await position()).to.equal(parse6decimal('11'))
      expect(await btcPosition()).to.equal(parse6decimal('1.1'))

      const fundingAmount0 = BigNumber.from('219857072') // includes fill profit
      const coordinatorProfit = BigNumber.from('99041093') // 219857072 / 2 worth of shares
      const balanceOf2 = BigNumber.from('9009589059')
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
      await vault['rebalance(address)'](user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault['rebalance(address)'](user2.address)

      await vault
        .connect(coordinator)
        .update(coordinator.address, 0, (await vault.accounts(coordinator.address)).shares, 0)
      await updateOracle()
      await vault['rebalance(address)'](coordinator.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const fundingAmount = BigNumber.from('219857072')
      const fundingAmountMinusProfit = BigNumber.from('109700290') // profit is less than half due to overcoming HWM
      const fundingAmount2 = BigNumber.from('-3740221')
      const fundingAmount2MinusProfit = BigNumber.from('-3740221') // profit is less than half due to overcoming HWM
      const fundingAmount3 = BigNumber.from('-291916')
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

    it('zero address settle w/ settlement fee', async () => {
      const riskParameters = { ...(await market.riskParameter()) }
      await market.updateRiskParameter({
        ...riskParameters,
        makerFee: {
          ...riskParameters.makerFee,
          linearFee: parse6decimal('0.001'),
        },
      })
      const btcRiskParameters = { ...(await btcMarket.riskParameter()) }
      await btcMarket.updateRiskParameter({
        ...btcRiskParameters,
        makerFee: {
          ...btcRiskParameters.makerFee,
          linearFee: parse6decimal('0.001'),
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
      await vault['rebalance(address)'](constants.AddressZero)
      await vault['rebalance(address)'](user.address)
      await vault['rebalance(address)'](user2.address)

      await vault.connect(user).update(user.address, 0, constants.MaxUint256, 0)
      await vault.connect(user2).update(user2.address, 0, constants.MaxUint256, 0)
      await updateOracle()
      await vault['rebalance(address)'](constants.AddressZero)
      await vault['rebalance(address)'](user.address)
      await vault['rebalance(address)'](user2.address)

      const totalAssets = BigNumber.from('11000000000')
      expect((await vault.accounts(constants.AddressZero)).assets).to.equal(totalAssets)
    })

    it('full auto close under min margin', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))
      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault['rebalance(address)'](user.address)
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

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await updateOracle()
      await vault.settle(user.address)

      const VAULT_PNL = parse6decimal('200')

      // Now we should have opened positions.
      expect(await position()).to.equal(parse6decimal('10'))
      expect(await btcPosition()).to.equal(parse6decimal('1'))

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10010'))
      await vault
        .connect(user)
        .update(user.address, 0, (await vault.accounts(user.address)).shares.sub(parse6decimal('10')), 0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      // We should have closed all positions.
      expect(await vault.totalAssets()).to.equal(parse6decimal('10.197705')) // non-zero

      expect(await position()).to.equal(0) // zero, under min margin
      expect(await btcPosition()).to.equal(0) // zero, under min margin
    })

    context('deleverage market', () => {
      beforeEach(async () => {
        await updateOracle()
        await vault.settle(constants.AddressZero)

        // Seed vault with deposits
        await vault.connect(user).update(user.address, parse6decimal('1000'), 0, 0)
        await vault.connect(user2).update(user2.address, parse6decimal('10000'), 0, 0)

        // Solver opens positions via signature
        await placeIntentOrder(
          vault,
          user2,
          coordinator,
          market,
          parse6decimal('-10'),
          originalOraclePrice.sub(parse6decimal('10')),
          3,
        )
        await placeIntentOrder(
          vault,
          btcUser2,
          coordinator,
          btcMarket,
          parse6decimal('-1'),
          btcOriginalOraclePrice.sub(parse6decimal('100')),
          4,
        )

        await updateOracle()
        await vault.settle(constants.AddressZero)
      })

      it('handles setting leverage to 0', async () => {
        expect(await position()).to.be.equal(parse6decimal('10'))
        expect(await btcPosition()).to.be.equal(parse6decimal('1'))

        await updateOracle()
        await vault.connect(user).update(user.address, 0, 1, 0) // trigger rebalance

        // Deleverage the ETH market partially based on leverage limit
        const currentPosition1 = await currentPositionLocal(market, vault)
        const collateral = BigNumber.from('5599424190')
        expect(currentPosition1.long).to.equal(collateral.mul(4).mul(1e6).div(originalOraclePrice))
        expect(currentPosition1.short).to.equal(0)

        await vault.updateLeverage(0, 0)

        await updateOracle()
        await vault.connect(user).update(user.address, 0, 1, 0) // trigger rebalance

        // Deleverage the ETH market fully based on new leveage limit
        const currentPosition2 = await currentPositionLocal(market, vault)
        expect(currentPosition2.long).to.equal(0)
        expect(currentPosition2.short).to.equal(0)

        await updateOracle()
        await vault.settle(constants.AddressZero)

        expect(await position()).to.be.equal(0)
      })
    })
  })

  describe('#rebalance (coordinator)', () => {
    it('simple rebalance', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))

      await vault
        .connect(coordinator)
        ['rebalance(address,address,uint256)'](market.address, btcMarket.address, parse6decimal('1000'))

      expect(await collateralInVault()).to.equal(parse6decimal('4005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('6005'))
    })

    it('rebalance with position open', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))

      expect((await vault.accounts(user.address)).shares).to.equal(smallDeposit)
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.settle(user.address)

      // Solver opens positions via signature
      await placeIntentOrder(
        vault,
        user2,
        coordinator,
        market,
        parse6decimal('-10'),
        originalOraclePrice.sub(parse6decimal('10')),
        1,
      )
      await placeIntentOrder(
        vault,
        btcUser2,
        coordinator,
        btcMarket,
        parse6decimal('-1'),
        btcOriginalOraclePrice.sub(parse6decimal('100')),
        2,
      )

      await updateOracle()
      await vault.settle(user.address)

      await vault
        .connect(coordinator)
        ['rebalance(address,address,uint256)'](market.address, btcMarket.address, parse6decimal('1000'))

      expect(await collateralInVault()).to.equal(parse6decimal('4105'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('6105'))
    })

    it('reverts if not coordinator', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))

      await expect(
        vault
          .connect(user)
          ['rebalance(address,address,uint256)'](market.address, btcMarket.address, parse6decimal('1000')),
      ).to.be.revertedWithCustomError(vault, 'SolverVaultNotCoordinatorError')
    })

    it('reverts if not registered', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault['rebalance(address)'](user.address)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))

      await expect(
        vault
          .connect(coordinator)
          ['rebalance(address,address,uint256)'](market.address, coordinator.address, parse6decimal('1000')),
      ).to.be.revertedWithCustomError(vault, 'SolverVaultNotRegisteredError')
    })

    it('add market after initial deposit', async () => {
      const realVersion3 = {
        timestamp: STARTING_TIMESTAMP,
        price: BigNumber.from('13720000'),
        valid: true,
      }

      const oracle3 = await smock.fake<IOracleProvider>('IOracleProvider')
      oracle3.status.returns([realVersion3, realVersion3.timestamp.add(LEGACY_ORACLE_DELAY)])
      oracle3.request.whenCalledWith(user.address).returns()
      oracle3.latest.returns(realVersion3)
      oracle3.current.returns(realVersion3.timestamp.add(LEGACY_ORACLE_DELAY))
      oracle3.at.whenCalledWith(realVersion3.timestamp).returns([realVersion3, DEFAULT_ORACLE_RECEIPT])

      const LINK_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000003'
      vaultOracleFactory.instances.whenCalledWith(oracle3.address).returns(true)
      vaultOracleFactory.oracles.whenCalledWith(LINK_PRICE_FEE_ID).returns(oracle3.address)

      const rootOracle3 = IOracle__factory.connect(
        await oracleFactory.connect(owner).callStatic.create(LINK_PRICE_FEE_ID, vaultOracleFactory.address, 'LINK-USD'),
        owner,
      )
      await oracleFactory.connect(owner).create(LINK_PRICE_FEE_ID, vaultOracleFactory.address, 'LINK-USD')

      const market3 = await deployProductOnFork({
        factory: factory,
        token: asset,
        owner: owner,
        oracle: rootOracle3.address,
        makerLimit: parse6decimal('1000000'),
        takerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100000'),
        },
        makerFee: {
          linearFee: 0,
          proportionalFee: 0,
          scale: parse6decimal('100000'),
        },
      })

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await _updateOracle(oracle3)
      await vault['rebalance(address)'](user.address)

      // add third market
      await vault.register(market3.address)
      expect((await market.locals(market3.address)).collateral).to.equal(0)

      await updateOracle()
      await _updateOracle(oracle3)

      const checkpoint1 = await vault.checkpoints(1)
      expect(checkpoint1.deposit).to.equal(smallDeposit)
      expect(checkpoint1.deposits).to.equal(1)
      expect(checkpoint1.timestamp).to.equal((await market.pendingOrders(vault.address, 1)).timestamp)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      expect(await collateralInVault()).to.equal(parse6decimal('5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))
      expect((await market.locals(market3.address)).collateral).to.equal(0) // keeps pro-rata

      await vault
        .connect(coordinator)
        ['rebalance(address,address,uint256)'](market.address, market3.address, parse6decimal('1000'))

      expect(await collateralInVault()).to.equal(parse6decimal('4005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('5005'))
      expect((await market3.locals(vault.address)).collateral).to.equal(parse6decimal('1000'))

      await updateOracle()
      await _updateOracle(oracle3)

      // redeem partial
      await vault.connect(user).update(user.address, 0, largeDeposit.div(2), 0)
      await updateOracle()
      await _updateOracle(oracle3)
      await vault.connect(user).update(user.address, 0, 0, constants.MaxUint256)

      expect(await collateralInVault()).to.equal(parse6decimal('2004.5005'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2505'))
      expect((await market3.locals(vault.address)).collateral).to.equal(parse6decimal('500.4995'))
    })
  })
})
