import { expect } from 'chai'
import 'hardhat'
import { constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket } from '../helpers/setupHelpers'
import { expectPositionEq, parse6decimal } from '../../../../common/testutil/types'
import { Market } from '../../../types/generated'

const POSITION = parse6decimal('0.0001')
const COLLATERAL = parse6decimal('1000')

describe.only('Lens', () => {
  let instanceVars: InstanceVars
  let market: Market

  beforeEach(async () => {
    instanceVars = await deployProtocol()
    const { user, userB, dsu, factory } = instanceVars

    // Setup fees
    const protocolParameter = { ...(await factory.parameter()) }
    protocolParameter.protocolFee = parse6decimal('0.25')
    factory.updateParameter(protocolParameter)
    market = await createMarket(instanceVars)

    // Setup position
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))
    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION, COLLATERAL)
  })

  it('#factory', async () => {
    const { lens, factory } = instanceVars
    expect(await lens.callStatic.factory()).to.equal(factory.address)
  })

  it('#definition', async () => {
    const { lens, dsu, rewardToken } = instanceVars
    const info = await lens.callStatic.definition(market.address)
    expect(info.name).to.equal('Squeeth')
    expect(info.symbol).to.equal('SQTH')
    expect(info.token).to.equal(dsu.address)
    expect(info.reward).to.equal(rewardToken.address)
  })

  it('#snapshots (markets)', async () => {
    const { lens, chainlink } = instanceVars
    let marketSnapshot = (await lens.callStatic['snapshots(address[])']([market.address]))[0]
    expectPositionEq(marketSnapshot.position, {
      maker: 0,
      taker: 0,
      makerNext: POSITION,
      takerNext: POSITION,
    })
    expect(marketSnapshot.latestVersion.price).to.equal('11388297509658')
    expect(marketSnapshot.rate).to.equal(parse6decimal('5.00'))
    expect(marketSnapshot.dailyRate).to.equal(parse6decimal('5.00').div(365))
    expect(marketSnapshot.openMakerInterest).to.equal(0)
    expect(marketSnapshot.openTakerInterest).to.equal(0)

    await chainlink.next()

    marketSnapshot = await lens.callStatic['snapshot(address)'](market.address)
    expectPositionEq(marketSnapshot.position, {
      maker: POSITION,
      taker: POSITION,
      makerNext: POSITION,
      takerNext: POSITION,
    })
  })

  it('#snapshots (accounts)', async () => {
    const { lens, user, chainlink } = instanceVars
    let userSnapshot = (await lens.callStatic['snapshots(address,address[])'](user.address, [market.address]))[0]
    expect(userSnapshot.next).to.equal(POSITION.mul(-1))
    expect(userSnapshot.position).to.equal(0)
    expect(userSnapshot.maintenance).to.equal(0)
    expect(userSnapshot.openInterest).to.equal(0)

    await chainlink.next()

    userSnapshot = await lens.callStatic['snapshot(address,address)'](user.address, market.address)
    expect(userSnapshot.position).to.equal(POSITION.mul(-1))
    expect(userSnapshot.next).to.equal(POSITION.mul(-1))
    expect(userSnapshot.maintenance).to.equal('341389494')
    expect(userSnapshot.openInterest).to.equal('-1137964981')
  })

  it('#maintenanceRequired (accounts)', async () => {
    const { lens, user, chainlink } = instanceVars
    expect(await lens.callStatic.maintenanceRequired(user.address, market.address, 1000)).to.equal('3416489252')
    await chainlink.next()
    expect(await lens.callStatic.maintenanceRequired(user.address, market.address, 1000)).to.equal('3413894944')
  })

  it('#openInterest (market)', async () => {
    const { lens, chainlink } = instanceVars
    await chainlink.next()
    const [openMakerInterest, openTakerInterest] = await lens.callStatic['openInterest(address)'](market.address)
    expect(openMakerInterest).to.equal('1137964981')
    expect(openTakerInterest).to.equal('1137964981')
  })

  it('#openInterest (account)', async () => {
    const { lens, user, userB, chainlink } = instanceVars
    expect(await lens.callStatic['openInterest(address,address)'](userB.address, market.address)).to.equal(0)

    await chainlink.next()

    expect(await lens.callStatic['openInterest(address,address)'](user.address, market.address)).to.equal('-1137964981')
    expect(await lens.callStatic['openInterest(address,address)'](userB.address, market.address)).to.equal('1137964981')
  })

  it('#userPosition', async () => {
    const { lens, userB, chainlink } = instanceVars
    await chainlink.next()
    const [position, next] = await lens.callStatic.userPosition(userB.address, market.address)
    expect(position).to.equal(POSITION)
    expect(next).to.equal(POSITION)
  })

  it('#latestVersion', async () => {
    const { lens, chainlink } = instanceVars
    expect((await lens.callStatic.latestVersion(market.address)).version).to.equal('2472')
    expect((await lens.callStatic.latestVersion(market.address)).price).to.equal('11388297509658')
    expect((await lens.callStatic.latestVersion(market.address)).timestamp).to.equal('1631112429')
    await chainlink.next()
    expect((await lens.callStatic.latestVersion(market.address)).version).to.equal('2473')
    expect((await lens.callStatic.latestVersion(market.address)).price).to.equal('11379649816248')
    expect((await lens.callStatic.latestVersion(market.address)).timestamp).to.equal('1631112904')
  })

  it('#rate', async () => {
    const { lens, chainlink } = instanceVars
    await chainlink.next()
    expect(await lens.callStatic.rate(market.address)).to.equal(parse6decimal('5.00'))
  })

  it('#dailyRate', async () => {
    const { lens, chainlink } = instanceVars
    await chainlink.next()
    expect(await lens.callStatic.dailyRate(market.address)).to.equal(parse6decimal('5.00').div(365))
  })

  it('#liquidatable', async () => {
    const { lens, user, chainlink } = instanceVars
    await chainlink.next()
    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.false

    await chainlink.nextWithPriceModification(price => price.mul(2))
    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.true
  })

  it('#maintenance', async () => {
    const { lens, user, chainlink } = instanceVars
    await chainlink.next()
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal('341389494')

    await chainlink.nextWithPriceModification(price => price.mul(2))
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal('1380555115')
  })

  it('#fees', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()

    let fees = await lens.callStatic.fees(market.address)
    expect(fees.protocol).to.equal(0) // 12500
    expect(fees.market).to.equal(0)

    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).liquidate(user.address)

    fees = await lens.callStatic.fees(market.address)
    expect(fees.protocol).to.equal('4127')
    expect(fees.market).to.equal('12381')
  })

  it('#collateral (market)', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).liquidate(user.address)

    expect(await lens.callStatic['collateral(address)'](market.address)).to.equal('1999983492')
  })

  it('#collateral (account)', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).liquidate(user.address)

    expect(await lens.callStatic['collateral(address,address)'](user.address, market.address)).to.equal(
      '-2463736825720737646856',
    )
    expect(await lens.callStatic['collateral(address,address)'](userB.address, market.address)).to.equal(
      '4463720317001203086618',
    )
  })

  it('#atVersions', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).liquidate(user.address)
    await chainlink.next()
    await market.settle(constants.AddressZero)
    await chainlink.next()
    await market.settle(user.address)

    const prices = await lens.callStatic.atVersions(market.address, [2472, 2475])
    expect(prices[0].price).to.equal('11388297509658')
    expect(prices[1].price).to.equal('11628475348548')
  })
})
