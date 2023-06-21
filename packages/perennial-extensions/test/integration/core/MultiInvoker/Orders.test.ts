import { BigNumber, BigNumberish } from 'ethers'
import { InstanceVars, deployProtocol } from '../../helpers/setupHelpers'
import * as invoke from '../../../helpers/invoke'
import * as helpers from '../../../helpers/types'
import { PositionStruct } from '../../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'

describe('Orders', () => {
  let instanceVars: InstanceVars
  let collateral: BigNumberish
  let position: BigNumber
  let defaultOrder: invoke.OrderStruct
  //let defaultPosition: PositionStruct

  beforeEach(async () => {
    instanceVars = await deployProtocol()

    collateral = await instanceVars.usdc.balanceOf(instanceVars.user.address)

    defaultOrder = {
      isLimit: true,
      isLong: true,
      maxFee: position.div(20), // 5% fee
      execPrice: BigNumber.from(1000e6),
      size: position,
    }

    // defaultPosition = helpers.openPosition({
    //     maker: '0',
    //     long: defaultOrder.size,
    //     short: '0',
    //     collateral: collateral,
    // })
  })

  it('opens an order', async () => {
    const { user, usdc, multiInvoker, marketImpl } = instanceVars

    await usdc.connect(user).approve(multiInvoker.address, collateral)

    const openOrder = invoke.buildPlaceOrder({ market: marketImpl.address, order: defaultOrder })

    console.log(openOrder)
  })

  // it('opens a limit order', async () => {

  // })

  // it('cancels and order', async () => {

  // })

  // it('replaces an order', async () => {

  // })

  // it('executes and order', async () => {

  // })
})
