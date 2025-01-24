import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle } from '../helpers/setupHelpers'
import { Market } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

export const TIMESTAMP_3 = 1631114005

describe('Closed Market', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    instanceVars.chainlink.reset()
  })

  it('closes the market', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { owner, user, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)

    expect((await market.parameter()).closed).to.be.false

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await settle(market, owner)

    await chainlink.next()
    const parameters = { ...(await market.parameter()) }
    parameters.closed = true
    await market.updateParameter(parameters)

    expect((await market.parameter()).closed).to.be.true
  })

  describe('changes to system constraints', async () => {
    let market: Market
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')

    beforeEach(async () => {
      const { user, userB, dsu, margin } = instanceVars

      market = await createMarket(instanceVars)
      await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(user).deposit(user.address, COLLATERAL)
      await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
      await margin.connect(userB).deposit(userB.address, COLLATERAL)
      await market
        .connect(user)
        ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
      await market
        .connect(userB)
        ['update(address,int256,int256,int256,address)'](userB.address, 0, POSITION, COLLATERAL, constants.AddressZero)
      const parameters = { ...(await market.parameter()) }
      parameters.closed = true
      await market.updateParameter(parameters)
    })

    it('reverts on new open positions', async () => {
      const { user, chainlink } = instanceVars

      await chainlink.next()

      await expect(
        market
          .connect(user)
          ['update(address,int256,int256,int256,address)'](user.address, 0, POSITION, 0, constants.AddressZero),
      ).to.be.revertedWithCustomError(market, 'MarketClosedError')
    })

    it('allows insufficient liquidity for close positions', async () => {
      const { user, chainlink } = instanceVars

      await chainlink.next()

      await expect(await market.connect(user).close(user.address, false, constants.AddressZero)).to.not.be.reverted
    })
  })

  it('zeroes PnL and fees', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, chainlink, dsu, margin } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, 0, POSITION, COLLATERAL, constants.AddressZero)

    await chainlink.next()
    await chainlink.next()
    const parameters = { ...(await market.parameter()) }
    parameters.closed = true
    await market.updateParameter(parameters)
    await settle(market, user)
    await settle(market, userB)

    const userCollateralBefore = await margin.isolatedBalances(user.address, market.address)
    const userBCollateralBefore = await margin.isolatedBalances(userB.address, market.address)
    const feesABefore = (await market.global()).protocolFee
    const feesBBefore = (await market.global()).oracleFee
    const feesCBefore = (await market.global()).riskFee

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))

    const LIQUIDATION_FEE = BigNumber.from('1000000000')
    await market.connect(user).close(user.address, true, constants.AddressZero)
    await market.connect(userB).close(userB.address, true, constants.AddressZero)

    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(userCollateralBefore)
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(userBCollateralBefore)
    expect((await market.global()).protocolFee).to.equal(feesABefore)
    expect((await market.global()).oracleFee).to.equal(feesBBefore)
    expect((await market.global()).riskFee).to.equal(feesCBefore)
  })

  it('handles closing during liquidations', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, chainlink, dsu, margin } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)
    await market
      .connect(user)
      ['update(address,int256,int256,int256,address)'](user.address, POSITION, 0, COLLATERAL, constants.AddressZero)
    await market
      .connect(userB)
      ['update(address,int256,int256,int256,address)'](userB.address, 0, POSITION, COLLATERAL, constants.AddressZero)

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await expect(market.connect(userB).close(user.address, true, constants.AddressZero)).to.not.be.reverted
    expect((await market.pendingOrders(user.address, 2)).protection).to.eq(1)
    const parameters = { ...(await market.parameter()) }
    parameters.closed = true
    await market.updateParameter(parameters)
    await chainlink.next()

    await settle(market, user)
    await settle(market, userB)

    expect((await market.position()).timestamp).to.eq(TIMESTAMP_3)
    expect((await market.pendingOrders(user.address, 2)).protection).to.eq(1)
    const userCollateralBefore = await margin.isolatedBalances(user.address, market.address)
    const userBCollateralBefore = await margin.isolatedBalances(userB.address, market.address)
    const feesABefore = (await market.global()).protocolFee
    const feesBBefore = (await market.global()).oracleFee
    const feesCBefore = (await market.global()).riskFee

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))

    await settle(market, user)
    await market.connect(userB).close(userB.address, true, constants.AddressZero)

    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(userCollateralBefore)
    expect(await margin.isolatedBalances(userB.address, market.address)).to.equal(userBCollateralBefore)
    expect((await market.global()).protocolFee).to.equal(feesABefore)
    expect((await market.global()).oracleFee).to.equal(feesBBefore)
    expect((await market.global()).riskFee).to.equal(feesCBefore)
  })
})
