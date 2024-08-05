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
  ArbGasInfo,
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
import { PlaceOrderActionStruct } from '../../types/generated/contracts/Manager'
import { Address } from 'hardhat-deploy/dist/types'
import { smock } from '@defi-wonderland/smock'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

const MAX_FEE = utils.parseEther('7')

const EMPTY_ORDER = {
  side: 0,
  comparison: 0,
  price: 0,
  delta: 0,
  maxFee: 0,
  referrer: constants.AddressZero,
}

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
  maxFee: MAX_FEE,
  referrer: constants.AddressZero,
}

// because we called hardhat_setNextBlockBaseFeePerGas, need this when running tests under coverage
const TX_OVERRIDES = { maxFeePerGas: 150_000_000 }

describe('Manager_Arbitrum', () => {
  let dsu: IERC20
  let keeperOracle: IKeeperOracle
  let manager: Manager_Arbitrum
  let marketFactory: IMarketFactory
  let market: IMarket
  let oracle: IOracleProvider
  let verifier: IOrderVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let checkKeeperCompensation: boolean
  let currentTime: BigNumber
  let keeperBalanceBefore: BigNumber
  let lastMessageNonce = 0
  let lastPriceCommitted: BigNumber
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
    ;[market, oracle, keeperOracle] = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)

    // deploy the order manager
    verifier = await new OrderVerifier__factory(owner).deploy()
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)
    await manager.initialize(CHAINLINK_ETH_USD_FEED, KEEP_CONFIG)

    // commit a start price
    await commitPrice(parse6decimal('4444'))

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

  // checks that the sum of the users current position and unsettled orders represents the expected change in position
  async function checkPendingPosition(user: SignerWithAddress, side: Side, expectedPosition: BigNumber) {
    const position = await market.positions(user.address)
    const pending = await market.pendings(user.address)

    let actualPos: BigNumber
    let pendingPos: BigNumber
    switch (side) {
      case Side.MAKER:
        actualPos = position.maker
        pendingPos = pending.makerPos.sub(pending.makerNeg)
        break
      case Side.LONG:
        actualPos = position.long
        pendingPos = pending.longPos.sub(pending.longNeg)
        break
      case Side.SHORT:
        actualPos = position.short
        pendingPos = pending.shortPos.sub(pending.shortNeg)
        break
      default:
        throw new Error('Unexpected side')
    }

    expect(actualPos.add(pendingPos)).to.equal(expectedPosition)
  }

  // commits an oracle version and advances time 10 seconds
  async function commitPrice(
    price = lastPriceCommitted,
    timestamp: BigNumber | undefined = undefined,
  ): Promise<number> {
    if (!timestamp) timestamp = await oracle.current()

    lastPriceCommitted = price
    return advanceToPrice(keeperOracle, timestamp!, price, TX_OVERRIDES)
  }

  function createActionMessage(
    userAddress: Address,
    nonce = nextMessageNonce(),
    signerAddress = userAddress,
    expiresInSeconds = 12,
  ) {
    return {
      action: {
        market: market.address,
        orderNonce: nextOrderNonce[userAddress],
        maxFee: MAX_FEE,
        common: {
          account: userAddress,
          signer: signerAddress,
          domain: manager.address,
          nonce: nonce,
          group: 0,
          expiry: currentTime.add(expiresInSeconds),
        },
      },
    }
  }

  function nextMessageNonce(): BigNumber {
    return BigNumber.from(++lastMessageNonce)
  }

  // submits a trigger order, validating event and storage, returning nonce of order
  async function placeOrder(
    user: SignerWithAddress,
    side: Side,
    comparison: Compare,
    price: BigNumber,
    delta: BigNumber,
    maxFee = MAX_FEE,
    referrer = constants.AddressZero,
  ): Promise<BigNumber> {
    const order = {
      side: side,
      comparison: comparison,
      price: price,
      delta: delta,
      maxFee: maxFee,
      referrer: referrer,
    }
    advanceOrderNonce(user)
    const nonce = nextOrderNonce[user.address]
    await expect(manager.connect(user).placeOrder(market.address, nonce, order, TX_OVERRIDES))
      .to.emit(manager, 'OrderPlaced')
      .withArgs(market.address, user.address, order, nonce)

    const storedOrder = await manager.orders(market.address, user.address, nonce)
    compareOrders(storedOrder, order)
    return nonce
  }

  async function placeOrderWithSignature(
    user: SignerWithAddress,
    side: Side,
    comparison: Compare,
    price: BigNumber,
    delta: BigNumber,
    maxFee = MAX_FEE,
    referrer = constants.AddressZero,
  ): Promise<BigNumber> {
    advanceOrderNonce(user)
    const message: PlaceOrderActionStruct = {
      order: {
        side: side,
        comparison: comparison,
        price: price,
        delta: delta,
        maxFee: maxFee,
        referrer: referrer,
      },
      ...createActionMessage(user.address),
    }
    const signature = await signPlaceOrderAction(userA, verifier, message)

    await expect(manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES))
      .to.emit(manager, 'OrderPlaced')
      .withArgs(market.address, user.address, message.order, message.action.orderNonce)

    const storedOrder = await manager.orders(market.address, user.address, message.action.orderNonce)
    compareOrders(storedOrder, message.order)

    return BigNumber.from(message.action.orderNonce)
  }

  // executes an order as keeper
  async function executeOrder(user: SignerWithAddress, orderNonce: BigNumberish) {
    // ensure order is executable
    const [order, canExecute] = await manager.checkOrder(market.address, user.address, orderNonce)
    expect(canExecute).to.be.true

    // validate event
    await expect(manager.connect(keeper).executeOrder(market.address, user.address, orderNonce, TX_OVERRIDES))
      .to.emit(manager, 'OrderExecuted')
      .withArgs(market.address, user.address, order, orderNonce)

    // ensure it was deleted from storage
    const deletedOrder = await manager.orders(market.address, user.address, orderNonce)
    expect(deletedOrder.price).to.equal(0)
    expect(deletedOrder.delta).to.equal(0)

    // helps diagnose missing oracle versions
    // console.log('executed order; latest', (await oracle.latest()).timestamp.toString(), 'current', (await oracle.current()).toString())
  }

  // running tests serially; can build a few scenario scripts and test multiple things within each script
  before(async () => {
    currentTime = BigNumber.from(await currentBlockTimestamp())
    await loadFixture(fixture)
    nextOrderNonce[userA.address] = BigNumber.from(500)
    nextOrderNonce[userB.address] = BigNumber.from(500)

    // Hardhat fork does not support Arbitrum built-ins
    await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    // set a realistic base gas fee to get realistic keeper compensation
    await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100']) // 0.1 gwei
  })

  beforeEach(async () => {
    currentTime = BigNumber.from(await currentBlockTimestamp())
    checkKeeperCompensation = false
    keeperBalanceBefore = await dsu.balanceOf(keeper.address)
  })

  afterEach(async () => {
    // ensure keeper was paid for their transaction
    if (checkKeeperCompensation) {
      const keeperBalanceAfter = await dsu.balanceOf(keeper.address)
      const keeperFeePaid = keeperBalanceAfter.sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), MAX_FEE)
    }
    // ensure manager has no funds at rest
    expect(await dsu.balanceOf(manager.address)).to.equal(constants.Zero)
  })

  after(async () => {
    // reset to avoid impact to other tests
    await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
  })

  it('constructs and initializes', async () => {
    expect(await manager.DSU()).to.equal(dsu.address)
    expect(await manager.marketFactory()).to.equal(marketFactory.address)
    expect(await manager.verifier()).to.equal(verifier.address)
  })

  it('single user can place order', async () => {
    // userA places a 5k maker order
    const nonce = await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3993.6'), parse6decimal('55'))
    expect(nonce).to.equal(BigNumber.from(501))
  })

  it('multiple users can place orders', async () => {
    // if price drops below 3636.99, userA would have 10k maker position after both orders executed
    let nonce = await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3636.99'), parse6decimal('45'))
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
    await commitPrice()
    await executeOrder(userA, 502)
    await commitPrice()
    await executeOrder(userB, 501)
    await commitPrice()

    // validate positions
    await checkPendingPosition(userA, Side.MAKER, parse6decimal('100'))
    await checkPendingPosition(userB, Side.LONG, parse6decimal('2.5'))
    await market.connect(userA).settle(userA.address, TX_OVERRIDES)

    checkKeeperCompensation = true
  })

  it('user can place an order using a signed message', async () => {
    const nonce = await placeOrderWithSignature(
      userA,
      Side.MAKER,
      Compare.GTE,
      parse6decimal('1000'),
      parse6decimal('-10'),
    )
    expect(nonce).to.equal(BigNumber.from(503))
    await executeOrder(userA, 503)

    await checkPendingPosition(userA, Side.MAKER, parse6decimal('90'))
    await commitPrice(parse6decimal('2801'))

    checkKeeperCompensation = true
  })

  it('user can cancel an order', async () => {
    // user places an order
    const nonce = await placeOrder(userA, Side.MAKER, Compare.GTE, parse6decimal('1001'), parse6decimal('-7'))
    expect(nonce).to.equal(BigNumber.from(504))

    // user cancels the order nonce
    await expect(manager.connect(userA).cancelOrder(market.address, nonce, TX_OVERRIDES))
      .to.emit(manager, 'OrderCancelled')
      .withArgs(market.address, userA.address, nonce)

    const storedOrder = await manager.orders(market.address, userA.address, nonce)
    compareOrders(storedOrder, EMPTY_ORDER)
  })

  it('user can cancel an order using a signed message', async () => {
    // user places an order
    const nonce = await placeOrder(userA, Side.MAKER, Compare.GTE, parse6decimal('1002'), parse6decimal('-6'))
    expect(nonce).to.equal(BigNumber.from(505))

    // user creates and signs a message to cancel the order nonce
    const message = {
      ...createActionMessage(userA.address, nonce),
    }
    const signature = await signCancelOrderAction(userA, verifier, message)

    // keeper handles the request
    await expect(manager.connect(keeper).cancelOrderWithSignature(message, signature, TX_OVERRIDES))
      .to.emit(manager, 'OrderCancelled')
      .withArgs(market.address, userA.address, nonce)

    const storedOrder = await manager.orders(market.address, userA.address, nonce)
    compareOrders(storedOrder, EMPTY_ORDER)

    checkKeeperCompensation = true
  })
})
