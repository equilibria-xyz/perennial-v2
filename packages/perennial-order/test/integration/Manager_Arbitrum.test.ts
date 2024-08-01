import { expect } from 'chai'
import { BigNumber, BigNumberish, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { IERC20, IMarketFactory, IMarket } from '@equilibria/perennial-v2/types/generated'
import { IKeeperOracle, IOracleFactory } from '@equilibria/perennial-v2-oracle/types/generated'
import {
  IOrderVerifier,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../types/generated'

import { signCancelOrderAction, signCommon, signPlaceOrderAction } from '../helpers/eip712'
import { createMarketETH, deployProtocol, deployPythOracleFactory, fundWalletDSU } from '../helpers/arbitrumHelpers'
import { Compare, compareOrders, Side } from '../helpers/order'
import { transferCollateral } from '../helpers/marketHelpers'
import { advanceToPrice } from '../helpers/oracleHelpers'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

const KEEP_CONFIG = {
  multiplierBase: 0,
  bufferBase: 1_000_000,
  multiplierCalldata: 0,
  bufferCalldata: 500_000,
}

const MAKER_ORDER = {
  side: BigNumber.from(0),
  comparison: BigNumber.from(-2),
  price: parse6decimal('2222.33'),
  delta: parse6decimal('100'),
}

const MAX_FEE = utils.parseEther('7')

describe('Manager_Arbitrum', () => {
  let dsu: IERC20
  let keeperOracle: IKeeperOracle
  let manager: Manager_Arbitrum
  let marketFactory: IMarketFactory
  let market: IMarket
  let verifier: IOrderVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let checkKeeperCompensation: boolean
  let keeperBalanceBefore: BigNumber
  const nextOrderNonce: { [key: string]: BigNumber } = {}

  function advanceOrderNonce(user: SignerWithAddress) {
    nextOrderNonce[user.address] = nextOrderNonce[user.address].add(BigNumber.from(1))
  }

  const fixture = async () => {
    // deploy the protocol and create a market
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    let oracleFactory: IOracleFactory
    ;[marketFactory, dsu, oracleFactory] = await deployProtocol(owner)
    const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory)
    ;[market, , keeperOracle] = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)

    // deploy the order manager
    verifier = await new OrderVerifier__factory(owner).deploy()
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)
    await manager.initialize(CHAINLINK_ETH_USD_FEED, KEEP_CONFIG)

    // commit a start price
    const timestamp = await commitPrice(parse6decimal('4444'))

    // fund accounts and deposit all into market
    const amount = parse6decimal('100000')
    await setupUser(userA, amount)
    await setupUser(userB, amount)
  }

  // prepares an account for use with the market and manager
  async function setupUser(user: SignerWithAddress, amount: BigNumber) {
    // funds, approves, and deposits DSU into the market
    await fundWalletDSU(user, amount.mul(1e12))
    await dsu.connect(user).approve(market.address, amount.mul(1e12))
    await transferCollateral(user, market, amount)

    // allows manager to interact with markets on the user's behalf
    await marketFactory.connect(user).updateOperator(manager.address, true)
  }

  // commits an oracle version and advances time 10 seconds
  async function commitPrice(price: BigNumber): Promise<number> {
    return advanceToPrice(keeperOracle, BigNumber.from((await currentBlockTimestamp()) + 10), price)
  }

  // submits a trigger order, validating event and storage
  async function placeOrder(
    user: SignerWithAddress,
    side: Side,
    comparison: Compare,
    price: BigNumber,
    delta: BigNumber,
  ): Promise<BigNumber> {
    const order = {
      side: side,
      comparison: comparison,
      price: price,
      delta: delta,
    }
    advanceOrderNonce(user)
    const nonce = nextOrderNonce[user.address]
    await expect(manager.connect(user).placeOrder(market.address, nonce, order))
      .to.emit(manager, 'OrderPlaced')
      .withArgs(market.address, user.address, order, nonce)

    const storedOrder = await manager.orders(market.address, user.address, nonce)
    compareOrders(storedOrder, order)
    return nonce
  }

  // TODO: placeOrderWithSignature

  // executes an order as keeper
  async function executeOrder(user: SignerWithAddress, orderNonce: BigNumberish) {
    // ensure order is executable
    const [order, canExecute] = await manager.checkOrder(market.address, user.address, orderNonce)
    expect(canExecute).to.be.true

    // validate event
    await expect(manager.connect(keeper).executeOrder(market.address, user.address, orderNonce))
      .to.emit(manager, 'OrderExecuted')
      .withArgs(market.address, user.address, order, orderNonce)

    // ensure it was deleted from storage
    const deletedOrder = await manager.orders(market.address, user.address, orderNonce)
    expect(deletedOrder.price).to.equal(0)
    expect(deletedOrder.delta).to.equal(0)

    // TODO: validate the user's position changed
  }

  // running tests serially; can build a few scenario scripts and test multiple things within each script
  before(async () => {
    await loadFixture(fixture)
    nextOrderNonce[userA.address] = BigNumber.from(500)
    nextOrderNonce[userB.address] = BigNumber.from(500)
  })

  beforeEach(async () => {
    checkKeeperCompensation = false
    keeperBalanceBefore = await dsu.balanceOf(keeper.address)
  })

  afterEach(async () => {
    if (checkKeeperCompensation) {
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), MAX_FEE)
    }
  })

  it('constructs and initializes', async () => {
    expect(await manager.DSU()).to.equal(dsu.address)
    expect(await manager.marketFactory()).to.equal(marketFactory.address)
    expect(await manager.verifier()).to.equal(verifier.address)
  })

  it('single user can place order', async () => {
    // userA places a 5k maker order
    const nonce = await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3993.6'), parse6decimal('50'))
    expect(nonce).to.equal(BigNumber.from(501))
  })

  it('multiple users can place orders', async () => {
    // if price drops below 3636.99, userA would have 10k maker position after both orders executed
    let nonce = await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3636.99'), parse6decimal('50'))
    expect(nonce).to.equal(BigNumber.from(502))

    // userB queues up a 2.5k long position; same order nonce as userA's first order
    nonce = await placeOrder(userB, Side.LONG, Compare.GTE, parse6decimal('2222.22'), parse6decimal('2.5'))
    expect(nonce).to.equal(BigNumber.from(501))
  })

  it('keeper cannot execute order when conditions not met', async () => {
    const [, canExecute] = await manager.checkOrder(market.address, userA.address, 501)
    expect(canExecute).to.be.false

    await expect(
      manager.connect(keeper).executeOrder(market.address, userA.address, 501),
    ).to.be.revertedWithCustomError(manager, 'ManagerCannotExecuteError')
  })

  it('keeper can execute orders', async () => {
    // commit a price which should make all orders executable
    await commitPrice(parse6decimal('2800'))

    // execute two maker orders and the long order
    await executeOrder(userA, 501)
    await executeOrder(userA, 502)
    await executeOrder(userB, 501)
  })
})
