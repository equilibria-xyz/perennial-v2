import { expect } from 'chai'
import 'hardhat'
import { constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, INITIAL_VERSION } from '../helpers/setupHelpers'
import { expectPositionEq, parse6decimal } from '../../../../common/testutil/types'
import { Market } from '../../../types/generated'

const POSITION = parse6decimal('0.0001')
const COLLATERAL = parse6decimal('1000')

describe('Lens', () => {
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
    await market.connect(user).update(POSITION, 0, 0, COLLATERAL)
    await market.connect(userB).update(0, POSITION, 0, COLLATERAL)
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
      latestVersion: INITIAL_VERSION,
      maker: 0,
      long: 0,
      short: 0,
      makerNext: POSITION,
      longNext: POSITION,
      shortNext: 0,
    })
    expect(marketSnapshot.latestVersion.price).to.equal('11388297509658')
    expect(marketSnapshot.rate).to.equal(parse6decimal('5.00'))
    expect(marketSnapshot.dailyRate).to.equal(parse6decimal('5.00').div(365))
    expect(marketSnapshot.openMakerInterest).to.equal(0)
    expect(marketSnapshot.openLongInterest).to.equal(0)
    expect(marketSnapshot.openShortInterest).to.equal(0)

    await chainlink.next()

    marketSnapshot = await lens.callStatic['snapshot(address)'](market.address)
    expectPositionEq(marketSnapshot.position, {
      latestVersion: INITIAL_VERSION + 1,
      maker: POSITION,
      long: POSITION,
      short: 0,
      makerNext: POSITION,
      longNext: POSITION,
      shortNext: 0,
    })
  })

  it('#snapshots (accounts)', async () => {
    const { lens, user, chainlink } = instanceVars
    let userSnapshot = (await lens.callStatic['snapshots(address,address[])'](user.address, [market.address]))[0]
    expect(userSnapshot.maker).to.equal(0)
    expect(userSnapshot.long).to.equal(0)
    expect(userSnapshot.short).to.equal(0)
    expect(userSnapshot.nextMaker).to.equal(POSITION)
    expect(userSnapshot.nextLong).to.equal(0)
    expect(userSnapshot.nextShort).to.equal(0)
    expect(userSnapshot.maintenance).to.equal(0)
    expect(userSnapshot.openInterest).to.equal(0)

    await chainlink.next()

    userSnapshot = await lens.callStatic['snapshot(address,address)'](user.address, market.address)
    expect(userSnapshot.maker).to.equal(POSITION)
    expect(userSnapshot.long).to.equal(0)
    expect(userSnapshot.short).to.equal(0)
    expect(userSnapshot.nextMaker).to.equal(POSITION)
    expect(userSnapshot.nextLong).to.equal(0)
    expect(userSnapshot.nextShort).to.equal(0)
    expect(userSnapshot.maintenance).to.equal('341389494')
    expect(userSnapshot.openInterest).to.equal('1137964981')
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

    expect(await lens.callStatic['openInterest(address,address)'](user.address, market.address)).to.equal('1137964981')
    expect(await lens.callStatic['openInterest(address,address)'](userB.address, market.address)).to.equal('1137964981')
  })

  it('#userPosition', async () => {
    const { lens, userB, chainlink } = instanceVars
    await chainlink.next()
    const [maker, long, short, nextMaker, nextLong, nextShort] = await lens.callStatic.userPosition(
      userB.address,
      market.address,
    )
    expect(maker).to.equal(0)
    expect(long).to.equal(POSITION)
    expect(short).to.equal(0)
    expect(nextMaker).to.equal(0)
    expect(nextLong).to.equal(POSITION)
    expect(nextShort).to.equal(0)
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
    await market.connect(userB).settle(user.address)

    fees = await lens.callStatic.fees(market.address)
    expect(fees.protocol).to.equal('4127')
    expect(fees.market).to.equal('12381')
  })

  it('#collateral (market)', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).settle(user.address)

    expect(await lens.callStatic['collateral(address)'](market.address)).to.equal('1309705935')
  })

  it('#collateral (account)', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).settle(user.address)

    expect(await lens.callStatic['collateral(address,address)'](user.address, market.address)).to.equal('-3154014381')
    expect(await lens.callStatic['collateral(address,address)'](userB.address, market.address)).to.equal('4463720316')
  })

  it('#atVersions', async () => {
    const { lens, user, userB, chainlink } = instanceVars

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.connect(userB).settle(user.address)
    await chainlink.next()
    await market.settle(constants.AddressZero)
    await chainlink.next()
    await market.settle(user.address)

    const prices = await lens.callStatic.atVersions(market.address, [2472, 2475])
    expect(prices[0].price).to.equal('11388297509658')
    expect(prices[1].price).to.equal('11628475348548')
  })
})
