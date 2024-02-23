import {
  IVault,
  IVaultFactory,
  Market,
  MultiInvoker,
  IEmptySetReserve__factory,
  IBatcher__factory,
  IOracleProvider,
  IEmptySetReserve,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  BATCHER,
  InstanceVars,
  RESERVE,
  createInvoker,
  createMarket,
  deployProtocol,
  fundWallet,
  createVault,
  fundWalletUSDC,
  ZERO_ADDR,
  DSU,
  ETH_ORACLE,
} from '../helpers/setupHelpers'

import { buildApproveTarget, buildPlaceOrder, buildUpdateMarket, buildUpdateVault } from '../../helpers/invoke'

import { parse6decimal } from '../../../../common/testutil/types'
import { expect, use } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { Compare, Dir, openTriggerOrder } from '../../helpers/types'

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

  it('constructs correctly', async () => {
    const { usdc, dsu } = instanceVars
    expect(await multiInvoker.batcher()).to.eq(BATCHER)
    expect(await multiInvoker.reserve()).to.eq(RESERVE)
    expect(await multiInvoker.USDC()).to.eq(usdc.address)
    expect(await multiInvoker.DSU()).to.eq(dsu.address)
    expect(await multiInvoker.latestNonce()).to.eq(0)
  })

  it('initializes correctly', async () => {
    const { owner, dsu, usdc } = instanceVars

    expect(await multiInvoker.keeperToken()).to.eq(DSU)
    expect(await multiInvoker.ethTokenOracleFeed()).to.eq(ETH_ORACLE)

    expect(await dsu.allowance(multiInvoker.address, BATCHER)).to.eq(ethers.constants.MaxUint256)
    expect(await dsu.allowance(multiInvoker.address, BATCHER)).to.eq(ethers.constants.MaxUint256)
    expect(await usdc.allowance(multiInvoker.address, RESERVE)).to.eq(ethers.constants.MaxUint256)
    expect(await usdc.allowance(multiInvoker.address, RESERVE)).to.eq(ethers.constants.MaxUint256)

    await expect(multiInvoker.connect(owner).initialize(ETH_ORACLE)).to.be.revertedWithCustomError(
      multiInvoker,
      'InitializableAlreadyInitializedError',
    )
  })

  it('reverts on bad target approval', async () => {
    const { user, userB } = instanceVars
    multiInvoker = await createInvoker(instanceVars, vaultFactory)

    await expect(multiInvoker.connect(user).invoke(buildApproveTarget(userB.address))).to.be.revertedWithCustomError(
      multiInvoker,
      'MultiInvokerInvalidInstanceError',
    )
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
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, multiInvoker.address, dsuCollateral)
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvoker.address, user.address, dsuCollateral)

      const userBalanceAfter = await dsu.balanceOf(user.address)

      expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(dsuCollateral)
      expect(userBalanceAfter).to.eq(userInitialBalance)
    })

    it('wraps USDC to DSU and deposits into market using BATCHER', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const userBalanceBefore = await usdc.balanceOf(user.address)

      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await expect(multiInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      const batcher = IBatcher__factory.connect(BATCHER, owner)

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, collateral)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvoker.address, dsuCollateral)

      const userBalanceAfter = await usdc.balanceOf(user.address)

      expect(userBalanceBefore.sub(userBalanceAfter).eq(collateral))
      expect(await dsu.balanceOf(market.address)).to.eq(dsuCollateral)
    })

    it('wraps USDC to DSU and deposits into market using RESERVE if BATCHER balance < collateral', async () => {
      const { owner, user, userB, usdc, dsu } = instanceVars

      const reserve = IEmptySetReserve__factory.connect(RESERVE, owner)
      const batcher = IBatcher__factory.connect(BATCHER, owner)

      // userB uses collateral - 1 from batcher wrap
      const drainBatcherByFixed6 = (await dsu.balanceOf(BATCHER)).div(1e12).sub(collateral).add(parse6decimal('1'))
      await fundWalletUSDC(usdc, userB, drainBatcherByFixed6)

      await usdc.connect(userB).approve(multiInvoker.address, drainBatcherByFixed6)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker
          .connect(userB)
          .invoke(buildUpdateMarket({ market: market.address, collateral: drainBatcherByFixed6, handleWrap: true })),
      )
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvoker.address, drainBatcherByFixed6.mul(1e12))

      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      )
        .to.emit(reserve, 'Mint')
        .withArgs(multiInvoker.address, dsuCollateral, anyValue)
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvoker.address, market.address, dsuCollateral)
    })

    it('wraps USDC to DSU and deposits into market using RESERVE if BATCHER address == 0', async () => {
      const { owner, user, usdc } = instanceVars

      const reserve = IEmptySetReserve__factory.connect(RESERVE, owner)
      // deploy multiinvoker with batcher == 0 address
      multiInvoker = await createInvoker(instanceVars, vaultFactory, true)
      expect(await multiInvoker.batcher()).to.eq(ZERO_ADDR)

      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      )
        .to.emit(reserve, 'Mint')
        .withArgs(multiInvoker.address, dsuCollateral, anyValue)
    })

    it('withdraws from market and unwraps DSU to USDC using BATCHER', async () => {
      const { owner, user, userB, dsu, usdc } = instanceVars

      const batcher = IBatcher__factory.connect(BATCHER, owner)
      const userUSDCBalanceBefore = await usdc.balanceOf(user.address)

      await fundWalletUSDC(usdc, userB)
      await usdc.connect(userB).transfer(BATCHER, collateral)

      await fundWalletUSDC(usdc, user)
      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.connect(user).invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      ).to.not.be.reverted

      await expect(
        await multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, multiInvoker.address, dsuCollateral)
        .to.emit(batcher, 'Unwrap')
        .withArgs(user.address, dsuCollateral)

      expect((await usdc.balanceOf(user.address)).sub(userUSDCBalanceBefore)).to.eq(collateral)
    })

    it('withdraws from market and unwraps DSU to USDC using RESERVE if BATCHER balance < collateral', async () => {
      const { owner, user, userB, usdc, dsu } = instanceVars

      const reserve = IEmptySetReserve__factory.connect(RESERVE, owner)

      // userB uses collateral - 1 from batcher wrap
      const drainBatcherByFixed6 = (await usdc.balanceOf(BATCHER)).sub(collateral).add(1)
      // const drainBatcherByFixed6 = (await dsu.balanceOf(BATCHER)).div(1e12).sub(collateral).add(parse6decimal('1'))
      await fundWallet(dsu, usdc, userB, drainBatcherByFixed6)
      await dsu.connect(userB).approve(multiInvoker.address, drainBatcherByFixed6.mul(1e12))
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(userB).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: drainBatcherByFixed6,
            handleWrap: false,
          }),
        ),
      ).to.not.be.reverted

      // drain batcher usdc balance on withdraw and unwrap by batcher balance - collateral + 1
      await expect(
        multiInvoker.connect(userB).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: drainBatcherByFixed6.mul(-1),
            handleWrap: true,
          }),
        ),
      ).to.not.be.reverted

      // user deposits DSU then withdraws and unwraps USDC
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker
        .connect(user)
        .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: false }))
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul('-1'), handleWrap: true })),
      )
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvoker.address, dsuCollateral, anyValue)
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, multiInvoker.address, dsuCollateral)
    })

    it('withdraws from market and unwraps DSU to USDC using RESERVE if BATCHER address == 0', async () => {
      const { owner, user, dsu } = instanceVars

      const reserve = IEmptySetReserve__factory.connect(RESERVE, owner)
      // deploy multiinvoker with batcher == 0 address
      multiInvoker = await createInvoker(instanceVars, vaultFactory, true)
      expect(await multiInvoker.batcher()).to.eq(ZERO_ADDR)

      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await multiInvoker
        .connect(user)
        .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: false }))

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul('-1'), handleWrap: true })),
      )
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvoker.address, dsuCollateral, anyValue)
    })

    it('withdraws total collateral amount if using collateral magic value', async () => {
      const { user, owner, usdc, dsu } = instanceVars
      const batcher = IBatcher__factory.connect(BATCHER, owner)

      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

      await multiInvoker
        .connect(user)
        .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true }))
      await expect(
        multiInvoker
          .connect(user)
          .invoke(
            buildUpdateMarket({ market: market.address, collateral: ethers.constants.MinInt256, handleWrap: true }),
          ),
      )
        .to.emit(batcher, 'Unwrap')
        .withArgs(user.address, dsuCollateral)
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

      const funding = BigNumber.from('18411')
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

    it('requires market approval to spend invokers DSU', async () => {
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.be.revertedWith('Dollar: transfer amount exceeds allowance')
    })

    it('charges an interface fee on deposit and pulls USDC to the receiver', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const balanceBefore = await usdc.balanceOf(owner.address)
      const feeAmt = collateral.div(10)
      await usdc.connect(user).approve(multiInvoker.address, collateral.add(feeAmt))
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral,
            interfaceFee1: {
              amount: feeAmt,
              receiver: owner.address,
              unwrap: true,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, true])

      expect((await usdc.balanceOf(owner.address)).sub(balanceBefore)).to.eq(feeAmt)
    })

    it('charges an interface fee on deposit and wraps USDC to DSU to the receiver', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const balanceBefore = await dsu.balanceOf(owner.address)
      const feeAmt = collateral.div(10)
      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral.add(feeAmt.mul(1e12)))
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral,
            interfaceFee1: {
              amount: feeAmt,
              receiver: owner.address,
              unwrap: false,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, false])

      expect((await dsu.balanceOf(owner.address)).sub(balanceBefore)).to.eq(feeAmt.mul(1e12))
    })

    it('charges an interface fee on withdrawal, wraps DSU fee to USDC, and pushes USDC to the receiver', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const balanceBefore = await usdc.balanceOf(owner.address)
      const feeAmt = collateral.div(10)
      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral.sub(feeAmt).mul(-1),
            interfaceFee1: {
              amount: feeAmt,
              receiver: owner.address,
              unwrap: true,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, true])

      expect((await usdc.balanceOf(owner.address)).sub(balanceBefore)).to.eq(feeAmt)
    })

    it('charges an interface fee on withdrawal and pushes DSU to the receiver', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const balanceBefore = await dsu.balanceOf(owner.address)
      const feeAmt = collateral.div(10)
      await usdc.connect(user).approve(multiInvoker.address, collateral)
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral.sub(feeAmt).mul(-1),
            interfaceFee1: {
              amount: feeAmt,
              receiver: owner.address,
              unwrap: false,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, false])

      expect((await dsu.balanceOf(owner.address)).sub(balanceBefore)).to.eq(feeAmt.mul(1e12))
    })

    it('charges multiple interface fees', async () => {
      const { owner, user, userB, usdc, dsu } = instanceVars

      const balanceBefore = await usdc.balanceOf(owner.address)
      const balanceBefore2 = await dsu.balanceOf(userB.address)
      const feeAmt = collateral.div(10)
      const feeAmt2 = collateral.div(20)
      await usdc.connect(user).approve(multiInvoker.address, collateral.add(feeAmt))
      await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
      await multiInvoker.invoke(buildApproveTarget(market.address))

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral,
            interfaceFee1: {
              amount: feeAmt,
              receiver: owner.address,
              unwrap: true,
            },
            interfaceFee2: {
              amount: feeAmt2,
              receiver: userB.address,
              unwrap: false,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, true])
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt2, userB.address, false])

      expect((await usdc.balanceOf(owner.address)).sub(balanceBefore)).to.eq(feeAmt)
      expect((await dsu.balanceOf(userB.address)).sub(balanceBefore2)).to.eq(feeAmt2.mul(1e12))
    })

    it('Only allows updates to factory created markets', async () => {
      const { user } = instanceVars

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: vault.address, collateral: collateral })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
    })

    it('Only allows updates to factory created vaults', async () => {
      const { user } = instanceVars

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateVault({ vault: market.address })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
    })

    it('Only allows liquidations to factory created markets', async () => {
      const { user } = instanceVars

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: vault.address })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
    })

    it('Fails to place an order in an address not created by MarketFactory', async () => {
      const { user } = instanceVars

      const trigger = openTriggerOrder({
        delta: collateral,
        price: 1100e6,
        side: Dir.L,
        comparison: Compare.ABOVE_MARKET,
      })
      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildPlaceOrder({ market: vault.address, collateral: collateral, order: trigger })),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
    })

    describe('#batcher 0 address', async () => {
      let instanceVars: InstanceVars
      let noBatcherInvoker: MultiInvoker
      let market: Market
      let reserve: IEmptySetReserve

      beforeEach(async () => {
        instanceVars = await loadFixture(deployProtocol)
        ;[vault, vaultFactory, ethSubOracle, btcSubOracle] = await createVault(instanceVars)
        market = await createMarket(instanceVars)
        noBatcherInvoker = await createInvoker(instanceVars, vaultFactory, true)
        reserve = IEmptySetReserve__factory.connect(RESERVE, instanceVars.owner)

        await instanceVars.usdc.connect(instanceVars.user).approve(noBatcherInvoker.address, collateral)
        await noBatcherInvoker.connect(instanceVars.user).invoke(buildApproveTarget(market.address))
      })

      it('Wraps USDC to DSU through RESERVE and unwraps DSU to USDC through RESERVE if BATCHER address == 0', async () => {
        const { user } = instanceVars
        await expect(
          noBatcherInvoker
            .connect(user)
            .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
        )
          .to.emit(reserve, 'Mint')
          .withArgs(multiInvoker.address, dsuCollateral, anyValue)

        await expect(
          noBatcherInvoker
            .connect(user)
            .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
        )
          .to.emit(reserve, 'Redeem')
          .withArgs(multiInvoker.address, dsuCollateral, anyValue)
      })
    })
  })
})
