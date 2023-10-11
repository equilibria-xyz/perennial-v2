import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, createInvoker } from '../helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { buildLiquidateUser, buildUpdateMarket } from '../../helpers/invoke'

export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005
export const TIMESTAMP_4 = 1631118731

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()
  })

  it('liquidates a user', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, usdc, chainlink } = instanceVars

    const multiInvoker = await createInvoker(instanceVars)
    const market = await createMarket(instanceVars)

    // approve market to spend invoker's dsu
    await multiInvoker
      .connect(user)
      .invoke([{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }])
    await dsu.connect(user).approve(multiInvoker.address, COLLATERAL.mul(1e12))

    await multiInvoker
      .connect(user)
      .invoke(buildUpdateMarket({ market: market.address, maker: POSITION, collateral: COLLATERAL }))
    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    const EXPECTED_LIQUIDATION_FEE = (await chainlink.oracle.latest()).price
      .mul((await chainlink.oracle.latest()).price)
      .div(1e6)
      .mul(POSITION)
      .div(1e6)
      .mul((await market.riskParameter()).maintenance)
      .div(1e6)
      .mul((await market.riskParameter()).liquidationFee)
      .div(1e6)

    const userBUSDCBalance = await usdc.balanceOf(userB.address)
    await expect(multiInvoker.connect(userB).invoke(buildLiquidateUser({ market: market.address, user: user.address })))
      .to.emit(market, 'Updated')
      .withArgs(multiInvoker.address, user.address, TIMESTAMP_2, 0, 0, 0, EXPECTED_LIQUIDATION_FEE.mul(-1), true)

    expect((await market.locals(user.address)).protection).to.eq(TIMESTAMP_2)

    expect((await market.locals(user.address)).collateral).to.equal('317221012')
    expect(await dsu.balanceOf(market.address)).to.equal(utils.parseEther('317.221012'))
    expect((await usdc.balanceOf(userB.address)).sub(userBUSDCBalance)).to.equal(parse6decimal('682.778988')) // Original 200000000 + fee

    await chainlink.next()
    await market.connect(user).update(user.address, 0, 0, 0, constants.MinInt256, false) // withdraw everything

    expect((await market.position()).timestamp).to.eq(TIMESTAMP_2)
    expect((await market.locals(user.address)).protection).to.eq(TIMESTAMP_2)
  })

  it('liquidates a user w/ partial liquidation', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, usdc, chainlink } = instanceVars

    const multiInvoker = await createInvoker(instanceVars)
    const market = await createMarket(instanceVars)

    // approve market to spend invoker's dsu
    await multiInvoker
      .connect(user)
      .invoke([{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }])
    await dsu.connect(user).approve(multiInvoker.address, COLLATERAL.mul(1e12))

    await multiInvoker
      .connect(user)
      .invoke(buildUpdateMarket({ market: market.address, maker: POSITION, collateral: COLLATERAL }))

    // Settle the market with a new oracle version
    chainlink.delay = 2
    await chainlink.next()

    await multiInvoker
      .connect(user)
      .invoke(buildUpdateMarket({ market: market.address, maker: POSITION.mul(3).div(2), collateral: 0 }))

    await chainlink.nextWithPriceModification(price => price.mul(2))

    const EXPECTED_LIQUIDATION_FEE = (await chainlink.oracle.latest()).price
      .mul((await chainlink.oracle.latest()).price)
      .div(1e6)
      .mul(POSITION)
      .div(1e6)
      .mul((await market.riskParameter()).maintenance)
      .div(1e6)
      .mul((await market.riskParameter()).liquidationFee)
      .div(1e6)

    const userBUSDCBalance = await usdc.balanceOf(userB.address)
    await expect(multiInvoker.connect(userB).invoke(buildLiquidateUser({ market: market.address, user: user.address })))
      .to.emit(market, 'Updated')
      .withArgs(
        multiInvoker.address,
        user.address,
        TIMESTAMP_3,
        POSITION.div(2),
        0,
        0,
        EXPECTED_LIQUIDATION_FEE.mul(-1),
        true,
      )

    expect((await market.locals(user.address)).protection).to.eq(TIMESTAMP_3)

    expect((await market.locals(user.address)).collateral).to.equal('317221012')
    expect(await dsu.balanceOf(market.address)).to.equal(utils.parseEther('317.221012'))
    expect((await usdc.balanceOf(userB.address)).sub(userBUSDCBalance)).to.equal(parse6decimal('682.778988')) // Original 200000000 + fee

    await chainlink.next()
    await chainlink.next()

    const EXPECTED_LIQUIDATION_FEE_2 = (await market.riskParameter()).minMaintenance
      .mul((await market.riskParameter()).liquidationFee)
      .div(1e6)

    await expect(multiInvoker.connect(userB).invoke(buildLiquidateUser({ market: market.address, user: user.address })))
      .to.emit(market, 'Updated')
      .withArgs(multiInvoker.address, user.address, TIMESTAMP_4, 0, 0, 0, EXPECTED_LIQUIDATION_FEE_2.mul(-1), true)

    await chainlink.next()
    await chainlink.next()
    await market.connect(user).update(user.address, 0, 0, 0, constants.MinInt256, false) // withdraw everything

    expect((await market.position()).timestamp).to.eq(TIMESTAMP_4)
    expect((await market.locals(user.address)).protection).to.eq(TIMESTAMP_4)

    chainlink.delay = 1 // cleanup
  })

  it('Liquidate a user when price drops after in-state latest', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const multiInvoker = await createInvoker(instanceVars)
    const market = await createMarket(instanceVars)

    const protocolParameter = { ...(await instanceVars.marketFactory.parameter()) }
    protocolParameter.maxFeeAbsolute = parse6decimal('1000000')
    await instanceVars.marketFactory.updateParameter(protocolParameter)

    const riskParameter = { ...(await market.riskParameter()) }
    riskParameter.minMaintenance = parse6decimal('0')
    riskParameter.maxLiquidationFee = parse6decimal('1000000')
    await market.updateRiskParameter(riskParameter)

    await chainlink.next()

    // approve DSU transfers
    await multiInvoker
      .connect(user)
      .invoke([{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }])
    await dsu.connect(user).approve(multiInvoker.address, COLLATERAL.mul(1e12))

    // open position
    await multiInvoker
      .connect(user)
      .invoke(buildUpdateMarket({ market: market.address, maker: POSITION, collateral: COLLATERAL }))

    // get oracle version ahead of market so MultiInvoker _liquidationFee calc is too high
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await chainlink.nextWithPriceModification(price => price.mul(2).sub(parse6decimal('100'))) // drop price before liquidation

    // liquidate through invoker
    await expect(multiInvoker.connect(userB).invoke(buildLiquidateUser({ market: market.address, user: user.address })))
      .to.be.not.reverted
  })

  it('soft reverts on failed liquidation', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu } = instanceVars

    const multiInvoker = await createInvoker(instanceVars)
    const market = await createMarket(instanceVars)

    // approve market to spend invoker's dsu
    await multiInvoker
      .connect(user)
      .invoke([{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }])
    await dsu.connect(user).approve(multiInvoker.address, COLLATERAL.mul(1e12))

    await multiInvoker
      .connect(user)
      .invoke(buildUpdateMarket({ market: market.address, maker: POSITION, collateral: COLLATERAL }))

    expect(
      multiInvoker
        .connect(userB)
        .invoke(buildLiquidateUser({ market: market.address, user: user.address, revertOnFailure: true })),
    ).to.be.revertedWithPanic

    await expect(
      multiInvoker
        .connect(userB)
        .invoke(buildLiquidateUser({ market: market.address, user: user.address, revertOnFailure: false })),
    ).to.not.be.reverted
  })
})
