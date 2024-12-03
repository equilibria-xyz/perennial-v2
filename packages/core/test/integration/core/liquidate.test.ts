import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle } from '../helpers/setupHelpers'
import { expectPositionEq, parse6decimal, DEFAULT_ORDER, DEFAULT_GUARANTEE } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

export const TIMESTAMP_2 = 1631113819
export const TIMESTAMP_3 = 1631114005

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()
  })

  it('liquidates a user', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    await expect(
      market.connect(userB)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
    ) // liquidate
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_2, orders: 1, makerNeg: POSITION, protection: 1 },
        { ...DEFAULT_GUARANTEE },
        userB.address,
        constants.AddressZero,
        constants.AddressZero,
      )

    expect((await market.pendingOrders(user.address, 2)).protection).to.eq(1)
    expect(await market.liquidators(user.address, 2)).to.eq(userB.address)

    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL)
    expect(await dsu.balanceOf(margin.address)).to.equal(utils.parseEther('1000'))

    chainlink.updateParams(parse6decimal('1.0'), parse6decimal('0.1'))
    await chainlink.next()
    await market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false) // settle
    expect((await market.locals(userB.address)).claimable).to.equal(parse6decimal('10'))
    await market.connect(userB).claimFee(userB.address)
    await margin.connect(userB).withdraw(parse6decimal('10')) // liquidator withdrawal

    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('200010')) // Original 200000 + fee
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(COLLATERAL.sub(parse6decimal('11')))
    expect(await dsu.balanceOf(margin.address)).to.equal(utils.parseEther('1000').sub(utils.parseEther('10')))

    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, constants.MinInt256, false) // withdraw everything

    expect((await market.position()).timestamp).to.eq(TIMESTAMP_2)
    expect((await market.pendingOrders(user.address, 2)).protection).to.eq(1)
  })

  it.skip('creates and resolves a shortfall', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        user.address,
        POSITION,
        0,
        0,
        parse6decimal('1000'),
        false,
      )
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        userB.address,
        0,
        POSITION,
        0,
        parse6decimal('1000'),
        false,
      )

    // Settle the market with a new oracle version
    await chainlink.next()
    await settle(market, user)

    await chainlink.nextWithPriceModification(price => price.mul(2))

    await settle(market, userB)
    const userBCollateral = await margin.isolatedBalances(userB.address, market.address)
    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          userB.address,
          0,
          0,
          0,
          userBCollateral.mul(-1).sub(1),
          false,
        ),
    ).to.be.revertedWithCustomError(margin, 'MarginInsufficientIsolatedBalance') // underflow

    // Liquidate user
    await market.connect(userB)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true) // liquidate

    chainlink.updateParams(parse6decimal('1.0'), parse6decimal('0.1'))
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await settle(market, user)

    // FIXME: off by 0.50; figure out why - may only happen when running solo
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(parse6decimal('-2524.654460'))

    // UserB deposits collateral to userB and isolates
    const userCollateral = await margin.isolatedBalances(user.address, market.address)
    // FIXME: There is currently no way for userB to deposit to user's isolated balance to resolve the shortfall.
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, userCollateral.mul(-1), false)
    expect(await margin.isolatedBalances(user.address, market.address)).to.equal(0)
  })

  it('uses a socialization factor', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    let totalCollateral, totalFees
    const { user, userB, userC, userD, chainlink, dsu, margin } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL)
    await dsu.connect(userC).approve(margin.address, COLLATERAL.mul(10).mul(1e12))
    await margin.connect(userC).deposit(userC.address, COLLATERAL.mul(10))
    await dsu.connect(userD).approve(margin.address, COLLATERAL.mul(10).mul(1e12))
    await margin.connect(userD).deposit(userD.address, COLLATERAL.mul(10))
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
    await market
      .connect(userC)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, POSITION, 0, COLLATERAL.mul(10), false)
    await market
      .connect(userD)
      ['update(address,uint256,uint256,uint256,int256,bool)'](userD.address, 0, POSITION, 0, COLLATERAL.mul(10), false)

    // Expect the system to remain solvent
    totalCollateral = (await margin.isolatedBalances(user.address, market.address))
      .add(await margin.isolatedBalances(userB.address, market.address))
      .add(await margin.isolatedBalances(userC.address, market.address))
      .add(await margin.isolatedBalances(userD.address, market.address))
    totalFees = (await market.global()).protocolFee
      .add((await market.global()).oracleFee)
      .add((await market.global()).riskFee)
    expect(totalCollateral.add(totalFees)).to.equal(parse6decimal('22000'))

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    // Liquidate `user` which results in taker > maker
    await expect(
      market.connect(userB)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
    ) // liquidate
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_2, orders: 1, makerNeg: POSITION, protection: 1 },
        { ...DEFAULT_GUARANTEE },
        userB.address,
        constants.AddressZero,
        constants.AddressZero,
      )

    chainlink.updateParams(parse6decimal('1.0'), parse6decimal('0.1'))
    await chainlink.next()
    await settle(market, user)
    await settle(market, userB)
    await settle(market, userC)
    await settle(market, userD)

    const currA = await margin.isolatedBalances(user.address, market.address)
    const currB = await margin.isolatedBalances(userB.address, market.address)
    const currC = await margin.isolatedBalances(userC.address, market.address)
    const currD = await margin.isolatedBalances(userD.address, market.address)
    const totalCurr = currA.add(currB).add(currC).add(currD)
    const feesCurr = (await market.global()).protocolFee
      .add((await market.global()).oracleFee)
      .add((await market.global()).riskFee)

    await chainlink.next()
    await settle(market, user)
    await settle(market, userB)
    await settle(market, userC)
    await settle(market, userD)

    const newA = await margin.isolatedBalances(user.address, market.address)
    const newB = await margin.isolatedBalances(userB.address, market.address)
    const newC = await margin.isolatedBalances(userC.address, market.address)
    const newD = await margin.isolatedBalances(userD.address, market.address)
    const totalNew = newA.add(newB).add(newC).add(newD)
    const feesNew = (await market.global()).protocolFee
      .add((await market.global()).oracleFee)
      .add((await market.global()).riskFee)

    // Expect the loss from B to be socialized equally to C and D
    expect(currA).to.equal(newA)
    expect(currB.gt(newB)).to.equal(true)
    expect(currC.lt(newC)).to.equal(true)
    expect(currD.lt(newD)).to.equal(true)

    expect(totalCurr.add(feesCurr)).to.be.gte(totalNew.add(feesNew))
    expect(totalCurr.add(feesCurr)).to.be.closeTo(totalNew.add(feesNew), 100)

    // Expect the system to remain solvent
    totalCollateral = (await margin.isolatedBalances(user.address, market.address))
      .add(await margin.isolatedBalances(userB.address, market.address))
      .add(await margin.isolatedBalances(userC.address, market.address))
      .add(await margin.isolatedBalances(userD.address, market.address))
    totalFees = (await market.global()).protocolFee
      .add((await market.global()).oracleFee)
      .add((await market.global()).riskFee)
    expect(totalCollateral.add(totalFees)).to.be.lte(parse6decimal('22000'))
  })

  it('liquidates a user under minMaintenance', async () => {
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, userC, dsu, margin, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await dsu.connect(userB).approve(margin.address, COLLATERAL.mul(10).mul(1e12))
    await margin.connect(userB).deposit(userB.address, COLLATERAL.mul(10))
    // user establishes a maker position right at minMaintenance amount
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        user.address,
        parse6decimal('5'),
        0,
        0,
        COLLATERAL.div(2),
        false,
      )
    // userB takes a short position
    await market
      .connect(userB)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        userB.address,
        0,
        0,
        parse6decimal('4'),
        COLLATERAL,
        false,
      )

    // two price drops occur while the maker has long exposure
    let price = (await chainlink.oracle.latest()).price
    expect(price).to.equal(parse6decimal('113.882975'))
    await chainlink.nextWithPriceModification(price => price.mul(9).div(10)) // 10% drop
    await settle(market, user)
    await chainlink.nextWithPriceModification(price => price.mul(8).div(10)) // 20% drop
    await settle(market, user)
    price = (await chainlink.oracle.latest()).price

    // ensure user's collateral is now lower than minMaintenance but above maintenance requirement
    const collateral = await margin.isolatedBalances(user.address, market.address)
    const riskParameter = await market.riskParameter()
    expect(collateral).to.be.lessThan(riskParameter.minMaintenance)
    // maintenance = price * position * requirementRatio = price * 5 * 0.3
    const maintenance = price.mul(5).mul(3).div(10)
    expect(collateral).to.be.greaterThan(maintenance)

    // userC liquidates
    await expect(
      market.connect(userC)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
    ) // liquidate
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        { ...DEFAULT_ORDER, timestamp: TIMESTAMP_3, orders: 1, makerNeg: parse6decimal('5'), protection: 1 },
        { ...DEFAULT_GUARANTEE },
        userC.address,
        constants.AddressZero,
        constants.AddressZero,
      )
    expect((await market.pendingOrders(user.address, 2)).protection).to.eq(1)
    expect(await market.liquidators(user.address, 2)).to.eq(userC.address)

    chainlink.updateParams(parse6decimal('1.0'), parse6decimal('0.1'))
    await chainlink.next()
    await settle(market, user)
    expectPositionEq(await market.position(), {
      timestamp: TIMESTAMP_3,
      long: 0,
      maker: 0,
      short: parse6decimal('4'),
    })

    // userC claims their fee
    expect((await market.locals(userC.address)).claimable).to.equal(parse6decimal('10'))
    await market.connect(userC).claimFee(userC.address) // liquidator withdrawal
    expect(await margin.crossMarginBalances(userC.address)).to.equal(parse6decimal('10'))
  })

  it('liquidates a user with referrer', async () => {
    const POSITION = parse6decimal('10')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, userC, dsu, margin, chainlink, marketFactory, owner } = instanceVars

    marketFactory.connect(owner).updateParameter({
      ...(await marketFactory.parameter()),
      maxFee: parse6decimal('0.9'),
      referralFee: parse6decimal('0.12'),
    })
    const market = await createMarket(
      instanceVars,
      undefined,
      {
        makerFee: {
          linearFee: parse6decimal('0.05'),
          proportionalFee: 0,
          scale: parse6decimal('10000'),
        },
      },
      {
        makerFee: parse6decimal('0.05'),
      },
    )

    await dsu.connect(user).approve(margin.address, COLLATERAL.mul(1e12))
    await margin.connect(user).deposit(user.address, COLLATERAL)
    await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    await expect(
      market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool,address)'](user.address, 0, 0, 0, 0, true, userC.address),
    ) // liquidate
      .to.emit(market, 'OrderCreated')
      .withArgs(
        user.address,
        {
          ...DEFAULT_ORDER,
          timestamp: TIMESTAMP_2,
          orders: 1,
          makerNeg: POSITION,
          protection: 1,
          makerReferral: parse6decimal('1.2'),
        },
        { ...DEFAULT_GUARANTEE },
        userB.address,
        userC.address,
        constants.AddressZero,
      )

    expect((await market.pendingOrders(user.address, 2)).protection).to.eq(1)
    expect(await market.liquidators(user.address, 2)).to.eq(userB.address)
    expect(await market.orderReferrers(user.address, 2)).to.eq(userC.address)

    expect(await dsu.balanceOf(margin.address)).to.equal(utils.parseEther('1000'))

    chainlink.updateParams(parse6decimal('1.0'), parse6decimal('0.1'))
    await chainlink.next()
    await market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false) // settle
    expect((await market.locals(userB.address)).claimable).to.equal(parse6decimal('10'))
    await market.connect(userB).claimFee(userB.address) // liquidator withdrawal

    const expectedClaimable = parse6decimal('6.902775')
    await settle(market, userC)
    expect((await market.locals(userC.address)).claimable).to.equal(expectedClaimable)

    await chainlink.next()
    await market.connect(user)['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

    await chainlink.next()
    await settle(market, user)
    expect((await market.locals(user.address)).latestId).to.equal(4)
    expect(await market.liquidators(user.address, 4)).to.eq(constants.AddressZero)
    expect(await market.orderReferrers(user.address, 4)).to.eq(constants.AddressZero)
  })
})
