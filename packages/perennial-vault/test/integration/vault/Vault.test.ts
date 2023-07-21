import HRE from 'hardhat'
import { impersonate } from '../../../../common/testutil'
import { deployProductOnMainnetFork } from '../helpers/setupHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarket,
  Vault__factory,
  IOracleProvider,
  VaultFactory__factory,
  IVaultFactory,
  IVault__factory,
  IVault,
  IVaultFactory__factory,
  IOracleFactory,
  IMarketFactory,
} from '../../../types/generated'
import { BigNumber, constants } from 'ethers'
import { deployProtocol, fundWallet, settle } from '@equilibria/perennial-v2/test/integration/helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { TransparentUpgradeableProxy__factory } from '@equilibria/perennial-v2/types/generated'
import { IOracle, IOracle__factory, OracleFactory } from '@equilibria/perennial-v2-oracle/types/generated'

const { ethers } = HRE
use(smock.matchers)

const STARTING_TIMESTAMP = BigNumber.from(1646456563)
const LEGACY_ORACLE_DELAY = 3600
const ETH_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000001'
const BTC_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000002'

describe('Vault', () => {
  let vault: IVault
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
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber
  let oracle: FakeContract<IOracleProvider>
  let market: IMarket
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcMarket: IMarket
  let vaultSigner: SignerWithAddress

  async function updateOracle(newPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await _updateOracleEth(newPrice)
    await _updateOracleBtc(newPriceBtc)
  }

  async function settleUnderlying(account: SignerWithAddress) {
    await settle(market, account)
    await settle(btcMarket, account)
  }

  async function _updateOracleEth(newPrice?: BigNumber) {
    const [currentTimestamp, currentPrice] = await oracle.latest()
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    oracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    oracle.request.returns()
    oracle.latest.returns(newVersion)
    oracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracle.at.whenCalledWith(newVersion.timestamp).returns(newVersion)
  }

  async function _updateOracleBtc(newPrice?: BigNumber) {
    const [currentTimestamp, currentPrice] = await btcOracle.latest()
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    btcOracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcOracle.request.returns()
    btcOracle.latest.returns(newVersion)
    btcOracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcOracle.at.whenCalledWith(newVersion.timestamp).returns(newVersion)
  }

  async function position() {
    return (await market.positions(vault.address)).maker
  }

  async function btcPosition() {
    return (await btcMarket.positions(vault.address)).maker
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

  const fixture = async () => {
    const instanceVars = await deployProtocol()

    let pauser
    ;[owner, pauser, user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()
    factory = instanceVars.marketFactory
    oracleFactory = instanceVars.oracleFactory

    vaultOracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    await oracleFactory.connect(owner).register(vaultOracleFactory.address)
    await oracleFactory.connect(owner).authorize(factory.address)

    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    const realVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('2620237388'),
      valid: true,
    }
    originalOraclePrice = realVersion.price

    oracle.status.returns([realVersion, realVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    oracle.request.returns()
    oracle.latest.returns(realVersion)
    oracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracle.at.whenCalledWith(realVersion.timestamp).returns(realVersion)

    btcOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    const btcRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('38838362695'),
      valid: true,
    }
    btcOriginalOraclePrice = btcRealVersion.price

    btcOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcOracle.request.returns()
    btcOracle.latest.returns(btcRealVersion)
    btcOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcOracle.at.whenCalledWith(btcRealVersion.timestamp).returns(btcRealVersion)

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
      await instanceVars.oracleFactory.connect(owner).callStatic.create(ETH_PRICE_FEE_ID, vaultOracleFactory.address),
      owner,
    )
    await instanceVars.oracleFactory.connect(owner).create(ETH_PRICE_FEE_ID, vaultOracleFactory.address)

    leverage = parse6decimal('4.0')
    maxCollateral = parse6decimal('500000')

    const btcRootOracle = IOracle__factory.connect(
      await instanceVars.oracleFactory.connect(owner).callStatic.create(BTC_PRICE_FEE_ID, vaultOracleFactory.address),
      owner,
    )
    await instanceVars.oracleFactory.connect(owner).create(BTC_PRICE_FEE_ID, vaultOracleFactory.address)

    market = await deployProductOnMainnetFork({
      factory: instanceVars.marketFactory,
      token: instanceVars.dsu,
      owner: owner,
      oracle: rootOracle.address,
      payoff: constants.AddressZero,
      makerLimit: parse6decimal('1000'),
      minMaintenance: parse6decimal('50'),
      maxLiquidationFee: parse6decimal('25000'),
    })
    btcMarket = await deployProductOnMainnetFork({
      factory: instanceVars.marketFactory,
      token: instanceVars.dsu,
      owner: owner,
      oracle: btcRootOracle.address,
      payoff: constants.AddressZero,
      minMaintenance: parse6decimal('50'),
      maxLiquidationFee: parse6decimal('25000'),
    })

    const vaultImpl = await new Vault__factory(owner).deploy()
    const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
      instanceVars.marketFactory.address,
      vaultImpl.address,
    )
    await instanceVars.proxyAdmin.upgrade(vaultFactoryProxy.address, vaultFactoryImpl.address)
    vaultFactory = IVaultFactory__factory.connect(vaultFactoryProxy.address, owner)
    await vaultFactory.initialize()

    vault = IVault__factory.connect(
      await vaultFactory.callStatic.create(instanceVars.dsu.address, market.address, 'Blue Chip'),
      owner,
    )
    await vaultFactory.create(instanceVars.dsu.address, market.address, 'Blue Chip')

    await vault.register(btcMarket.address)
    await vault.updateMarket(0, 4, leverage)
    await vault.updateMarket(1, 1, leverage)
    await vault.updateParameter({
      cap: maxCollateral,
    })

    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)
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
      asset.connect(user).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(user2).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(btcUser1).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256),
      asset.connect(user).approve(market.address, ethers.constants.MaxUint256),
      asset.connect(user2).approve(market.address, ethers.constants.MaxUint256),
      asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256),
    ])

    // Seed markets with some activity
    await market.connect(user).update(user.address, parse6decimal('200'), 0, 0, parse6decimal('100000'), false)
    await market.connect(user2).update(user2.address, 0, parse6decimal('100'), 0, parse6decimal('100000'), false)
    await btcMarket
      .connect(btcUser1)
      .update(btcUser1.address, parse6decimal('20'), 0, 0, parse6decimal('100000'), false)
    await btcMarket
      .connect(btcUser2)
      .update(btcUser2.address, 0, parse6decimal('10'), 0, parse6decimal('100000'), false)

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
    oracle.request.returns()
    oracle.latest.returns(realVersion)
    oracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracle.at.whenCalledWith(realVersion.timestamp).returns(realVersion)

    const btcRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('38838362695'),
      valid: true,
    }
    btcOriginalOraclePrice = btcRealVersion.price

    btcOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcOracle.request.returns()
    btcOracle.latest.returns(btcRealVersion)
    btcOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcOracle.at.whenCalledWith(btcRealVersion.timestamp).returns(btcRealVersion)

    vaultOracleFactory.instances.whenCalledWith(oracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(oracle.address)
    vaultOracleFactory.instances.whenCalledWith(btcOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcOracle.address)
  })

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(vault.initialize(asset.address, market.address, 'Blue Chip'))
        .to.revertedWithCustomError(vault, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Perennial V2 Vault: Blue Chip')
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
        await oracleFactory.connect(owner).callStatic.create(LINK_PRICE_FEE_ID, vaultOracleFactory.address),
        owner,
      )
      await oracleFactory.connect(owner).create(LINK_PRICE_FEE_ID, vaultOracleFactory.address)

      market3 = await deployProductOnMainnetFork({
        factory: factory,
        token: asset,
        owner: owner,
        name: 'Chainlink Token',
        symbol: 'LINK',
        oracle: rootOracle3.address,
        payoff: constants.AddressZero,
        makerLimit: parse6decimal('1000000'),
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
      oracle4.at.whenCalledWith(realVersion4.timestamp).returns(realVersion4)

      const LINK0_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000004'
      vaultOracleFactory.instances.whenCalledWith(oracle4.address).returns(true)
      vaultOracleFactory.oracles.whenCalledWith(LINK0_PRICE_FEE_ID).returns(oracle4.address)

      const rootOracle4 = IOracle__factory.connect(
        await oracleFactory.connect(owner).callStatic.create(LINK0_PRICE_FEE_ID, vaultOracleFactory.address),
        owner,
      )
      await oracleFactory.connect(owner).create(LINK0_PRICE_FEE_ID, vaultOracleFactory.address)

      const marketBadAsset = await deployProductOnMainnetFork({
        factory: factory,
        token: IERC20Metadata__factory.connect(constants.AddressZero, owner),
        owner: owner,
        name: 'Chainlink Token',
        symbol: 'LINK',
        oracle: rootOracle4.address,
        payoff: constants.AddressZero,
        makerLimit: parse6decimal('1000000'),
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
        cap: parse6decimal('1000000'),
      }
      await expect(vault.connect(owner).updateParameter(newParameter))
        .to.emit(vault, 'ParameterUpdated')
        .withArgs(newParameter)

      const parameter = await vault.parameter()
      expect(parameter.cap).to.deep.contain(newParameter.cap)
    })

    it('reverts when not owner', async () => {
      const newParameter = {
        cap: parse6decimal('1000000'),
      }
      await expect(vault.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#updateMarket', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(owner).updateMarket(1, 2, parse6decimal('3')))
        .to.emit(vault, 'MarketUpdated')
        .withArgs(1, 2, parse6decimal('3'))

      expect((await vault.registrations(1)).weight).to.eq(2)
      expect((await vault.registrations(1)).leverage).to.eq(parse6decimal('3'))

      await expect(vault.connect(owner).updateMarket(1, 0, 0)).to.emit(vault, 'MarketUpdated').withArgs(1, 0, 0)

      expect((await vault.registrations(1)).weight).to.eq(0)
      expect((await vault.registrations(1)).leverage).to.eq(0)
    })

    it('reverts when invalid marketId', async () => {
      await expect(vault.connect(owner).updateMarket(2, 10, parse6decimal('1'))).to.be.revertedWithCustomError(
        vault,
        'VaultMarketDoesNotExistError',
      )
    })

    it('reverts when not owner', async () => {
      await expect(vault.connect(user).updateMarket(2, 10, parse6decimal('1'))).to.be.revertedWithCustomError(
        vault,
        'InstanceNotOwnerError',
      )
    })
  })

  describe('#deposit/#redeem/#claim/#settle', () => {
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
      await vault.settle(user.address)

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
      await expect(vault.connect(user2).update(user2.address, 0, 1, 0)).to.be.revertedWithPanic('0x11')
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

    it('multiple users', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user2.address)

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
      await vault.settle(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.settle(user2.address)

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

    it('deposit during redemption', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('2000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await vault.connect(user).update(user.address, 0, parse6decimal('400'), 0)
      await updateOracle()
      await vault.settle(user.address)
      await vault.settle(user2.address)

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
      await vault.settle(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.settle(user2.address)

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

    it('max redeem', async () => {
      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const shareAmount = BigNumber.from(parse6decimal('1000'))
      expect((await vault.accounts(user.address)).shares).to.equal(shareAmount)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const shareAmount2 = BigNumber.from('9999767625')
      expect((await vault.accounts(user.address)).shares).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to redeem more than balance.
      await expect(
        vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares.add(1), 0),
      ).to.be.revertedWithPanic('0x11')

      // But we should be able to redeem exactly balance.

      await vault.connect(user).update(user.address, 0, (await vault.accounts(user.address)).shares, 0)

      // The oracle price hasn't changed yet, so we shouldn't be able to redeem any more.
      expect((await vault.accounts(user.address)).shares).to.equal(0)

      // But if we update the oracle price, we should be able to redeem the rest of our shares.
      await updateOracle()
      await vault.settle(user.address)

      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('max redeem with close limited', async () => {
      const largeDeposit = parse6decimal('10000')

      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const currentPosition = await market.pendingPosition((await market.global()).currentId)
      const currentNet = currentPosition.long.sub(currentPosition.short).abs()

      // Open taker position up to 100% utilization minus 1 ETH
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(
          perennialUser.address,
          0,
          currentPosition.maker.sub(currentNet).sub(parse6decimal('1')),
          0,
          parse6decimal('1000000'),
          false,
        )

      // Settle the take position
      await updateOracle()
      await vault.settle(user.address)

      // The vault can close 1 ETH of maker positions in the ETH market, which means the user can redeem 5/4 this amount
      const makerAvailable = BigNumber.from(1000000)
      const redeemAvailable = await vault.convertToShares(
        originalOraclePrice.mul(makerAvailable).mul(5).div(4).div(leverage),
      )

      await expect(
        vault.connect(user).update(user.address, 0, redeemAvailable.add(1), 0),
      ).to.be.revertedWithCustomError(vault, 'VaultRedemptionLimitExceededError')

      await expect(vault.connect(user).update(user.address, 0, redeemAvailable, 0)).to.not.be.reverted
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      // vault starts balanced
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // price lowers, vault does one round of rebalancing but its maintenance's are still out-of-sync
      await updateOracle(parse6decimal('2000'))
      await vault.connect(user).update(user.address, 0, 0, 0)
      expect(await collateralInVault()).to.not.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // vault does another round of rebalancing and its maintenance's are now in-sync
      await updateOracle(parse6decimal('2000'))
      await vault.connect(user).update(user.address, 0, 0, 0)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // price raises, vault does one round of rebalancing but its maintenance's are still out-of-sync
      await updateOracle(originalOraclePrice)
      await vault.connect(user).update(user.address, 0, 0, 0)
      expect(await collateralInVault()).to.not.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))

      // vault does one round of rebalancing but it maintenance's are still out-of-sync
      await updateOracle(originalOraclePrice)
      await vault.connect(user).update(user.address, 0, 0, 0)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), parse6decimal('1'))
    })

    it('rounds deposits correctly', async () => {
      const oddDepositAmount = parse6decimal('10000').add(1) // 10K + 1 wei

      await vault.connect(user).update(user.address, oddDepositAmount, 0, 0)
      await updateOracle()
      await vault.settle(user.address)
      expect(await asset.balanceOf(vault.address)).to.equal(1e12)

      await vault.connect(user).update(user.address, oddDepositAmount, 0, 0)
      await updateOracle()
      await vault.settle(user.address)
    })

    it('operate on behalf', async () => {
      const largeDeposit = parse6decimal('10000')
      await expect(vault.connect(liquidator).update(user.address, largeDeposit, 0, 0)).to.revertedWithCustomError(
        vault,
        'VaultNotOperatorError',
      )
      await vaultFactory.connect(user).updateOperator(liquidator.address, true)
      vault.connect(liquidator).update(user.address, largeDeposit, 0, 0)
      await vaultFactory.connect(user).updateOperator(liquidator.address, false)

      await updateOracle()
      await vault.settle(user.address)

      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('10000'))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('10000'))
      expect(await asset.balanceOf(liquidator.address)).to.equal(parse6decimal('190000').mul(1e12))
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').mul(1e12))

      await expect(
        vault.connect(liquidator).update(user.address, parse6decimal('10000'), 0, 0),
      ).to.revertedWithCustomError(vault, 'VaultNotOperatorError')
      await vaultFactory.connect(user).updateOperator(liquidator.address, true)
      await vault.connect(liquidator).update(user.address, 0, parse6decimal('10000'), 0)
      await vaultFactory.connect(user).updateOperator(liquidator.address, false)
      await updateOracle()
      await vault.settle(user.address)

      const fundingAmount = BigNumber.from('218864')
      await expect(
        vault.connect(liquidator).update(user.address, 0, 0, ethers.constants.MaxUint256),
      ).to.revertedWithCustomError(vault, 'VaultNotOperatorError')
      await vaultFactory.connect(user).updateOperator(liquidator.address, true)
      await vault.connect(liquidator).update(user.address, 0, 0, ethers.constants.MaxUint256)
      await vaultFactory.connect(user).updateOperator(liquidator.address, false)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(parse6decimal('200000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').mul(1e12))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(perennialUser.address, parse6decimal('480'), 0, 0, parse6decimal('400000'), false)
      await updateOracle()
      await vault.settle(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal('205981')
    })

    it('exactly at makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      const makerAvailable = (await market.riskParameter()).makerLimit.sub(
        (await market.pendingPosition((await market.global()).currentId)).maker,
      )
      await market
        .connect(perennialUser)
        .update(perennialUser.address, makerAvailable, 0, 0, parse6decimal('400000'), false)

      await updateOracle()
      await vault.settle(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

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
      await vault.settle(user.address)

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(perennialUser.address, 0, parse6decimal('110'), 0, parse6decimal('1000000'), false)

      await updateOracle()
      await vault.settle(user.address)

      const makerAvailable = BigNumber.from(2212633)
      const redeemAvailable = await vault.convertToShares(
        originalOraclePrice.mul(makerAvailable).mul(5).div(4).div(leverage),
      )

      // Redeem should create a greater position delta than what's available
      await vault.connect(user).update(user.address, 0, redeemAvailable, 0)
      await updateOracle()
      await vault.settle(user.address)
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).update(user.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
      const marketParameter = { ...(await market.parameter()) }
      const btcMarketParameter = { ...(await btcMarket.parameter()) }

      marketParameter.closed = true
      await market.connect(owner).updateParameter(marketParameter)
      btcMarketParameter.closed = true
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await updateOracle()
      await vault.connect(user).update(user.address, 0, 0, 0)

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
      await vault.connect(user).update(user.address, 0, 0, 0)

      await updateOracle()
      await settleUnderlying(vaultSigner)

      // Positions should be opened back up again
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
    })

    it('multiple users w/ makerFee', async () => {
      const makerFee = parse6decimal('0.001')
      const riskParameters = { ...(await market.riskParameter()) }
      riskParameters.makerFee = makerFee
      await market.updateRiskParameter(riskParameters)
      const btcRiskParameters = { ...(await btcMarket.riskParameter()) }
      btcRiskParameters.makerFee = makerFee
      await btcMarket.updateRiskParameter(btcRiskParameters)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      const collateralForRebalance = parse6decimal('996').add(largeDeposit).add(10)
      expect(await position()).to.be.equal(collateralForRebalance.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.be.equal(collateralForRebalance.mul(leverage).div(5).div(btcOriginalOraclePrice))

      const balanceOf2 = BigNumber.from('9997751392')
      const totalAssets = BigNumber.from('10996225614')
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
      await vault.settle(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const currentFee = (
        await market.pendingPositions(vault.address, (await market.locals(vault.address)).currentId.sub(1))
      ).fee
      const btcCurrentFee = (
        await btcMarket.pendingPositions(vault.address, (await btcMarket.locals(vault.address)).currentId.sub(1))
      ).fee

      const unclaimed1 = BigNumber.from('992142699')
      const unclaimed2 = BigNumber.from('9923301967')
      const finalTotalAssets = BigNumber.from('39840038') // last position fee
      expect(await totalCollateralInVault()).to.equal(unclaimed1.add(unclaimed2).mul(1e12))
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect(currentFee.add(btcCurrentFee)).to.equal(finalTotalAssets)
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
      await vault.settle(user.address)
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('1000').add(0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.convertToAssets(parse6decimal('1000'))).to.equal(parse6decimal('1000').add(0))
      expect(await vault.convertToShares(parse6decimal('1000').add(0))).to.equal(parse6decimal('1000'))
    })

    it('multiple users w/ makerFee + settlement fee', async () => {
      const makerFee = parse6decimal('0.001')
      const riskParameters = { ...(await market.riskParameter()) }
      riskParameters.makerFee = makerFee
      await market.updateRiskParameter(riskParameters)
      const btcRiskParameters = { ...(await btcMarket.riskParameter()) }
      btcRiskParameters.makerFee = makerFee
      await btcMarket.updateRiskParameter(btcRiskParameters)

      const settlementFee = parse6decimal('1.00')
      const marketParameter = { ...(await market.parameter()) }
      marketParameter.settlementFee = settlementFee
      await market.connect(owner).updateParameter(marketParameter)
      const btcMarketParameter = { ...(await btcMarket.parameter()) }
      btcMarketParameter.settlementFee = settlementFee
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).update(user2.address, largeDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      const collateralForRebalance = parse6decimal('996').add(largeDeposit).sub(parse6decimal('2')).add(10)
      expect(await position()).to.be.equal(collateralForRebalance.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.be.equal(collateralForRebalance.mul(leverage).div(5).div(btcOriginalOraclePrice))

      const balanceOf2 = BigNumber.from('10015867906')
      const totalAssets = BigNumber.from('10994225573')
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
      await vault.settle(user.address)

      await vault.connect(user2).update(user2.address, 0, (await vault.accounts(user2.address)).shares, 0)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have redeemed all of our shares.
      const currentFee = (
        await market.pendingPositions(vault.address, (await market.locals(vault.address)).currentId.sub(1))
      ).fee
      const btcCurrentFee = (
        await btcMarket.pendingPositions(vault.address, (await btcMarket.locals(vault.address)).currentId.sub(1))
      ).fee
      const currentKeeper = (
        await market.pendingPositions(vault.address, (await market.locals(vault.address)).currentId.sub(1))
      ).keeper
      const btcCurrentKeeper = (
        await btcMarket.pendingPositions(vault.address, (await btcMarket.locals(vault.address)).currentId.sub(1))
      ).keeper

      const unclaimed1 = BigNumber.from('988141833')
      const unclaimed2 = BigNumber.from('9919317811')
      const finalTotalAssets = BigNumber.from('41832055') // last position fee + keeper
      expect(await totalCollateralInVault()).to.equal(unclaimed1.add(unclaimed2).mul(1e12))
      expect((await vault.accounts(user.address)).shares).to.equal(0)
      expect((await vault.accounts(user2.address)).shares).to.equal(0)
      expect(currentFee.add(btcCurrentFee).add(currentKeeper).add(btcCurrentKeeper)).to.equal(finalTotalAssets)
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

      expect(await totalCollateralInVault()).to.equal(parse6decimal('4').mul(1e12)) // optimistically charges settlement fee on claim
      expect(await vault.totalAssets()).to.equal(finalTotalAssets)
      expect(await vault.totalShares()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(unclaimed1).sub(parse6decimal('1000')).sub(parse6decimal('2')).mul(1e12),
      )
      expect(await asset.balanceOf(user2.address)).to.equal(
        parse6decimal('100000').add(unclaimed2).sub(parse6decimal('10000')).sub(parse6decimal('2')).mul(1e12),
      )
      expect((await vault.accounts(user2.address)).assets).to.equal(0)
      expect((await vault.accounts(ethers.constants.AddressZero)).assets).to.equal(0)

      await updateOracle()
      await vault.settle(user.address)
      await vault.connect(user).update(user.address, smallDeposit, 0, 0)
      await updateOracle()
      await vault.settle(user.address)
      expect((await vault.accounts(user.address)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('1004').add(0))
      expect((await vault.accounts(ethers.constants.AddressZero)).shares).to.equal(parse6decimal('1000'))
      expect(await vault.convertToAssets(parse6decimal('1000'))).to.equal(parse6decimal('1004').add(0))
      expect(await vault.convertToShares(parse6decimal('1004').add(0))).to.equal(parse6decimal('1000'))
    })

    it('reverts when below settlement fee', async () => {
      const settlementFee = parse6decimal('1.00')
      const marketParameter = { ...(await market.parameter()) }
      marketParameter.settlementFee = settlementFee
      await market.connect(owner).updateParameter(marketParameter)
      const btcMarketParameter = { ...(await btcMarket.parameter()) }
      btcMarketParameter.settlementFee = settlementFee
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await expect(vault.connect(user).update(user.address, parse6decimal('0.50'), 0, 0)).to.revertedWithCustomError(
        vault,
        'VaultInsufficientMinimumError',
      )
      await expect(vault.connect(user).update(user.address, 0, parse6decimal('0.50'), 0)).to.revertedWithCustomError(
        vault,
        'VaultInsufficientMinimumError',
      )
      await expect(vault.connect(user).update(user.address, 0, 0, parse6decimal('0.50'))).to.revertedWithPanic('0x11')
    })

    it('reverts when paused', async () => {
      await vaultFactory.connect(owner).pause()
      await expect(vault.settle(user.address)).to.revertedWithCustomError(vault, 'InstancePausedError')
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
      context('long', () => {
        it('recovers from a liquidation', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('50000'))
          await expect(vault.connect(user).update(user.address, 0, 0, 0)).to.be.reverted

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('5149547500')
          await btcMarket.connect(user).update(vault.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('4428767485') // no shortfall
          expect((await btcMarket.locals(vault.address)).protection).to.equal(STARTING_TIMESTAMP.add(3600 * 3))

          await expect(vault.connect(user).update(user.address, 0, 0, 0)).to.be.reverted

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('40000'))
          await vault.connect(user).update(user.address, 2, 0, 0)
          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('114518139')
          const finalCollateral = BigNumber.from('81419219970')
          const btcFinalPosition = BigNumber.from('1482485')
          const btcFinalCollateral = BigNumber.from('12354044463')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('80000'))
          await expect(vault.connect(user).update(user.address, 0, 0, 0)).to.be.reverted

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('8239276000')
          await btcMarket.connect(user).update(vault.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('-26673235277') // shortfall
          expect((await btcMarket.locals(vault.address)).protection).to.equal(STARTING_TIMESTAMP.add(3600 * 3))

          await expect(vault.connect(user).update(user.address, 0, 0, 0)).to.be.reverted

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('55000'))
          await vault.connect(user).update(user.address, 2, 0, 0)
          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('93640322')
          const finalCollateral = BigNumber.from('67743010959')
          const btcFinalPosition = BigNumber.from('779781')
          const btcFinalCollateral = BigNumber.from('8934992210')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })

      context('short', () => {
        beforeEach(async () => {
          // get utilization closer to target in order to trigger pnl on price deviation
          await market.connect(user2).update(user2.address, 0, 0, parse6decimal('100'), parse6decimal('100000'), false)
          await btcMarket
            .connect(btcUser2)
            .update(btcUser2.address, 0, 0, parse6decimal('10'), parse6decimal('100000'), false)
          await updateOracle()
          await vault.settle(user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('20000'))
          await expect(vault.connect(user).update(user.address, 0, 0, 0)).to.be.reverted

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('2059819000')
          await btcMarket.connect(user).update(vault.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('350784004') // no shortfall
          expect((await btcMarket.locals(vault.address)).protection).to.equal(STARTING_TIMESTAMP.add(3600 * 4))

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('30000'))
          await updateOracle()
          await vault.connect(user).update(user.address, 2, 0, 0)

          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('109544798')
          const finalCollateral = BigNumber.from('78163427696')
          const btcFinalPosition = BigNumber.from('1846333')
          const btcFinalCollateral = BigNumber.from('11539586090')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).update(user.address, parse6decimal('100000'), 0, 0)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('19000'))
          await expect(vault.connect(user).update(user.address, 0, 0, 0)).to.be.reverted

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          const EXPECTED_LIQUIDATION_FEE = BigNumber.from('1956828050')
          await btcMarket.connect(user).update(vault.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('-479967521') // shortfall
          expect((await btcMarket.locals(vault.address)).protection).to.equal(STARTING_TIMESTAMP.add(3600 * 4))

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('30000'))
          await updateOracle()
          await vault.connect(user).update(user.address, 2, 0, 0)

          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('109670541')
          const finalCollateral = BigNumber.from('78245796664')
          const btcFinalPosition = BigNumber.from('1849628')
          const btcFinalCollateral = BigNumber.from('11560178332')
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
        await vault.settle(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).update(user.address, 0, parse6decimal('80000'), 0)
        await updateOracle()
        await vault.settle(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('10000'))
        const EXPECTED_LIQUIDATION_FEE = BigNumber.from('12212633500')
        await market.connect(user).update(vault.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
        await settle(market, user2)
        await market.connect(user2).update(user2.address, 0, 0, 0, 0, false)

        // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        await vault.connect(user).update(user.address, 0, 0, 0)

        await updateOracle()
        await vault.settle(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('4700653858')
        const btcFinalPosition = BigNumber.from('0')
        const btcFinalCollateral = BigNumber.from('2775492943')
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
        expect((await vault.accounts(user.address)).assets).to.equal(0)
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
        await vault.settle(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).update(user.address, 0, parse6decimal('80000'), 0)
        await updateOracle()
        await vault.settle(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('20000'))
        const EXPECTED_LIQUIDATION_FEE = BigNumber.from('24425267000')
        await market.connect(user).update(vault.address, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)
        await updateOracle()
        await vault.settle(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('-133568939868')
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
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.connect(user).update(user.address, 0, 0, ethers.constants.MaxUint256)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
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
        await vault.settle(user.address)

        const deposit1 = parse6decimal('10000')
        await vault.connect(user2).update(user2.address, deposit1, 0, 0)
        await updateOracle()
        await vault.settle(user2.address)
      })

      it('handles setting leverage to 0', async () => {
        expect(await position()).to.be.equal(
          parse6decimal('11000').mul(leverage).mul(4).div(5).div(originalOraclePrice),
        )
        expect(await btcPosition()).to.be.equal(parse6decimal('11000').mul(leverage).div(5).div(btcOriginalOraclePrice))

        // Deleverage the ETH market
        await vault.updateMarket(0, 4, 0)

        await vault.connect(user).update(user.address, 0, 0, 0)
        await updateOracle()

        const currentId = (await market.locals(vault.address)).currentId
        const pendingPosition = await market.pendingPositions(vault.address, currentId)
        expect(pendingPosition.maker).to.equal(0)

        await vault.connect(user).update(user.address, 0, 0, 0)
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
        await vault.settle(user.address)

        const deposit1 = parse6decimal('10000')
        await vault.connect(user2).update(user2.address, deposit1, 0, 0)
        await updateOracle()
        await vault.settle(user2.address)
      })

      it('handles setting weight to 0', async () => {
        expect(await position()).to.be.equal(
          parse6decimal('11000').mul(leverage).mul(4).div(5).div(originalOraclePrice),
        )
        expect(await btcPosition()).to.be.equal(parse6decimal('11000').mul(leverage).div(5).div(btcOriginalOraclePrice))

        // Close the ETH market
        await vault.updateMarket(0, 0, leverage)

        await vault.connect(user).update(user.address, 0, 0, 0)
        await updateOracle()

        const currentId = (await market.locals(vault.address)).currentId
        const pendingPosition = await market.pendingPositions(vault.address, currentId)
        expect(pendingPosition.maker).to.equal(0)

        await vault.connect(user).update(user.address, 0, 0, 0)
        await updateOracle()

        expect(await position()).to.be.equal(0)
      })
    })

    context('add market', () => {
      beforeEach(async () => {
        // set ETH market to 0
        await vault.updateMarket(0, 0, 0)

        // Seed vault with deposits
        const deposit0 = parse6decimal('1000')
        await vault.connect(user).update(user.address, deposit0, 0, 0)
        await updateOracle()
        await vault.settle(user.address)

        const deposit1 = parse6decimal('10000')
        await vault.connect(user2).update(user2.address, deposit1, 0, 0)
        await updateOracle()
        await vault.settle(user2.address)
      })

      it('handles re-setting weight to non-0', async () => {
        expect(await position()).to.be.equal(0)
        expect(await btcPosition()).to.be.equal(parse6decimal('11000').mul(leverage).div(btcOriginalOraclePrice))

        // Open the ETH market
        await vault.updateMarket(0, 9, leverage)

        await vault.connect(user).update(user.address, 0, 0, 0)
        await updateOracle()

        const currentId = (await market.locals(vault.address)).currentId
        const pendingPosition = await market.pendingPositions(vault.address, currentId)
        expect(pendingPosition.maker).to.be.greaterThan(0)

        await vault.connect(user).update(user.address, 0, 0, 0)
        await updateOracle()

        expect(await position()).to.be.greaterThan(0)
      })
    })
  })
})
