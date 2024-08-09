import { expect } from 'chai'
import { BigNumber, BigNumberish, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { advanceBlock, currentBlockTimestamp, increase } from '../../../common/testutil/time'
import { getEventArguments } from '../../../common/testutil/transaction'
import { parse6decimal } from '../../../common/testutil/types'

import { IERC20Metadata, IMarketFactory, IMarket, IOracleProvider } from '@equilibria/perennial-v2/types/generated'
import { IKeeperOracle, IOracleFactory } from '@equilibria/perennial-v2-oracle/types/generated'
import {
  ArbGasInfo,
  IOrderVerifier,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../types/generated'

import { signAction, signCancelOrderAction, signPlaceOrderAction } from '../helpers/eip712'
import { createMarketETH, deployProtocol, deployPythOracleFactory, fundWalletDSU } from '../helpers/arbitrumHelpers'
import { Compare, compareOrders, MAGIC_VALUE_CLOSE_POSITION, orderFromStructOutput, Side } from '../helpers/order'
import { transferCollateral } from '../helpers/marketHelpers'
import { advanceToPrice } from '../helpers/oracleHelpers'
import { PlaceOrderActionStruct } from '../../types/generated/contracts/Manager'
import { Address } from 'hardhat-deploy/dist/types'
import { smock } from '@defi-wonderland/smock'
import { impersonate } from '../../../common/testutil'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

const MAX_FEE = utils.parseEther('7')

const EMPTY_ORDER = {
  side: 0,
  comparison: 0,
  price: 0,
  delta: 0,
  maxFee: 0,
  isSpent: false,
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
  isSpent: false,
  referrer: constants.AddressZero,
}

// because we called hardhat_setNextBlockBaseFeePerGas, need this when running tests under coverage
const TX_OVERRIDES = { maxFeePerGas: 150_000_000 }

describe('Manager_Arbitrum', () => {
  let dsu: IERC20Metadata
  let keeperOracle: IKeeperOracle
  let manager: Manager_Arbitrum
  let marketFactory: IMarketFactory
  let market: IMarket
  let oracle: IOracleProvider
  let verifier: IOrderVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let userD: SignerWithAddress
  let keeper: SignerWithAddress
  let oracleFeeReceiver: SignerWithAddress
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
    ;[owner, userA, userB, userC, userD, keeper, oracleFeeReceiver] = await ethers.getSigners()
    let oracleFactory: IOracleFactory
    ;[marketFactory, dsu, oracleFactory] = await deployProtocol(owner)
    const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory)
    ;[market, oracle, keeperOracle] = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)

    // deploy the order manager
    verifier = await new OrderVerifier__factory(owner).deploy()
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)
    await manager['initialize(address,(uint256,uint256,uint256,uint256))'](CHAINLINK_ETH_USD_FEED, KEEP_CONFIG)

    // commit a start price
    await commitPrice(parse6decimal('4444'))

    // fund accounts and deposit all into market
    const amount = parse6decimal('100000')
    await setupUser(userA, amount)
    await setupUser(userB, amount)
    await setupUser(userC, amount)
    await setupUser(userD, amount)
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
  async function commitPrice(
    price = lastPriceCommitted,
    timestamp: BigNumber | undefined = undefined,
  ): Promise<number> {
    if (!timestamp) timestamp = await oracle.current()

    lastPriceCommitted = price
    return advanceToPrice(keeperOracle, oracleFeeReceiver, timestamp!, price, TX_OVERRIDES)
  }

  function createActionMessage(
    userAddress: Address,
    nonce = nextMessageNonce(),
    signerAddress = userAddress,
    expiresInSeconds = 24,
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

  async function ensureNoPosition(user: SignerWithAddress) {
    const position = await market.positions(user.address)
    expect(position.maker).to.equal(0)
    expect(position.long).to.equal(0)
    expect(position.short).to.equal(0)
    const pending = await market.pendings(user.address)
    expect(pending.makerPos.sub(pending.makerNeg)).to.equal(0)
    expect(pending.longPos.sub(pending.longNeg)).to.equal(0)
    expect(pending.shortPos.sub(pending.shortNeg)).to.equal(0)
  }

  // executes an order as keeper
  async function executeOrder(user: SignerWithAddress, orderNonce: BigNumberish): Promise<BigNumber> {
    // ensure order is executable
    const [order, canExecute] = await manager.checkOrder(market.address, user.address, orderNonce)
    expect(canExecute).to.be.true

    // validate event
    const tx = await manager.connect(keeper).executeOrder(market.address, user.address, orderNonce, TX_OVERRIDES)
    // set the order's spent flag true to validate event
    const spentOrder = { ...orderFromStructOutput(order), isSpent: true }
    await expect(tx)
      .to.emit(manager, 'TriggerOrderExecuted')
      .withArgs(market.address, user.address, spentOrder, orderNonce)
      .to.emit(market, 'OrderCreated')
      .withArgs(user.address, anyValue, anyValue, constants.AddressZero, order.referrer, constants.AddressZero)
    const timestamp = (await ethers.provider.getBlock(tx.blockNumber!)).timestamp

    // ensure trigger order was marked as spent
    const deletedOrder = await manager.orders(market.address, user.address, orderNonce)
    expect(deletedOrder.isSpent).to.be.true

    return BigNumber.from(timestamp)
  }

  async function getPendingPosition(user: SignerWithAddress, side: Side) {
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

    return actualPos.add(pendingPos)
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
      isSpent: false,
      referrer: referrer,
    }
    advanceOrderNonce(user)
    const nonce = nextOrderNonce[user.address]
    await expect(manager.connect(user).placeOrder(market.address, nonce, order, TX_OVERRIDES))
      .to.emit(manager, 'TriggerOrderPlaced')
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
        isSpent: false,
        referrer: referrer,
      },
      ...createActionMessage(user.address),
    }
    const signature = await signPlaceOrderAction(user, verifier, message)

    await expect(manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES))
      .to.emit(manager, 'TriggerOrderPlaced')
      .withArgs(market.address, user.address, message.order, message.action.orderNonce)

    const storedOrder = await manager.orders(market.address, user.address, message.action.orderNonce)
    compareOrders(storedOrder, message.order)

    return BigNumber.from(message.action.orderNonce)
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

  // covers extension functionality; userA adds maker liquidity funding userB's long position
  describe('empty market', () => {
    it('constructs and initializes', async () => {
      expect(await manager.DSU()).to.equal(dsu.address)
      expect(await manager.marketFactory()).to.equal(marketFactory.address)
      expect(await manager.verifier()).to.equal(verifier.address)
    })

    it('manager can verify a no-op action message', async () => {
      // ensures any problems with message encoding are not caused by a common data type
      const message = createActionMessage(userB.address).action
      const signature = await signAction(userB, verifier, message)

      const managerSigner = await impersonate.impersonateWithBalance(manager.address, utils.parseEther('10'))
      await expect(verifier.connect(managerSigner).verifyAction(message, signature, TX_OVERRIDES))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(userB.address, message.common.nonce)

      expect(await verifier.nonces(userB.address, message.common.nonce)).to.eq(true)
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
      expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('100'))
      expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.5'))
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

      expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('90'))
      await commitPrice(parse6decimal('2801'))

      checkKeeperCompensation = true
    })

    it('user can cancel an order', async () => {
      // user places an order
      const nonce = await placeOrder(userA, Side.MAKER, Compare.GTE, parse6decimal('1001'), parse6decimal('-7'))
      expect(nonce).to.equal(BigNumber.from(504))

      // user cancels the order nonce
      await expect(manager.connect(userA).cancelOrder(market.address, nonce, TX_OVERRIDES))
        .to.emit(manager, 'TriggerOrderCancelled')
        .withArgs(market.address, userA.address, nonce)

      const storedOrder = await manager.orders(market.address, userA.address, nonce)
      expect(storedOrder.isSpent).to.be.true
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
        .to.emit(manager, 'TriggerOrderCancelled')
        .withArgs(market.address, userA.address, nonce)

      const storedOrder = await manager.orders(market.address, userA.address, nonce)
      expect(storedOrder.isSpent).to.be.true

      checkKeeperCompensation = true
    })

    it('non-delegated signer cannot interact', async () => {
      // userB signs a message to change userA's position
      advanceOrderNonce(userA)
      const message: PlaceOrderActionStruct = {
        order: {
          side: Side.MAKER,
          comparison: Compare.GTE,
          price: parse6decimal('1003'),
          delta: parse6decimal('2'),
          maxFee: MAX_FEE,
          isSpent: false,
          referrer: constants.AddressZero,
        },
        ...createActionMessage(userA.address, nextMessageNonce(), userB.address),
      }
      const signature = await signPlaceOrderAction(userB, verifier, message)

      await expect(
        manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES),
      ).to.be.revertedWithCustomError(manager, 'ManagerInvalidSignerError')
    })

    it('delegated signer may interact', async () => {
      // userA delegates userB
      await marketFactory.connect(userA).updateSigner(userB.address, true, TX_OVERRIDES)

      // userB signs a message to change userA's position
      advanceOrderNonce(userA)
      const message: PlaceOrderActionStruct = {
        order: {
          side: Side.MAKER,
          comparison: Compare.GTE,
          price: parse6decimal('1004'),
          delta: parse6decimal('3'),
          maxFee: MAX_FEE,
          isSpent: false,
          referrer: constants.AddressZero,
        },
        ...createActionMessage(userA.address, nextMessageNonce(), userB.address),
      }
      const signature = await signPlaceOrderAction(userB, verifier, message)

      await expect(manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, userA.address, message.order, message.action.orderNonce)

      const storedOrder = await manager.orders(market.address, userA.address, message.action.orderNonce)
      compareOrders(storedOrder, message.order)
    })

    it('users can close positions', async () => {
      // can close directly
      let nonce = await placeOrder(userA, Side.MAKER, Compare.GTE, constants.Zero, MAGIC_VALUE_CLOSE_POSITION)
      expect(nonce).to.equal(BigNumber.from(508))

      // can close using a signed message
      nonce = await placeOrderWithSignature(
        userB,
        Side.LONG,
        Compare.LTE,
        parse6decimal('4000'),
        MAGIC_VALUE_CLOSE_POSITION,
      )
      expect(nonce).to.equal(BigNumber.from(502))

      // keeper closes the taker position before removing liquidity
      await executeOrder(userB, 502)
      await commitPrice()
      await executeOrder(userA, 508)
      await commitPrice()

      // settle and confirm positions are closed
      await market.settle(userA.address, TX_OVERRIDES)
      await ensureNoPosition(userA)
      await market.settle(userB.address, TX_OVERRIDES)
      await ensureNoPosition(userB)
    })
  })

  // tests interaction with markets; again userA has a maker position, userB has a long position,
  // userC and userD interact only with trigger orders
  describe('funded market', () => {
    async function changePosition(
      user: SignerWithAddress,
      newMaker: BigNumberish = constants.MaxUint256,
      newLong: BigNumberish = constants.MaxUint256,
      newShort: BigNumberish = constants.MaxUint256,
    ): Promise<BigNumber> {
      const tx = await market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          user.address,
          newMaker,
          newLong,
          newShort,
          0,
          false,
          TX_OVERRIDES,
        )
      return (await getEventArguments(tx, 'OrderCreated')).order.timestamp
    }

    before(async () => {
      // ensure no positions were carried over from previous test suite
      await ensureNoPosition(userA)
      await ensureNoPosition(userB)

      await changePosition(userA, parse6decimal('10'), 0, 0)
      await commitPrice(parse6decimal('2000'))
      await market.settle(userA.address, TX_OVERRIDES)

      nextOrderNonce[userA.address] = BigNumber.from(600)
      nextOrderNonce[userB.address] = BigNumber.from(600)
      nextOrderNonce[userC.address] = BigNumber.from(600)
      nextOrderNonce[userD.address] = BigNumber.from(600)
    })

    it('can execute an order with pending position before oracle request fulfilled', async () => {
      // userB has an unsettled long 1.2 position
      await changePosition(userB, 0, parse6decimal('1.2'), 0)
      expect((await market.positions(userB.address)).long).to.equal(0)
      expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('1.2'))

      // userB places an order to go long 0.8 more, and keeper executes it
      const nonce = await placeOrder(userB, Side.LONG, Compare.LTE, parse6decimal('2013'), parse6decimal('0.8'))
      expect(nonce).to.equal(BigNumber.from(601))
      advanceBlock()
      const orderTimestamp = await executeOrder(userB, 601)

      // userB still has no settled position
      expect((await market.positions(userB.address)).long).to.equal(0)
      // but the order should increase their pending position to 2
      expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.0'))

      // commit price for both their 1.2 position and the 0.8 added through trigger order
      await commitPrice(parse6decimal('2001.01'), await keeperOracle.next())
      await commitPrice(parse6decimal('2001.02'), orderTimestamp)
      // settle userB and check position
      await market.settle(userB.address, TX_OVERRIDES)
      expect((await market.positions(userB.address)).long).to.equal(parse6decimal('2.0'))
    })

    it('can execute an order with pending position after oracle request fulfilled', async () => {
      // userC has an unsettled short 0.3 position
      await changePosition(userC, 0, 0, parse6decimal('1.3'))
      expect((await market.positions(userC.address)).short).to.equal(0)
      expect(await getPendingPosition(userC, Side.SHORT)).to.equal(parse6decimal('1.3'))

      // userC places an order to go short 1.2 more, and keeper executes it
      const nonce = await placeOrder(userC, Side.SHORT, Compare.GTE, parse6decimal('1999.97'), parse6decimal('1.2'))
      expect(nonce).to.equal(BigNumber.from(601))
      advanceBlock()
      const orderTimestamp = await executeOrder(userC, 601)

      // prices are committed for both versions
      await commitPrice(parse6decimal('2002.03'), await keeperOracle.next())
      await commitPrice(parse6decimal('2002.04'), orderTimestamp)

      // userC still has no settled position
      expect((await market.positions(userC.address)).long).to.equal(0)
      // but the order should increase their short position to 2.5
      expect(await getPendingPosition(userC, Side.SHORT)).to.equal(parse6decimal('2.5'))

      // after settling userC, they should be short 2.5
      await market.settle(userC.address, TX_OVERRIDES)
      expect((await market.positions(userC.address)).short).to.equal(parse6decimal('2.5'))
    })

    it('can execute an order once market conditions allow', async () => {
      // userD places an order to go long 3 once price dips below 2000
      const triggerPrice = parse6decimal('2000')
      const nonce = await placeOrder(userD, Side.LONG, Compare.LTE, triggerPrice, parse6decimal('3'))
      expect(nonce).to.equal(BigNumber.from(601))
      advanceBlock()

      // the order is not yet executable
      const [, canExecuteBefore] = await manager.checkOrder(market.address, userD.address, nonce)
      expect(canExecuteBefore).to.be.false

      // time passes, other users interact with market
      let positionA = (await market.positions(userA.address)).maker
      let positionC = (await market.positions(userC.address)).short
      let marketPrice = (await oracle.latest()).price

      while (marketPrice.gt(triggerPrice)) {
        // two users change their position
        positionA = positionA.add(parse6decimal('0.05'))
        const timestampA = await changePosition(userA, positionA, 0, 0)
        positionC = positionC.sub(parse6decimal('0.04'))
        const timestampC = await changePosition(userC, 0, 0, positionC)

        // oracle versions fulfilled
        marketPrice = marketPrice.sub(parse6decimal('0.35'))
        await commitPrice(marketPrice, timestampA)
        await commitPrice(marketPrice, timestampC)

        // advance 5 minutes
        await increase(60 * 5)
        advanceBlock()

        // userA settled each time
        await market.settle(userA.address, TX_OVERRIDES)
      }
      // userC settled after considerable time
      await market.settle(userC.address, TX_OVERRIDES)

      // confirm order is now executable
      const [, canExecuteAfter] = await manager.checkOrder(market.address, userD.address, nonce)
      expect(canExecuteAfter).to.be.true

      // execute order
      const orderTimestamp = await executeOrder(userD, 601)
      expect(await getPendingPosition(userD, Side.LONG)).to.equal(parse6decimal('3'))

      // fulfill oracle version and settle
      await commitPrice(parse6decimal('2000.1'), orderTimestamp)
      await market.settle(userD.address, TX_OVERRIDES)
      expect((await market.positions(userD.address)).long).to.equal(parse6decimal('3'))
    })
  })
})
