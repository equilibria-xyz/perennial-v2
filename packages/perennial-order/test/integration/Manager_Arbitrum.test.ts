import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { IERC20, IMarketFactory, IMarket } from '@equilibria/perennial-v2/types/generated'

import {
  AggregatorV3Interface,
  IOrderVerifier,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../types/generated'
import { signCancelOrderAction, signCommon, signPlaceOrderAction } from '../helpers/eip712'
import { createMarketETH, deployProtocol, deployPythOracleFactory, fundWalletDSU } from '../helpers/arbitrumHelpers'
import { Compare, compareOrders, Side } from '../helpers/order'
import { IOracleFactory } from '@equilibria/perennial-v2-oracle/types/generated'

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
  let manager: Manager_Arbitrum
  let marketFactory: IMarketFactory
  let market: IMarket
  let verifier: IOrderVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
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
    ;[market, ,] = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)

    // deploy the order manager
    verifier = await new OrderVerifier__factory(owner).deploy()
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)
    await manager.initialize(CHAINLINK_ETH_USD_FEED, KEEP_CONFIG)

    // fund accounts and deposit into market
    await fundWalletDSU(userA, parse6decimal('100000'))
    await fundWalletDSU(userB, parse6decimal('100000'))
    // TODO: implement a market deposit helper
  }

  async function placeOrder(
    user: SignerWithAddress,
    side: Side,
    comparison: Compare,
    price: BigNumber,
    delta: BigNumber,
  ): Promise<undefined> {
    const order = {
      side: side,
      comparison: comparison,
      price: price,
      delta: delta,
    }
    advanceOrderNonce(user)
    await expect(manager.connect(user).placeOrder(market.address, nextOrderNonce[user.address], order))
      .to.emit(manager, 'OrderPlaced')
      .withArgs(market.address, user.address, order, nextOrderNonce[user.address])

    const storedOrder = await manager.orders(market.address, user.address, nextOrderNonce[user.address])
    compareOrders(storedOrder, order)
  }

  // TODO: placeOrderWithSignature

  // running tests serially, to build off each other
  before(async () => {
    await loadFixture(fixture)
    nextOrderNonce[userA.address] = BigNumber.from(500)
    nextOrderNonce[userB.address] = BigNumber.from(500)
  })

  it('constructs and initializes', async () => {
    expect(await manager.DSU()).to.equal(dsu.address)
    expect(await manager.marketFactory()).to.equal(marketFactory.address)
    expect(await manager.verifier()).to.equal(verifier.address)
  })

  it('single user can place order', async () => {
    // userA places a 5k maker order
    await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3993.6'), parse6decimal('5000'))
  })

  it('multiple users can place orders', async () => {
    // if price drops below 3636.99, userA would have 10k maker position after both orders executed
    await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3636.99'), parse6decimal('5000'))

    // userB queues up a 2.5k long position; same order nonce as userA's first order
    await placeOrder(userB, Side.LONG, Compare.GTE, parse6decimal('2222.22'), parse6decimal('2500'))
  })
})
