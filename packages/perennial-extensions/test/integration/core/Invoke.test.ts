import { IOracle, IVault, IVaultFactory, Market, MultiInvoker } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InstanceVars, createInvoker, createMarket, deployProtocol } from '../helpers/setupHelpers'
import { buildApproveTarget, buildUpdateMarket, buildUpdateVault } from '../../helpers/invoke'
import { parse6decimal } from '../../../../common/testutil/types'
import { expect, use } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import {
  IERC20Metadata__factory,
  IOracleFactory,
  IOracleProvider,
  IVault__factory,
  IVaultFactory__factory,
  Vault__factory,
  VaultFactory__factory,
} from '@equilibria/perennial-v2-vault/types/generated'
import { BigNumber, constants } from 'ethers'
import { TransparentUpgradeableProxy__factory } from '@equilibria/perennial-v2/types/generated'
import { IOracle__factory } from '@equilibria/perennial-v2-oracle/types/generated'
import { deployProductOnMainnetFork } from '@equilibria/perennial-v2-vault/test/integration/helpers/setupHelpers'
import { fundWallet, settle } from '@equilibria/perennial-v2/test/integration/helpers/setupHelpers'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

use(smock.matchers)

const LEGACY_ORACLE_DELAY = 3600

describe('Invoke', () => {
  let instanceVars: InstanceVars
  let mulitInvoker: MultiInvoker
  let market: Market
  let vaultFactory: IVaultFactory
  let vault: IVault
  let ethSubOracle: FakeContract<IOracleProvider>
  let btcSubOracle: FakeContract<IOracleProvider>

  async function deployVault(instanceVars: InstanceVars) {
    const STARTING_TIMESTAMP = BigNumber.from(1646456563)
    const ETH_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const BTC_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000002'

    const [owner, , user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()
    const marketFactory = instanceVars.marketFactory
    const oracleFactory = instanceVars.oracleFactory

    const vaultOracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    await oracleFactory.connect(owner).register(vaultOracleFactory.address)
    await oracleFactory.connect(owner).authorize(marketFactory.address)

    ethSubOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    const ethRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('2620237388'),
      valid: true,
    }

    ethSubOracle.status.returns([ethRealVersion, ethRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    ethSubOracle.request.returns()
    ethSubOracle.latest.returns(ethRealVersion)
    ethSubOracle.current.returns(ethRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    ethSubOracle.at.whenCalledWith(ethRealVersion.timestamp).returns(ethRealVersion)

    btcSubOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    const btcRealVersion = {
      timestamp: STARTING_TIMESTAMP,
      price: BigNumber.from('38838362695'),
      valid: true,
    }

    btcSubOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcSubOracle.request.returns()
    btcSubOracle.latest.returns(btcRealVersion)
    btcSubOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcSubOracle.at.whenCalledWith(btcRealVersion.timestamp).returns(btcRealVersion)

    vaultOracleFactory.instances.whenCalledWith(ethSubOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(ethSubOracle.address)
    vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcSubOracle.address)

    const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
      instanceVars.marketFactory.address, // dummy contract
      instanceVars.proxyAdmin.address,
      [],
    )

    vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(btcSubOracle.address)
    vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
    vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcSubOracle.address)

    const ethOracle = IOracle__factory.connect(
      await instanceVars.oracleFactory.connect(owner).callStatic.create(ETH_PRICE_FEE_ID, vaultOracleFactory.address),
      owner,
    )
    await instanceVars.oracleFactory.connect(owner).create(ETH_PRICE_FEE_ID, vaultOracleFactory.address)

    const btcOracle = IOracle__factory.connect(
      await instanceVars.oracleFactory.connect(owner).callStatic.create(BTC_PRICE_FEE_ID, vaultOracleFactory.address),
      owner,
    )
    await instanceVars.oracleFactory.connect(owner).create(BTC_PRICE_FEE_ID, vaultOracleFactory.address)

    console.log(1)
    const ethMarket = await deployProductOnMainnetFork({
      factory: instanceVars.marketFactory,
      token: instanceVars.dsu,
      owner: owner,
      oracle: ethOracle.address,
      payoff: constants.AddressZero,
      makerLimit: parse6decimal('1000'),
      minMaintenance: parse6decimal('50'),
      maxLiquidationFee: parse6decimal('25000'),
    })
    console.log(1)
    const btcMarket = await deployProductOnMainnetFork({
      factory: instanceVars.marketFactory,
      token: instanceVars.dsu,
      owner: owner,
      oracle: btcOracle.address,
      payoff: constants.AddressZero,
      minMaintenance: parse6decimal('50'),
      maxLiquidationFee: parse6decimal('25000'),
    })
    console.log(1)

    const vaultImpl = await new Vault__factory(owner).deploy()
    const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
      instanceVars.marketFactory.address,
      vaultImpl.address,
    )
    await instanceVars.proxyAdmin.upgrade(vaultFactoryProxy.address, vaultFactoryImpl.address)
    vaultFactory = IVaultFactory__factory.connect(vaultFactoryProxy.address, owner)
    await vaultFactory.initialize()

    vault = IVault__factory.connect(
      await vaultFactory.callStatic.create(instanceVars.dsu.address, ethMarket.address, 'Blue Chip'),
      owner,
    )
    await vaultFactory.create(instanceVars.dsu.address, ethMarket.address, 'Blue Chip')

    await vault.register(btcMarket.address)
    await vault.updateMarket(0, 4, parse6decimal('4.0'))
    await vault.updateMarket(1, 1, parse6decimal('4.0'))
    await vault.updateParameter({
      cap: parse6decimal('500000'),
    })

    const asset = IERC20Metadata__factory.connect(await vault.asset(), owner)
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
      asset.connect(user).approve(ethMarket.address, ethers.constants.MaxUint256),
      asset.connect(user2).approve(ethMarket.address, ethers.constants.MaxUint256),
      asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256),
      asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256),
    ])

    // Seed markets with some activity
    await ethMarket.connect(user).update(user.address, parse6decimal('200'), 0, 0, parse6decimal('100000'), false)
    await ethMarket.connect(user2).update(user2.address, 0, parse6decimal('100'), 0, parse6decimal('100000'), false)
    await btcMarket
      .connect(btcUser1)
      .update(btcUser1.address, parse6decimal('20'), 0, 0, parse6decimal('100000'), false)
    await btcMarket
      .connect(btcUser2)
      .update(btcUser2.address, 0, parse6decimal('10'), 0, parse6decimal('100000'), false)

    return { instanceVars, vaultFactoryProxy, ethOracle }
  }

  async function updateVaultOracle(newEthPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await _updateVaultOracleEth(newEthPrice)
    await _updateVaultOracleBtc(newPriceBtc)
  }

  async function settleVaultUnderlying(account: SignerWithAddress) {
    await settle(ethMarket, account)
    await settle(btcMarket, account)
  }

  async function _updateVaultOracleEth(newPrice?: BigNumber) {
    const [currentTimestamp, currentPrice] = await ethSubOracle.latest()
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    ethSubOracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    ethSubOracle.request.returns()
    ethSubOracle.latest.returns(newVersion)
    ethSubOracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    ethSubOracle.at.whenCalledWith(newVersion.timestamp).returns(newVersion)
  }

  async function _updateVaultOracleBtc(newPrice?: BigNumber) {
    const [currentTimestamp, currentPrice] = await btcSubOracle.latest()
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    btcSubOracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcSubOracle.request.returns()
    btcSubOracle.latest.returns(newVersion)
    btcSubOracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcSubOracle.at.whenCalledWith(newVersion.timestamp).returns(newVersion)
  }

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await deployVault(instanceVars)
    market = await createMarket(instanceVars)
    mulitInvoker = await createInvoker(instanceVars, vaultFactory)
  })

  describe.only('#happy path', async () => {
    const collateral = parse6decimal('1000')
    const dsuCollateral = collateral.mul(1e12)

    it('deposits into market', async () => {
      const { user, dsu } = instanceVars

      const userBalanceBefore = await dsu.balanceOf(user.address)

      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)
      await expect(mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(user.address, mulitInvoker.address, dsuCollateral)
        .to.emit(dsu, 'Transfer')
        .withArgs(mulitInvoker.address, market.address, dsuCollateral)

      expect(await dsu.balanceOf(market.address)).to.eq(dsuCollateral)

      const userBalanceAfter = await dsu.balanceOf(user.address)
      expect(userBalanceBefore.sub(userBalanceAfter)).to.eq(dsuCollateral)
    })

    it('withdraws from market', async () => {
      const { user, dsu } = instanceVars

      const userInitialBalance = await dsu.balanceOf(user.address)

      // deposit into market
      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)
      await expect(mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      const userBalanceBefore = await dsu.balanceOf(user.address)

      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1) })),
      ).to.not.be.reverted

      const userBalanceAfter = await dsu.balanceOf(user.address)

      expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(dsuCollateral)
      expect(userBalanceAfter).to.eq(userInitialBalance)
    })

    it('wraps USDC to DSU and deposits into market', async () => {
      const { user, usdc, dsu } = instanceVars

      const userBalanceBefore = await usdc.balanceOf(user.address)

      await usdc.connect(user).approve(mulitInvoker.address, collateral)
      await expect(mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      ).to.not.be.reverted

      const userBalanceAfter = await usdc.balanceOf(user.address)

      expect(userBalanceBefore.sub(userBalanceAfter).eq(collateral))
      expect(await dsu.balanceOf(market.address)).to.eq(dsuCollateral)

      // TODO: batcher
      //expect()
    })

    it('withdraws from market and unwraps DSU to USDC', async () => {
      const { user, dsu, usdc } = instanceVars

      const userUSDCBalanceBefore = await usdc.balanceOf(user.address)

      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)
      await mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      console.log('withdrawing')
      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
      ).to.not.be.reverted
      expect(await usdc.balanceOf(user.address)).to.eq(userUSDCBalanceBefore.add(collateral))
    })

    it('deposits into vault', async () => {
      const { user, dsu } = instanceVars

      const userBalanceBefore = await dsu.balanceOf(user.address)

      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)
      await expect(mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        mulitInvoker.connect(user).invoke(
          buildUpdateVault({
            vault: vault.address,
            depositAssets: dsuCollateral,
            redeemShares: 0,
            claimAssets: 0,
            wrap: false,
          }),
        ),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(user.address, mulitInvoker.address, dsuCollateral)
        .to.emit(dsu, 'Transfer')
        .withArgs(mulitInvoker.address, vault.address, dsuCollateral)

      expect(await dsu.balanceOf(vault.address)).to.eq(dsuCollateral)

      const userBalanceAfter = await dsu.balanceOf(user.address)
      expect(userBalanceBefore.sub(userBalanceAfter)).to.eq(dsuCollateral)
      expect((await vault.accounts(user.address)).deposit).to.eq(dsuCollateral)
    })

    // it('withdraws from market and unwraps DSU to USDC using batcher blah blah', async () => {

    // })

    // TODO rename
    it('approves a market to spend invokers DSU', async () => {
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.be.revertedWith('Dollar: transfer amount exceeds allowance')
    })

    // it('charges fee to an interface', async () => {

    // })
  })

  // describe('#error assertions', async () => {

  // })
})
