import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, settle, createInvoker } from '../helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { buildLiquidateUser, buildUpdateMarket } from '../../helpers/invoke'

export const TIMESTAMP_2 = 1631113819

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await loadFixture(deployProtocol)
    await instanceVars.chainlink.reset()
  })

  it('liquidates a user', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, usdc, chainlink, marketFactory } = instanceVars

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

    const userBUSDCBalance = await usdc.balanceOf(userB.address)
    await expect(multiInvoker.connect(userB).invoke(buildLiquidateUser({ market: market.address, user: user.address })))
      .to.emit(market, 'Updated')
      .withArgs(user.address, TIMESTAMP_2, 0, 0, 0, '-682778988', true)

    //await expect(market.connect(userB).update(user.address, 0, 0, 0, '-682778988', true)) // liquidate

    expect((await market.locals(user.address)).protection).to.eq(TIMESTAMP_2)

    expect((await market.locals(user.address)).collateral).to.equal('317221012')
    expect(await dsu.balanceOf(market.address)).to.equal(utils.parseEther('317.221012'))
    expect((await usdc.balanceOf(userB.address)).sub(userBUSDCBalance)).to.equal(parse6decimal('682.778988')) // Original 200000000 + fee

    await chainlink.next()
    await market.connect(user).update(user.address, 0, 0, 0, constants.MinInt256, false) // withdraw everything

    expect((await market.position()).timestamp).to.eq(TIMESTAMP_2)
    expect((await market.locals(user.address)).protection).to.eq(TIMESTAMP_2)
  })
})
