import {
  Market,
  MultiInvoker,
  IEmptySetReserve__factory,
  IEmptySetReserve,
  MultiInvoker__factory,
  IBatcher__factory,
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
  fundWalletUSDC,
} from '../helpers/setupHelpers'
import { buildApproveTarget, buildUpdateMarket } from '../../helpers/invoke'
import { parse6decimal } from '../../../../common/testutil/types'
import { expect, use } from 'chai'
import { smock } from '@defi-wonderland/smock'
import { ethers } from 'hardhat'

use(smock.matchers)

describe('Invoke', () => {
  let instanceVars: InstanceVars
  let mulitInvoker: MultiInvoker
  let market: Market

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)

    market = await createMarket(instanceVars)
    mulitInvoker = await createInvoker(instanceVars)
  })

  describe('#happy path', async () => {
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
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, mulitInvoker.address, dsuCollateral)
        .to.emit(dsu, 'Transfer')
        .withArgs(mulitInvoker.address, user.address, dsuCollateral)

      const userBalanceAfter = await dsu.balanceOf(user.address)

      expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(dsuCollateral)
      expect(userBalanceAfter).to.eq(userInitialBalance)
    })

    it('wraps USDC to DSU and deposits into market', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const userBalanceBefore = await usdc.balanceOf(user.address)

      await usdc.connect(user).approve(mulitInvoker.address, collateral)
      await expect(mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))).to.not.be.reverted

      const batcher = IBatcher__factory.connect(BATCHER, owner)

      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, mulitInvoker.address, collateral)
        .to.emit(batcher, 'Wrap')
        .withArgs(mulitInvoker.address, dsuCollateral)

      const userBalanceAfter = await usdc.balanceOf(user.address)

      expect(userBalanceBefore.sub(userBalanceAfter).eq(collateral))
      expect(await dsu.balanceOf(market.address)).to.eq(dsuCollateral)
    })

    it('wraps USDC to DSU minting from RESERVE and deposits into market', async () => {
      const { owner, user, usdc, dsu } = instanceVars

      const batcherBal = await dsu.balanceOf(BATCHER)
      const usdcDeposit = batcherBal.div(1e12).add(1)

      await fundWalletUSDC(usdc, user, usdcDeposit)
      await usdc.connect(user).approve(mulitInvoker.address, usdcDeposit)

      const reserve = IEmptySetReserve__factory.connect(RESERVE, owner)

      await mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))
      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: usdcDeposit, handleWrap: true })),
      ).to.emit(reserve, 'Mint')

      expect(await dsu.balanceOf(market.address)).to.eq(usdcDeposit.mul(1e12))
    })
    it('withdraws from market and unwraps DSU to USDC', async () => {
      const { user, dsu, usdc } = instanceVars

      const userUSDCBalanceBefore = await usdc.balanceOf(user.address)

      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)
      await mulitInvoker.connect(user).invoke(buildApproveTarget(market.address))

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, mulitInvoker.address, dsuCollateral)

      expect((await usdc.balanceOf(user.address)).sub(userUSDCBalanceBefore)).to.eq(collateral)
    })

    it('withdraws from market and unraps DSU to USDC using RESERVE to redeem', async () => {
      const { owner, user, dsu, usdc } = instanceVars

      const batcherBal = await dsu.balanceOf(BATCHER)
      const dsuDeposit = batcherBal.add(1)
      const usdcWithdrawal = dsuDeposit.div(1e12)

      console.log('FUND')
      await fundWallet(dsu, usdc, user, dsuDeposit)
      return
      await dsu.connect(user).approve(mulitInvoker.address, dsuDeposit)

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: usdcWithdrawal })),
      ).to.not.be.reverted

      const reserve = IEmptySetReserve__factory.connect(RESERVE, owner)
      await expect(
        mulitInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: usdcWithdrawal.mul(-1), handleWrap: true })),
      )
        .to.emit(reserve, 'Redeem')
        .to.emit(usdc, 'Transfer')
        .withArgs(reserve.address, mulitInvoker.address, usdcWithdrawal)
        .to.emit(usdc, 'Transfer')
        .withArgs(mulitInvoker.address, user.address, usdcWithdrawal)
    })

    it('requires market approval to spend invokers DSU', async () => {
      const { user, dsu } = instanceVars

      await dsu.connect(user).approve(mulitInvoker.address, dsuCollateral)

      await expect(
        mulitInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.be.revertedWith('Dollar: transfer amount exceeds allowance')
    })

    it('charges fee to an interface', async () => {
      const { user, userB, usdc } = instanceVars

      const balanceBefore = await usdc.balanceOf(userB.address)

      await usdc.connect(user).approve(mulitInvoker.address, collateral)

      await expect(
        mulitInvoker
          .connect(user)
          .invoke([
            {
              action: 10,
              args: ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [userB.address, collateral]),
            },
          ]),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, userB.address, collateral)

      expect((await usdc.balanceOf(userB.address)).sub(balanceBefore)).to.eq(collateral)
    })
  })
})
