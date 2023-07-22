import { IOracle, IVault, IVaultFactory, Market, MultiInvoker } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InstanceVars, createInvoker, createMarket, deployProtocol, createVault } from '../helpers/setupHelpers'
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
  let multiInvoker: MultiInvoker
  let market: Market
  let vaultFactory: IVaultFactory
  let vault: IVault
  let ethSubOracle: FakeContract<IOracleProvider>
  let btcSubOracle: FakeContract<IOracleProvider>

  async function updateVaultOracle(newEthPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await _updateVaultOracleEth(newEthPrice)
    await _updateVaultOracleBtc(newPriceBtc)
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
    ;[vault, vaultFactory, ethSubOracle, btcSubOracle] = await createVault(instanceVars)
    market = await createMarket(instanceVars)
    multiInvoker = await createInvoker(instanceVars, vaultFactory)
  })

  describe('#happy path', async () => {
    const collateral = parse6decimal('1000')
    const dsuCollateral = collateral.mul(1e12)

    it('deposits into market', async () => {
      const { user, dsu } = instanceVars

      const userBalanceBefore = await dsu.balanceOf(user.address)

      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await expect(multiInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(user.address, multiInvoker.address, dsuCollateral)
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvoker.address, market.address, dsuCollateral)

      expect(await dsu.balanceOf(market.address)).to.eq(dsuCollateral)

      const userBalanceAfter = await dsu.balanceOf(user.address)
      expect(userBalanceBefore.sub(userBalanceAfter)).to.eq(dsuCollateral)
    })

    it('withdraws from market', async () => {
      const { user, dsu } = instanceVars

      const userInitialBalance = await dsu.balanceOf(user.address)

      // deposit into market
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await expect(multiInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      const userBalanceBefore = await dsu.balanceOf(user.address)

      await expect(
        multiInvoker
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

      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await expect(multiInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      await expect(
        multiInvoker
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

      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.connect(user).invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
      ).to.not.be.reverted
      expect(await usdc.balanceOf(user.address)).to.eq(userUSDCBalanceBefore.add(collateral))
    })

    it('deposits / redeems / claims from vault', async () => {
      const { user, dsu } = instanceVars

      const userBalanceBefore = await dsu.balanceOf(user.address)
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await expect(multiInvoker.connect(user).invoke(buildApproveTarget(vault.address))).to.not.be.reverted

      // deposit into vault
      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateVault({
            vault: vault.address,
            depositAssets: collateral,
            redeemShares: 0,
            claimAssets: 0,
            wrap: false,
          }),
        ),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(user.address, multiInvoker.address, dsuCollateral)
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvoker.address, vault.address, dsuCollateral)

      expect((await vault.accounts(user.address)).deposit).to.eq(collateral)
      expect((await vault.accounts(user.address)).redemption).to.eq(0)
      expect((await vault.accounts(user.address)).assets).to.eq(0)
      expect((await vault.accounts(user.address)).shares).to.eq(0)

      await updateVaultOracle()
      await vault.settle(user.address)

      // redeem from vault
      await multiInvoker.connect(user).invoke(
        buildUpdateVault({
          vault: vault.address,
          depositAssets: 0,
          redeemShares: ethers.constants.MaxUint256,
          claimAssets: 0,
          wrap: false,
        }),
      )

      expect((await vault.accounts(user.address)).deposit).to.eq(0)
      expect((await vault.accounts(user.address)).redemption).to.eq(collateral)
      expect((await vault.accounts(user.address)).assets).to.eq(0)
      expect((await vault.accounts(user.address)).shares).to.eq(0)

      await updateVaultOracle()
      await vault.settle(user.address)

      const funding = BigNumber.from('23084')
      // claim from vault
      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateVault({
            vault: vault.address,
            depositAssets: 0,
            redeemShares: 0,
            claimAssets: ethers.constants.MaxUint256,
            wrap: false,
          }),
        ),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvoker.address, user.address, dsuCollateral.add(funding.mul(1e12)))
        .to.emit(dsu, 'Transfer')
        .withArgs(vault.address, multiInvoker.address, dsuCollateral.add(funding.mul(1e12)))

      expect((await vault.accounts(user.address)).deposit).to.eq(0)
      expect((await vault.accounts(user.address)).redemption).to.eq(0)
      expect((await vault.accounts(user.address)).assets).to.eq(0)
      expect((await vault.accounts(user.address)).shares).to.eq(0)

      const userBalanceAfter = await dsu.balanceOf(user.address)
      expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(funding.mul(1e12))
    })

    // it('withdraws from market and unwraps DSU to USDC using batcher blah blah', async () => {

    // })

    // TODO rename
    it('approves a market to spend invokers DSU', async () => {
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.be.revertedWith('Dollar: transfer amount exceeds allowance')
    })

    // it('charges fee to an interface', async () => {

    // })
  })

  // describe('#error assertions', async () => {

  // })
})
