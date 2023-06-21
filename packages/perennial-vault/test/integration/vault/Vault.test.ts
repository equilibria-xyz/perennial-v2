import HRE from 'hardhat'
import { time, impersonate } from '../../../../common/testutil'
import { deployProductOnMainnetFork } from '../helpers/setupHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IFactory,
  IMarket,
  Vault__factory,
  IOracleProvider,
  VaultFactory__factory,
  IVaultFactory,
  IVault__factory,
  IVault,
  IVaultFactory__factory,
} from '../../../types/generated'
import { BigNumber, constants } from 'ethers'
import { deployProtocol, fundWallet } from '@equilibria/perennial-v2/test/integration/helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { TransparentUpgradeableProxy__factory } from '@equilibria/perennial-v2/types/generated'

const { config, ethers } = HRE
use(smock.matchers)

const STARTING_TIMESTAMP = BigNumber.from(1646456563)
const LEGACY_ORACLE_DELAY = 3600

describe('Vault', () => {
  let vault: IVault
  let asset: IERC20Metadata
  let vaultFactory: IVaultFactory
  let factory: IFactory
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let btcUser1: SignerWithAddress
  let btcUser2: SignerWithAddress
  let perennialUser: SignerWithAddress
  let liquidator: SignerWithAddress
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let premium: BigNumber
  let originalOraclePrice: BigNumber
  let oracle: FakeContract<IOracleProvider>
  let market: IMarket
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcMarket: IMarket

  async function updateOracle(newPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await _updateOracleEth(newPrice)
    await _updateOracleBtc(newPriceBtc)
  }

  async function _updateOracleEth(newPrice?: BigNumber) {
    const [currentTimestamp, currentPrice] = await oracle.latest()
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    oracle.sync.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
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
    btcOracle.sync.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
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

  beforeEach(async () => {
    await time.reset(config)

    const instanceVars = await deployProtocol()

    const parameter = { ...(await instanceVars.factory.parameter()) }
    parameter.minCollateral = parse6decimal('50')
    await instanceVars.factory.updateParameter(parameter)

    let pauser
    ;[owner, pauser, user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()
    factory = instanceVars.factory

    const realVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('2620237388'),
      valid: true,
    }
    originalOraclePrice = realVersion.price

    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    oracle.sync.returns([realVersion, realVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    oracle.latest.returns(realVersion)
    oracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    oracle.at.whenCalledWith(realVersion.timestamp).returns(realVersion)

    const btcRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('38838362695'),
      valid: true,
    }
    btcOriginalOraclePrice = btcRealVersion.price

    btcOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    btcOracle.sync.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcOracle.latest.returns(btcRealVersion)
    btcOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcOracle.at.whenCalledWith(btcRealVersion.timestamp).returns(btcRealVersion)

    market = await deployProductOnMainnetFork({
      factory: instanceVars.factory,
      token: instanceVars.dsu,
      owner: owner,
      name: 'Ethereum',
      symbol: 'ETH',
      oracle: oracle.address,
      makerLimit: parse6decimal('1000'),
    })
    btcMarket = await deployProductOnMainnetFork({
      factory: instanceVars.factory,
      token: instanceVars.dsu,
      owner: owner,
      name: 'Bitcoin',
      symbol: 'BTC',
      oracle: btcOracle.address,
    })
    leverage = parse6decimal('4.0')
    maxCollateral = parse6decimal('500000')
    premium = parse6decimal('0.10')

    const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
      instanceVars.factory.address, // dummy contract
      instanceVars.proxyAdmin.address,
      [],
    )

    const vaultImpl = await new Vault__factory(owner).deploy(vaultFactoryProxy.address)
    const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
      instanceVars.factory.address,
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
    await vault.updateWeight(0, 4)
    await vault.updateWeight(1, 1)
    await vault.updateParameter({
      asset: instanceVars.dsu.address,
      leverage: leverage,
      cap: maxCollateral,
      premium: premium,
    })

    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)
    await asset.connect(liquidator).approve(vault.address, ethers.constants.MaxUint256)
    await fundWallet(asset, liquidator)
    await asset.connect(perennialUser).approve(vault.address, ethers.constants.MaxUint256)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await asset.connect(user).approve(vault.address, ethers.constants.MaxUint256)
    await asset.connect(user2).approve(vault.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser1).approve(vault.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256)

    // Seed markets with some activity
    await asset.connect(user).approve(market.address, ethers.constants.MaxUint256)
    await asset.connect(user2).approve(market.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256)
    await market.connect(user).update(user.address, parse6decimal('200'), 0, 0, parse6decimal('100000'))
    await market.connect(user2).update(user2.address, 0, parse6decimal('100'), 0, parse6decimal('100000'))
    await btcMarket.connect(btcUser1).update(btcUser1.address, parse6decimal('20'), 0, 0, parse6decimal('100000'))
    await btcMarket.connect(btcUser2).update(btcUser2.address, 0, parse6decimal('10'), 0, parse6decimal('100000'))
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

  describe('#approve', () => {
    it('approves correctly', async () => {
      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)

      await expect(vault.connect(user).approve(liquidator.address, parse6decimal('10')))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, parse6decimal('10'))

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(parse6decimal('10'))

      await expect(vault.connect(user).approve(liquidator.address, 0))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, 0)

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)
    })
  })

  describe('#register', () => {
    let market3: IMarket

    beforeEach(async () => {
      const realVersion3 = {
        timestamp: STARTING_TIMESTAMP,
        price: BigNumber.from('13720000'),
        valid: true,
      }

      const oracle3 = await smock.fake<IOracleProvider>('IOracleProvider')
      oracle3.sync.returns([realVersion3, realVersion3.timestamp.add(LEGACY_ORACLE_DELAY)])
      oracle3.latest.returns(realVersion3)
      oracle3.at.whenCalledWith(realVersion3.timestamp).returns(realVersion3)

      market3 = await deployProductOnMainnetFork({
        factory: factory,
        token: asset,
        owner: owner,
        name: 'Chainlink Token',
        symbol: 'LINK',
        oracle: oracle3.address,
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
        'VaultNotOwnerError',
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
      const marketBadAsset = await deployProductOnMainnetFork({
        factory: factory,
        token: IERC20Metadata__factory.connect(constants.AddressZero, owner),
        owner: owner,
        name: 'Chainlink Token',
        symbol: 'LINK',
        oracle: constants.AddressZero,
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
        asset: asset.address,
        leverage: parse6decimal('5'),
        cap: parse6decimal('1000000'),
        premium: parse6decimal('0.20'),
      }
      await expect(vault.connect(owner).updateParameter(newParameter))
        .to.emit(vault, 'ParameterUpdated')
        .withArgs(newParameter)

      const parameter = await vault.parameter()
      expect(parameter.asset).to.deep.contain(newParameter.asset)
      expect(parameter.leverage).to.deep.contain(newParameter.leverage)
      expect(parameter.cap).to.deep.contain(newParameter.cap)
      expect(parameter.premium).to.deep.contain(newParameter.premium)
    })

    it('reverts when asset changes', async () => {
      const newParameter = {
        asset: constants.AddressZero,
        leverage: parse6decimal('5'),
        cap: parse6decimal('1000000'),
        premium: parse6decimal('0.20'),
      }
      await expect(vault.connect(owner).updateParameter(newParameter)).to.be.revertedWithCustomError(
        vault,
        'VaultParameterStorageImmutableError',
      )
    })

    it('reverts when not owner', async () => {
      const newParameter = {
        asset: asset.address,
        leverage: parse6decimal('5'),
        cap: parse6decimal('1000000'),
        premium: parse6decimal('0.20'),
      }
      await expect(vault.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        vault,
        'VaultNotOwnerError',
      )
    })
  })

  describe('#updateWeight', () => {
    it('updates correctly', async () => {
      await expect(vault.connect(owner).updateWeight(1, 2)).to.emit(vault, 'WeightUpdated').withArgs(1, 2)

      expect((await vault.registrations(1)).weight).to.eq(2)

      await expect(vault.connect(owner).updateWeight(1, 0)).to.emit(vault, 'WeightUpdated').withArgs(1, 0)

      expect((await vault.registrations(1)).weight).to.eq(0)
    })

    it('reverts when invalid marketId', async () => {
      await expect(vault.connect(owner).updateWeight(2, 10)).to.be.revertedWithCustomError(
        vault,
        'VaultMarketDoesNotExistError',
      )
    })

    it('reverts when not owner', async () => {
      await expect(vault.connect(user).updateWeight(1, 2)).to.be.revertedWithCustomError(vault, 'VaultNotOwnerError')
    })
  })

  describe('#deposit/#redeem/#claim/#settle', () => {
    it('simple deposits and withdraws', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).deposit(smallDeposit, user.address)
      expect(await collateralInVault()).to.equal(0)
      expect(await btcCollateralInVault()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.settle(user.address)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      expect(await collateralInVault()).to.equal(parse6decimal('8008'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2002'))
      expect(await vault.balanceOf(user.address)).to.equal(smallDeposit)
      expect(await vault.totalSupply()).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.settle(user.address)

      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('10010'))
      expect(await vault.totalSupply()).to.equal(parse6decimal('10010'))
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

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await expect(vault.connect(user2).redeem(1, user2.address)).to.be.revertedWithCustomError(
        vault,
        'VaultRedemptionLimitExceededError',
      )

      expect(await vault.maxRedeem(user.address)).to.equal(parse6decimal('10010'))
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.settle(user.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('414858')
      expect(await totalCollateralInVault()).to.equal(parse6decimal('10010').add(fundingAmount).mul(1e12))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.unclaimed(user.address)).to.equal(parse6decimal('10010').add(fundingAmount))
      expect(await vault.totalUnclaimed()).to.equal(parse6decimal('10010').add(fundingAmount))

      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await vault.unclaimed(user.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('multiple users', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
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
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(parse6decimal('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(parse6decimal('1000').add(balanceOf2))
      expect(await vault.convertToAssets(parse6decimal('1000').add(balanceOf2))).to.equal(
        parse6decimal('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('11000').add(fundingAmount0))).to.equal(
        parse6decimal('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('64452')
      const fundingAmount2 = BigNumber.from('1022204')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('11000').add(fundingAmount).add(fundingAmount2).mul(1e12),
      )
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.unclaimed(user.address)).to.equal(parse6decimal('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(parse6decimal('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(parse6decimal('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user2.address)).to.equal(parse6decimal('100000').add(fundingAmount2).mul(1e12))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('deposit during withdraw', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('2000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await vault.connect(user).redeem(parse6decimal('400'), user.address)
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
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('600'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(parse6decimal('2600').add(fundingAmount0))
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('2600')
          .add(fundingAmount0)
          .add(await vault.totalUnclaimed())
          .mul(1e12),
      )
      expect(await vault.totalSupply()).to.equal(parse6decimal('600').add(balanceOf2))
      expect(await vault.convertToAssets(parse6decimal('600').add(balanceOf2))).to.equal(
        parse6decimal('2600').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('2600').add(fundingAmount0))).to.equal(
        parse6decimal('600').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('49197')
      const fundingAmount2 = BigNumber.from('214051')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('3000').add(fundingAmount).add(fundingAmount2).mul(1e12),
      )
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.unclaimed(user.address)).to.equal(parse6decimal('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(parse6decimal('2000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(parse6decimal('3000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user2.address)).to.equal(parse6decimal('100000').add(fundingAmount2).mul(1e12))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('maxWithdraw', async () => {
      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const shareAmount = BigNumber.from(parse6decimal('1000'))
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const shareAmount2 = BigNumber.from('9999767625')
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to withdraw more than maxWithdraw.
      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWithCustomError(vault, 'VaultRedemptionLimitExceededError')

      // But we should be able to withdraw exactly maxWithdraw.
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)

      // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
      expect(await vault.maxRedeem(user.address)).to.equal(0)

      // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
      await updateOracle()
      await vault.settle(user.address)

      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.claim(user.address)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('maxRedeem with close limited', async () => {
      const largeDeposit = parse6decimal('10000')

      await vault.connect(user).deposit(largeDeposit, user.address)
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
        )

      // Settle the take position
      await updateOracle()
      await vault.settle(user.address)

      const makerAvailable = BigNumber.from(1000268) // drift due to funding
      // The vault can close 1 ETH of maker positions in the ETH market, which means the user can withdraw 5/4 this amount
      expect(await vault.maxRedeem(user.address)).to.equal(
        await vault.convertToShares(originalOraclePrice.mul(makerAvailable).mul(5).div(4).div(leverage).sub(1)),
      )

      await vault.settle(user.address)

      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWithCustomError(vault, 'VaultRedemptionLimitExceededError')

      await expect(vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)).to.not.be.reverted
    })

    it('maxDeposit', async () => {
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral)

      await vault.connect(user).deposit(parse6decimal('100000'), user.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(parse6decimal('100000')))

      await vault.connect(user2).deposit(parse6decimal('100000'), user2.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(parse6decimal('200000')))

      await vault.connect(perennialUser).deposit(parse6decimal('300000'), liquidator.address)
      expect(await vault.maxDeposit(user.address)).to.equal(0)

      await expect(vault.connect(liquidator).deposit(1, liquidator.address)).to.revertedWithCustomError(
        vault,
        'VaultDepositLimitExceededError',
      )
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).deposit(parse6decimal('100000'), user.address)
      await updateOracle()
      await vault.settle(user.address)

      const originalTotalCollateral = await totalCollateralInVault()

      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), 3)
      await updateOracle(parse6decimal('1800'))
      await market.connect(user).settle(vault.address)

      await vault.settle(user.address)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), 3)

      await updateOracle(originalOraclePrice)
      await vault.settle(user.address)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), 3)

      // Since the price changed then went back to the original, the total collateral should have increased.
      const fundingAmount = BigNumber.from('3581776')
      expect(await totalCollateralInVault()).to.eq(originalTotalCollateral.add(fundingAmount.mul(1e12)))
      expect(await vault.totalAssets()).to.eq(originalTotalCollateral.div(1e12).add(fundingAmount))
    })

    it('rounds deposits correctly', async () => {
      const oddDepositAmount = parse6decimal('10000').add(1) // 10K + 1 wei

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.settle(user.address)
      expect(await asset.balanceOf(vault.address)).to.equal(1e12)

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.settle(user.address)
    })

    it('deposit on behalf', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(liquidator).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.settle(user.address)
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('10000'))
      expect(await vault.totalSupply()).to.equal(parse6decimal('10000'))

      await expect(vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)).to.revertedWithPanic('0x11')

      await vault.connect(user).approve(liquidator.address, parse6decimal('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)
      await updateOracle()
      await vault.settle(user.address)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('218864')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(parse6decimal('190000').mul(1e12))
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('110000').add(fundingAmount).mul(1e12))
    })

    it('redeem on behalf', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.settle(user.address)
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('10000'))
      expect(await vault.totalSupply()).to.equal(parse6decimal('10000'))

      await expect(vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)).to.revertedWithPanic('0x11')

      await vault.connect(user).approve(liquidator.address, parse6decimal('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)
      await updateOracle()
      await vault.settle(user.address)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('218864')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(perennialUser.address, parse6decimal('480'), 0, 0, parse6decimal('400000'))
      await updateOracle()
      await vault.settle(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
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
      const makerAvailable = (await market.parameter()).makerLimit.sub(
        (await market.pendingPosition((await market.global()).currentId)).maker,
      )
      await market.connect(perennialUser).update(perennialUser.address, makerAvailable, 0, 0, parse6decimal('400000'))

      await updateOracle()
      await vault.settle(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
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
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(perennialUser.address, 0, parse6decimal('110'), 0, parse6decimal('1000000'))

      await updateOracle()
      await vault.settle(user.address)

      // Redeem should create a greater position delta than what's available
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.settle(user.address)

      expect((await market.position()).maker).to.equal((await market.position()).long)
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
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
      await vault.settle(user.address)

      await updateOracle()
      await vault.settle(user.address)

      // We should have closed all positions
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      marketParameter.closed = false
      await market.connect(owner).updateParameter(marketParameter)
      btcMarketParameter.closed = false
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await updateOracle()
      await vault.settle(user.address)

      await updateOracle()
      await vault.settle(user.address)

      // Positions should be opened back up again
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
    })

    it('multiple users w/ makerFee', async () => {
      const makerFee = parse6decimal('0.001')
      const marketParameters = { ...(await market.parameter()) }
      marketParameters.makerFee = makerFee
      await market.updateParameter(marketParameters)
      const btcMarketParameters = { ...(await btcMarket.parameter()) }
      btcMarketParameters.makerFee = makerFee
      await btcMarket.updateParameter(btcMarketParameters)

      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      const collateralForRebalance = parse6decimal('996').add(largeDeposit).add(10)
      expect(await position()).to.be.equal(collateralForRebalance.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.be.equal(collateralForRebalance.mul(leverage).div(5).div(btcOriginalOraclePrice))

      const balanceOf2 = BigNumber.from('9949746180')
      const totalAssets = BigNumber.from('10952225775')
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('995.6'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(totalAssets)
      expect(await vault.totalSupply()).to.equal(parse6decimal('995.6').add(balanceOf2))
      expect(await vault.convertToAssets(parse6decimal('995.6').add(balanceOf2))).to.equal(totalAssets)
      expect(await vault.convertToShares(totalAssets)).to.equal(parse6decimal('995.6').add(balanceOf2))

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const unclaimed1 = BigNumber.from('992263877')
      const unclaimed2 = BigNumber.from('9919166877')
      const finalTotalAsset = BigNumber.from('43837218')
      const finalTotalShares = BigNumber.from('43778883')
      const dust = BigNumber.from('3982830')
      // expect(await totalCollateralInVault()).to.equal(unclaimed1.add(unclaimed2).add(dust).mul(1e12))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(finalTotalAsset)
      expect(await vault.totalShares()).to.equal(finalTotalShares)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(finalTotalShares)).to.equal(finalTotalAsset)
      expect(await vault.convertToShares(finalTotalAsset)).to.equal(finalTotalShares)
      expect(await vault.unclaimed(user.address)).to.equal(unclaimed1)
      expect(await vault.unclaimed(user2.address)).to.equal(unclaimed2)
      expect(await vault.totalUnclaimed()).to.equal(unclaimed1.add(unclaimed2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(dust.mul(1e12))
      expect(await vault.totalAssets()).to.equal(finalTotalAsset)
      expect(await vault.totalShares()).to.equal(finalTotalShares)
      expect(await asset.balanceOf(user.address)).to.equal(
        parse6decimal('100000').add(unclaimed1).sub(parse6decimal('1000')).mul(1e12),
      )
      expect(await asset.balanceOf(user2.address)).to.equal(
        parse6decimal('100000').add(unclaimed2).sub(parse6decimal('10000')).mul(1e12),
      )
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)

      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('995.6'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('995.6').add(dust))
      expect(await vault.totalSupply()).to.equal(parse6decimal('995.6'))
      expect(await vault.convertToAssets(parse6decimal('995.6'))).to.equal(parse6decimal('995.6').add(dust))
      expect(await vault.convertToShares(parse6decimal('995.6').add(dust))).to.equal(parse6decimal('995.6'))
    })

    context('liquidation', () => {
      context('long', () => {
        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('50000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultDepositLimitExceededError',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultRedemptionLimitExceededError',
          )

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('4428767485') // no shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(STARTING_TIMESTAMP.add(3600 * 3))

          //expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultDepositLimitExceededError',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultRedemptionLimitExceededError',
          )

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('40000'))
          await vault.connect(user).deposit(2, user.address)
          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('114518139')
          const finalCollateral = BigNumber.from('75018611547')
          const btcFinalPosition = BigNumber.from('1875404')
          const btcFinalCollateral = BigNumber.from('18754652886')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('80000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultDepositLimitExceededError',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultRedemptionLimitExceededError',
          )

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('-26673235277') // shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(STARTING_TIMESTAMP.add(3600 * 3))

          //expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultDepositLimitExceededError',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultRedemptionLimitExceededError',
          )

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('55000'))
          await vault.connect(user).deposit(2, user.address)
          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('93640322')
          const finalCollateral = BigNumber.from('61342402536')
          const btcFinalPosition = BigNumber.from('1115272')
          const btcFinalCollateral = BigNumber.from('15335600634')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })

      context('short', () => {
        beforeEach(async () => {
          // get utilization closer to target in order to trigger pnl on price deviation
          await market.connect(user2).update(user2.address, 0, 0, parse6decimal('100'), parse6decimal('100000'))
          await btcMarket.connect(btcUser2).update(btcUser2.address, 0, 0, parse6decimal('10'), parse6decimal('100000'))
          await updateOracle()
          await vault.settle(user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('20000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultDepositLimitExceededError',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultRedemptionLimitExceededError',
          )

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('350784004') // no shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(STARTING_TIMESTAMP.add(3600 * 4))

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('30000'))
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('122126339')
          const finalCollateral = BigNumber.from('71762411029')
          const btcFinalPosition = BigNumber.from('2666666')
          const btcFinalCollateral = BigNumber.from('17940602757')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('19000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultDepositLimitExceededError',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'VaultRedemptionLimitExceededError',
          )

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('-479967521') // shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(STARTING_TIMESTAMP.add(3600 * 4))

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('30000'))
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('122126339')
          const finalCollateral = BigNumber.from('71844779997')
          const btcFinalPosition = BigNumber.from('2666666')
          const btcFinalCollateral = BigNumber.from('17961194999')
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
        await vault.connect(user).deposit(parse6decimal('100000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(parse6decimal('80000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('10000'))
        await market.connect(user).settle(vault.address)
        await market.connect(user).settle(user2.address)
        await market.connect(user2).update(user2.address, 0, 0, 0, 0)

        // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        // TODO: this can be used to verify the resolution to the rebalance revert bricking issue
        await updateOracle(parse6decimal('1500'), parse6decimal('5000')) // lower prices to allow rebalance
        await vault.settle(user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('11444422908')
        const btcFinalPosition = BigNumber.from('0')
        const btcFinalCollateral = BigNumber.from('2861105727')
        const finalUnclaimed = BigNumber.from('80001128624')
        const vaultFinalCollateral = await asset.balanceOf(vault.address)
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await collateralInVault()).to.equal(0)
        expect(await btcCollateralInVault()).to.equal(0)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(
          initialBalanceOf.add(finalCollateral.add(btcFinalCollateral).mul(1e12)).add(vaultFinalCollateral),
        )

        // 7. Should no longer be able to deposit, vault is closed
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
          vault,
          'VaultDepositLimitExceededError',
        )
      })

      it('gracefully unwinds upon total insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).deposit(parse6decimal('100000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(parse6decimal('80000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('20000'))
        await market.connect(user).settle(vault.address)
        await updateOracle()
        await vault.settle(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('-133569157316')
        const btcFinalPosition = BigNumber.from('411969') // small position because vault is net negative and won't rebalance
        const btcFinalCollateral = BigNumber.from('20000705838')
        const finalUnclaimed = BigNumber.from('80001128624')
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(initialBalanceOf)
      })
    })
  })
})
