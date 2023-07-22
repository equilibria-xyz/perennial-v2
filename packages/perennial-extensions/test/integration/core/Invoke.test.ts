import { Market, MultiInvoker } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InstanceVars, createInvoker, createMarket, deployProtocol } from '../helpers/setupHelpers'
import { buildApproveTarget, buildUpdateMarket } from '../../helpers/invoke'
import { parse6decimal } from '../../../../common/testutil/types'
import { expect, use } from 'chai'
import { smock } from '@defi-wonderland/smock'

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
