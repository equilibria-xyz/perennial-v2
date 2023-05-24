import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, INITIAL_VERSION } from '../helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('liquidates a user', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    await expect(market.connect(userB).settle(user.address)) // liquidate
      .to.emit(market, 'Liquidation')
      .withArgs(user.address, userB.address, '682778988')

    expect((await market.locals(user.address)).liquidation).to.eq(INITIAL_VERSION + 2)

    expect((await market.locals(user.address)).collateral).to.equal('317221012')
    expect(await dsu.balanceOf(market.address)).to.equal(utils.parseEther('317.221012'))
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('200682.778988')) // Original 200000 + fee

    await chainlink.next()
    await market.settle(user.address)

    expect((await market.position()).version).to.eq(INITIAL_VERSION + 2)
    expect((await market.locals(user.address)).liquidation).to.eq(INITIAL_VERSION + 2)
  })

  it('liquidates a user with a reward larger than total collateral', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))

    await expect(market.connect(userB).settle(user.address)) // liquidate
      .to.emit(market, 'Liquidation')
      .withArgs(user.address, userB.address, COLLATERAL)

    expect((await market.locals(user.address)).liquidation).to.eq(INITIAL_VERSION + 2)

    expect((await market.locals(user.address)).collateral).to.equal(0)
    expect(await dsu.balanceOf(market.address)).to.equal(0)
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('201000')) // Original 200000 + fee

    await chainlink.next()
    await market.settle(user.address)

    expect((await market.position()).version).to.eq(INITIAL_VERSION + 2)
    expect((await market.locals(user.address)).liquidation).to.eq(INITIAL_VERSION + 2)
  })

  it('creates and resolves a shortfall', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
    await market.connect(user).update(user.address, POSITION, 0, 0, parse6decimal('1000'))
    await market.connect(userB).update(userB.address, 0, POSITION, 0, parse6decimal('1000'))

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    await chainlink.nextWithPriceModification(price => price.mul(2))

    await market.settle(userB.address)
    const userBCollateral = (await market.locals(userB.address)).collateral
    await expect(market.connect(userB).update(userB.address, 0, 0, 0, userBCollateral.mul(-1))).to.be.revertedWith(
      'MarketInDebtError()',
    ) // underflow

    await market.connect(userB).settle(user.address) // liquidate
    expect((await market.locals(user.address)).collateral).to.equal(BigNumber.from('-3154014381'))

    await chainlink.next()

    await dsu.connect(userB).approve(market.address, constants.MaxUint256)
    await market.connect(user).update(user.address, 0, 0, 0, 0) //TODO: from userB?

    expect((await market.locals(user.address)).collateral).to.equal(0)
  })

  it('uses a socialization factor', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    let totalCollateral, totalFees
    const { user, userB, userC, userD, chainlink, dsu } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userC).approve(market.address, COLLATERAL.mul(10).mul(1e12))
    await dsu.connect(userD).approve(market.address, COLLATERAL.mul(10).mul(1e12))
    await market.connect(user).update(user.address, POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(userB.address, POSITION, 0, 0, COLLATERAL)
    await market.connect(userC).update(userC.address, 0, POSITION, 0, COLLATERAL.mul(10))
    await market.connect(userD).update(userD.address, 0, POSITION, 0, COLLATERAL.mul(10))

    // Expect the system to remain solvent
    totalCollateral = (await market.locals(user.address)).collateral
      .add((await market.locals(userB.address)).collateral)
      .add((await market.locals(userC.address)).collateral)
      .add((await market.locals(userD.address)).collateral)
    totalFees = (await market.global()).protocolFee.add((await market.global()).marketFee)
    expect(totalCollateral.add(totalFees)).to.equal(parse6decimal('22000'))

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    // Liquidate `user` which results in taker > maker
    const expectedLiquidationFee = BigNumber.from('682778988')
    await expect(market.connect(userB).settle(user.address)) // liquidate
      .to.emit(market, 'Liquidation')
      .withArgs(user.address, userB.address, expectedLiquidationFee)

    await chainlink.next()
    await market.settle(user.address)
    await market.settle(userB.address)
    await market.settle(userC.address)
    await market.settle(userD.address)

    const currA = (await market.locals(user.address)).collateral
    const currB = (await market.locals(userB.address)).collateral
    const currC = (await market.locals(userC.address)).collateral
    const currD = (await market.locals(userD.address)).collateral
    const totalCurr = currA.add(currB).add(currC).add(currD)
    const feesCurr = (await market.global()).protocolFee.add((await market.global()).marketFee)

    await chainlink.next()
    await market.settle(user.address)
    await market.settle(userB.address)
    await market.settle(userC.address)
    await market.settle(userD.address)

    const newA = (await market.locals(user.address)).collateral
    const newB = (await market.locals(userB.address)).collateral
    const newC = (await market.locals(userC.address)).collateral
    const newD = (await market.locals(userD.address)).collateral
    const totalNew = newA.add(newB).add(newC).add(newD)

    // Expect the loss from B to be socialized equally to C and D
    expect(currA).to.equal(newA)
    expect(currB.gt(newB)).to.equal(true)
    expect(currC.lt(newC)).to.equal(true)
    expect(currD.lt(newD)).to.equal(true)

    const feesNew = (await market.global()).protocolFee.add((await market.global()).marketFee)

    expect(totalCurr.add(feesCurr)).to.be.gte(totalNew.add(feesNew))
    expect(totalCurr.add(feesCurr)).to.be.closeTo(totalNew.add(feesNew), 1)

    // Expect the system to remain solvent
    totalCollateral = (await market.locals(user.address)).collateral
      .add((await market.locals(userB.address)).collateral)
      .add((await market.locals(userC.address)).collateral)
      .add((await market.locals(userD.address)).collateral)
    totalFees = (await market.global()).protocolFee.add((await market.global()).marketFee)
    expect(totalCollateral.add(totalFees)).to.be.lte(parse6decimal('22000').sub(expectedLiquidationFee))
  }).timeout(120000)
})
