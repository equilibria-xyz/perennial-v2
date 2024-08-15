import {
  IVault,
  IVaultFactory,
  Market,
  MultiInvoker,
  IEmptySetReserve__factory,
  IBatcher,
  IBatcher__factory,
  IOracleProvider,
  IEmptySetReserve,
  IMultiInvoker,
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

import {
  buildApproveTarget,
  buildClaimFee,
  buildPlaceOrder,
  buildUpdateIntent,
  buildUpdateMarket,
  buildUpdateVault,
} from '../../helpers/invoke'

import { DEFAULT_ORDER, expectOrderEq, OracleReceipt, parse6decimal } from '../../../../common/testutil/types'
import { expect, use } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { ethers } from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { Compare, Dir, openTriggerOrder } from '../../helpers/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata } from '@equilibria/perennial-v2/types/generated'

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

  async function updateVaultOracle(
    newEthPrice?: BigNumber,
    newPriceBtc?: BigNumber,
    newEthReceipt?: OracleReceipt,
    newBtcReceipt?: OracleReceipt,
  ) {
    await _updateVaultOracleEth(newEthPrice, newEthReceipt)
    await _updateVaultOracleBtc(newPriceBtc, newBtcReceipt)
  }

  async function _updateVaultOracleEth(newPrice?: BigNumber, newReceipt?: OracleReceipt) {
    const [currentTimestamp, currentPrice] = await ethSubOracle.latest()
    const [, currentReceipt] = await ethSubOracle.at(currentTimestamp)
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    ethSubOracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    ethSubOracle.request.returns()
    ethSubOracle.latest.returns(newVersion)
    ethSubOracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    ethSubOracle.at.whenCalledWith(newVersion.timestamp).returns([newVersion, newReceipt ?? currentReceipt])
  }

  async function _updateVaultOracleBtc(newPrice?: BigNumber, newReceipt?: OracleReceipt) {
    const [currentTimestamp, currentPrice] = await btcSubOracle.latest()
    const [, currentReceipt] = await btcSubOracle.at(currentTimestamp)
    const newVersion = {
      timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    btcSubOracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
    btcSubOracle.request.returns()
    btcSubOracle.latest.returns(newVersion)
    btcSubOracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
    btcSubOracle.at.whenCalledWith(newVersion.timestamp).returns([newVersion, newReceipt ?? currentReceipt])
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

    await expect(
      multiInvoker.connect(user)['invoke((uint8,bytes)[])'](buildApproveTarget(userB.address)),
    ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
  })

  describe('#updateOperator', () => {
    it('sets operator as enabled', async () => {
      const { user, userD } = instanceVars
      await expect(multiInvoker.connect(user).updateOperator(userD.address, true))
        .to.emit(multiInvoker, 'OperatorUpdated')
        .withArgs(user.address, userD.address, true)
      expect(await multiInvoker.operators(user.address, userD.address)).to.be.true
    })

    it('sets an operator as disabled', async () => {
      const { user, userD } = instanceVars
      await multiInvoker.connect(user).updateOperator(userD.address, true)
      expect(await multiInvoker.operators(user.address, userD.address)).to.be.true
      await expect(multiInvoker.connect(user).updateOperator(userD.address, false))
        .to.emit(multiInvoker, 'OperatorUpdated')
        .withArgs(user.address, userD.address, false)
      expect(await multiInvoker.operators(user.address, userD.address)).to.be.false
    })
  })

  const testCases = [
    {
      context: 'From user',
      setup: async () => true,
      invoke: async (args: IMultiInvoker.InvocationStruct[]) => {
        const { user } = instanceVars
        return multiInvoker.connect(user)['invoke((uint8,bytes)[])'](args)
      },
    },
    {
      context: 'From delegate',
      setup: async () => {
        const { user, userD } = instanceVars
        await multiInvoker.connect(user).updateOperator(userD.address, true)
      },
      invoke: async (args: IMultiInvoker.InvocationStruct[]) => {
        const { user, userD } = instanceVars
        return multiInvoker.connect(userD)['invoke(address,(uint8,bytes)[])'](user.address, args)
      },
    },
  ]

  testCases.forEach(({ context: contextStr, setup, invoke }) => {
    context(contextStr, async () => {
      beforeEach(async () => {
        await setup()
      })

      describe('#happy path', async () => {
        const collateral = parse6decimal('1000')
        const dsuCollateral = collateral.mul(1e12)

        it('deposits into market', async () => {
          const { user, dsu } = instanceVars

          const userBalanceBefore = await dsu.balanceOf(user.address)

          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral })))
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
          await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be.reverted

          const userBalanceBefore = await dsu.balanceOf(user.address)

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1) })))
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
          await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

          const batcher = IBatcher__factory.connect(BATCHER, owner)

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })))
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
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(
            multiInvoker
              .connect(userB)
              ['invoke((uint8,bytes)[])'](
                buildUpdateMarket({ market: market.address, collateral: drainBatcherByFixed6, handleWrap: true }),
              ),
          )
            .to.emit(batcher, 'Wrap')
            .withArgs(multiInvoker.address, drainBatcherByFixed6.mul(1e12))

          await usdc.connect(user).approve(multiInvoker.address, collateral)
          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })))
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
          await setup()
          expect(await multiInvoker.batcher()).to.eq(ZERO_ADDR)

          await usdc.connect(user).approve(multiInvoker.address, collateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })))
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
          await invoke(buildApproveTarget(market.address))

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })))
            .to.not.be.reverted

          await expect(
            await invoke(
              buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true }),
            ),
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
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(
            multiInvoker.connect(userB)['invoke((uint8,bytes)[])'](
              buildUpdateMarket({
                market: market.address,
                collateral: drainBatcherByFixed6,
                handleWrap: false,
              }),
            ),
          ).to.not.be.reverted

          // drain batcher usdc balance on withdraw and unwrap by batcher balance - collateral + 1
          await expect(
            multiInvoker.connect(userB)['invoke((uint8,bytes)[])'](
              buildUpdateMarket({
                market: market.address,
                collateral: drainBatcherByFixed6.mul(-1),
                handleWrap: true,
              }),
            ),
          ).to.not.be.reverted

          // user deposits DSU then withdraws and unwraps USDC
          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: false }))
          await expect(
            invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul('-1'), handleWrap: true })),
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
          await setup()
          expect(await multiInvoker.batcher()).to.eq(ZERO_ADDR)

          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: false }))

          await expect(
            invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul('-1'), handleWrap: true })),
          )
            .to.emit(reserve, 'Redeem')
            .withArgs(multiInvoker.address, dsuCollateral, anyValue)
        })

        it('withdraws total collateral amount if using collateral magic value', async () => {
          const { user, owner, usdc, dsu } = instanceVars
          const batcher = IBatcher__factory.connect(BATCHER, owner)

          await usdc.connect(user).approve(multiInvoker.address, collateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))
          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

          await invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true }))
          await expect(
            invoke(
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
          await expect(invoke(buildApproveTarget(vault.address))).to.not.be.reverted

          // deposit into vault
          await expect(
            invoke(
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
          await invoke(
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

          const funding = BigNumber.from('14352')
          // claim from vault
          await expect(
            invoke(
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
            invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
          ).to.be.revertedWith('Dollar: transfer amount exceeds allowance')
        })

        it('charges an interface fee on deposit and pulls USDC to the receiver', async () => {
          const { owner, user, usdc, dsu } = instanceVars

          const balanceBefore = await usdc.balanceOf(owner.address)
          const feeAmt = collateral.div(10)
          await usdc.connect(user).approve(multiInvoker.address, collateral.add(feeAmt))
          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(
            invoke(
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
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(
            invoke(
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
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be.reverted

          await expect(
            invoke(
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
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be.reverted

          await expect(
            invoke(
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
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await expect(
            invoke(
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

        it('sets subtractive fee referrer as interface1.receiver if set', async () => {
          const { marketFactory, owner, user, usdc, dsu } = instanceVars

          await marketFactory.updateParameter({
            ...(await marketFactory.parameter()),
            referralFee: parse6decimal('0.05'),
          })
          await usdc.connect(user).approve(multiInvoker.address, collateral)
          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await invoke(
            buildUpdateMarket({
              market: market.address,
              collateral: collateral,
              maker: parse6decimal('0.02'),
              interfaceFee1: {
                amount: 0,
                receiver: owner.address,
                unwrap: true,
              },
            }),
          )

          expect(await market.orderReferrers(user.address, (await market.locals(user.address)).currentId)).to.eq(
            owner.address,
          )
        })

        it('sets subtractive fee referrer as interfaceFee2.receiver if interfaceFee1.receiver is not set', async () => {
          const { marketFactory, userB, user, usdc, dsu } = instanceVars

          await marketFactory.updateParameter({
            ...(await marketFactory.parameter()),
            referralFee: parse6decimal('0.05'),
          })
          await usdc.connect(user).approve(multiInvoker.address, collateral)
          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          await invoke(
            buildUpdateMarket({
              market: market.address,
              collateral: collateral,
              maker: parse6decimal('0.01'),
              interfaceFee1: {
                amount: 0,
                receiver: ethers.constants.AddressZero,
                unwrap: false,
              },
              interfaceFee2: {
                amount: 0,
                receiver: userB.address,
                unwrap: false,
              },
            }),
          )

          expect(await market.orderReferrers(user.address, (await market.locals(user.address)).currentId)).to.eq(
            userB.address,
          )
        })

        it('fills an intent update', async () => {
          const { marketFactory, owner, user, userB, userC, usdc, dsu, verifier, chainlink } = instanceVars

          await marketFactory.updateParameter({
            ...(await marketFactory.parameter()),
            referralFee: parse6decimal('0.05'),
          })
          await usdc.connect(user).approve(multiInvoker.address, collateral)
          await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
          await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

          const intent = {
            amount: parse6decimal('1'),
            price: parse6decimal('125'),
            fee: parse6decimal('0.5'),
            originator: userC.address,
            solver: owner.address,
            common: {
              account: userB.address,
              signer: userB.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: constants.MaxUint256,
            },
          }

          await dsu.connect(user).approve(market.address, ethers.utils.parseUnits('1000', 18))
          await dsu.connect(userB).approve(market.address, ethers.utils.parseUnits('1000', 18))
          await dsu.connect(userC).approve(market.address, ethers.utils.parseUnits('1000', 18))
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              0,
              ethers.utils.parseUnits('1000', 6),
              false,
            )
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              0,
              0,
              0,
              ethers.utils.parseUnits('1000', 6),
              false,
            )
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              parse6decimal('1'),
              0,
              0,
              ethers.utils.parseUnits('1000', 6),
              false,
            )

          await invoke(
            await buildUpdateIntent({
              signer: userB,
              verifier: verifier,
              market: market.address,
              intent,
            }),
          )
          const intentTimestamp = await chainlink.oracle.current()

          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: intentTimestamp,
            orders: 1,
            shortPos: parse6decimal('1'),
            collateral: ethers.utils.parseUnits('1000', 6),
            takerReferral: parse6decimal('0.05'),
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: intentTimestamp,
            orders: 1,
            longPos: parse6decimal('1'),
            collateral: ethers.utils.parseUnits('1000', 6),
          })
        })

        describe('#market with claimable fee', async () => {
          let user: SignerWithAddress
          let userB: SignerWithAddress
          let batcher: IBatcher
          let dsu: IERC20Metadata
          let usdc: IERC20Metadata

          beforeEach(async () => {
            user = instanceVars.user
            userB = instanceVars.userB
            dsu = instanceVars.dsu
            usdc = instanceVars.usdc
            const { marketFactory, owner, chainlink } = instanceVars
            batcher = IBatcher__factory.connect(BATCHER, owner)
            await dsu.connect(user).approve(market.address, parse6decimal('600').mul(1e12))
            await dsu.connect(userB).approve(market.address, parse6decimal('600').mul(1e12))
            // set up the market to pay out a maker referral fee
            const protocolParameters = await marketFactory.parameter()
            await marketFactory.connect(owner).updateParameter({
              ...protocolParameters,
              referralFee: parse6decimal('0.15'),
            })
            const marketParams = await market.parameter()
            await market.connect(owner).updateParameter({
              ...marketParams,
              makerFee: parse6decimal('0.05'),
            })

            // userB creates a maker position, referred by user
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool,address)'](
                userB.address,
                parse6decimal('3'),
                0,
                0,
                parse6decimal('600'),
                false,
                user.address,
              )
            await chainlink.next()
            await market.connect(user).settle(user.address)
            await market.connect(userB).settle(userB.address)
          })

          it('claims fee from a market', async () => {
            const expectedFee = (await market.locals(user.address)).claimable

            // user invokes to claim their fee
            await expect(invoke(buildClaimFee({ market: market.address, unwrap: true })))
              .to.emit(market, 'FeeClaimed')
              .withArgs(user.address, multiInvoker.address, expectedFee)
              .to.emit(batcher, 'Unwrap')
              .withArgs(user.address, expectedFee.mul(1e12))
              .to.emit(usdc, 'Transfer')
              .withArgs(batcher.address, user.address, expectedFee)
          })

          it('claims fee from a market without unwrapping', async () => {
            const expectedFee = (await market.locals(user.address)).claimable

            // user invokes to claim their fee
            await expect(invoke(buildClaimFee({ market: market.address, unwrap: false })))
              .to.emit(market, 'FeeClaimed')
              .withArgs(user.address, multiInvoker.address, expectedFee)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, user.address, expectedFee.mul(1e12))
          })
        })

        it('Only allows updates to factory created markets', async () => {
          await expect(
            invoke(buildUpdateMarket({ market: vault.address, collateral: collateral })),
          ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
        })

        it('Only allows updates to factory created vaults', async () => {
          await expect(invoke(buildUpdateVault({ vault: market.address }))).to.be.revertedWithCustomError(
            multiInvoker,
            'MultiInvokerInvalidInstanceError',
          )
        })

        it('Only allows liquidations to factory created markets', async () => {
          await expect(invoke(buildUpdateMarket({ market: vault.address }))).to.be.revertedWithCustomError(
            multiInvoker,
            'MultiInvokerInvalidInstanceError',
          )
        })

        it('Fails to place an order in an address not created by MarketFactory', async () => {
          const trigger = openTriggerOrder({
            delta: collateral,
            price: 1100e6,
            side: Dir.L,
            comparison: Compare.ABOVE_MARKET,
          })
          await expect(
            invoke(buildPlaceOrder({ market: vault.address, collateral: collateral, order: trigger })),
          ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
        })

        describe('#batcher 0 address', async () => {
          let instanceVars: InstanceVars
          let market: Market
          let reserve: IEmptySetReserve

          beforeEach(async () => {
            instanceVars = await loadFixture(deployProtocol)
            ;[vault, vaultFactory, ethSubOracle, btcSubOracle] = await createVault(instanceVars)
            market = await createMarket(instanceVars)
            multiInvoker = await createInvoker(instanceVars, vaultFactory, true)
            await setup()
            reserve = IEmptySetReserve__factory.connect(RESERVE, instanceVars.owner)

            await instanceVars.usdc.connect(instanceVars.user).approve(multiInvoker.address, collateral)
            await multiInvoker.connect(instanceVars.user)['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))
          })

          it('Wraps USDC to DSU through RESERVE and unwraps DSU to USDC through RESERVE if BATCHER address == 0', async () => {
            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
            )
              .to.emit(reserve, 'Mint')
              .withArgs(multiInvoker.address, dsuCollateral, anyValue)

            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
            )
              .to.emit(reserve, 'Redeem')
              .withArgs(multiInvoker.address, dsuCollateral, anyValue)
          })
        })
      })
    })
  })

  describe('unauthorized invoke', async () => {
    it('reverts on unauthorized invoke', async () => {
      const { user, userB } = instanceVars
      await expect(
        multiInvoker.connect(user)['invoke(address,(uint8,bytes)[])'](userB.address, [
          {
            action: 0,
            args: '0x',
          },
        ]),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerUnauthorizedError')
    })
  })
})
