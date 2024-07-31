import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'

import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { IERC20, IFactory, IMarketFactory, IMarket, IOracleProvider } from '@equilibria/perennial-v2/types/generated'

import {
  AggregatorV3Interface,
  IOrderVerifier,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../types/generated'
import { signCancelOrderAction, signCommon, signPlaceOrderAction } from '../helpers/eip712'
import { OracleVersionStruct } from '../../types/generated/contracts/test/TriggerOrderTester'
import { Compare, Side } from '../helpers/order'

const { ethers } = HRE

const FIRST_ORDER_NONCE = BigNumber.from(300)

const KEEP_CONFIG = {
  multiplierBase: 0,
  bufferBase: 1_000_000,
  multiplierCalldata: 0,
  bufferCalldata: 500_000,
}

const MAKER_ORDER = {
  side: Side.MAKER,
  comparison: Compare.LT,
  price: parse6decimal('2222.33'),
  delta: parse6decimal('100'),
}

const MAX_FEE = utils.parseEther('7')

describe('Manager', () => {
  let dsu: FakeContract<IERC20>
  let manager: Manager_Arbitrum
  let marketFactory: FakeContract<IMarketFactory>
  let market: FakeContract<IMarket>
  let marketOracle: FakeContract<IOracleProvider>
  let verifier: IOrderVerifier
  let ethOracle: FakeContract<AggregatorV3Interface>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let nextOrderNonce = FIRST_ORDER_NONCE

  function advanceOrderNonce() {
    nextOrderNonce = nextOrderNonce.add(BigNumber.from(1))
  }

  function createOracleVersion(price: BigNumber, valid = true): OracleVersionStruct {
    return {
      timestamp: Math.floor(Date.now() / 1000),
      price: price,
      valid: valid,
    }
  }

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = await smock.fake<IERC20>('IERC20')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market = await smock.fake<IMarket>('IMarket')
    verifier = await new OrderVerifier__factory(owner).deploy()

    // deploy the order manager
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)

    dsu.approve.whenCalledWith(manager.address).returns(true)
    dsu.transferFrom.returns(true)
    dsu.transfer.returns(true)

    // fake an oracle, for testing market comparison
    marketOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    market.oracle.returns(marketOracle.address)
    marketOracle.latest.returns(createOracleVersion(parse6decimal('2111.22')))
    const oracleFactory = await smock.fake<IFactory>('IFactory')
    oracleFactory.instances.whenCalledWith(marketOracle.address).returns(true)
    marketFactory.oracleFactory.returns(oracleFactory)

    // initialize the order manager
    ethOracle = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    ethOracle.latestRoundData.returns({
      roundId: 0,
      answer: BigNumber.from(3131e8),
      startedAt: 0,
      updatedAt: 0,
      answeredInRound: 0,
    })
    await manager.initialize(ethOracle.address, KEEP_CONFIG)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  describe('#direct-interaction', () => {
    it('constructs and initializes', async () => {
      expect(await manager.DSU()).to.equal(dsu.address)
      expect(await manager.marketFactory()).to.equal(marketFactory.address)
      expect(await manager.verifier()).to.equal(verifier.address)
    })

    it('places an order', async () => {
      advanceOrderNonce()
      await expect(manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER))
        .to.emit(manager, 'OrderPlaced')
        .withArgs(market.address, userA.address, MAKER_ORDER, nextOrderNonce)

      const order = await manager.orders(market.address, userA.address, nextOrderNonce)
      expect(order.side).to.equal(MAKER_ORDER.side)
      expect(order.comparison).to.equal(MAKER_ORDER.comparison)
      expect(order.price).to.equal(MAKER_ORDER.price)
      expect(order.delta).to.equal(MAKER_ORDER.delta)
    })

    it('cancels an order', async () => {
      advanceOrderNonce()
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)

      await expect(manager.connect(userA).cancelOrder(market.address, nextOrderNonce))
        .to.emit(manager, 'OrderCancelled')
        .withArgs(market.address, userA.address, nextOrderNonce)
    })

    it('replaces an order', async () => {
      // submit the original order
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)

      const replacement = MAKER_ORDER
      replacement.price = parse6decimal('2333.44')

      // submit a replacement with the same order nonce
      await expect(manager.connect(userA).placeOrder(market.address, nextOrderNonce, replacement))
        .to.emit(manager, 'OrderPlaced')
        .withArgs(market.address, userA.address, replacement, nextOrderNonce)

      const order = await manager.orders(market.address, userA.address, nextOrderNonce)
      expect(order.side).to.equal(replacement.side)
      expect(order.comparison).to.equal(replacement.comparison)
      expect(order.price).to.equal(replacement.price)
      expect(order.delta).to.equal(replacement.delta)
    })

    it('cannot cancel an executed order', async () => {
      // place an order
      advanceOrderNonce()
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)

      // execute the order
      await manager.connect(keeper).executeOrder(market.address, userA.address, nextOrderNonce)

      await expect(manager.connect(userA).cancelOrder(market.address, nextOrderNonce)).to.be.revertedWithCustomError(
        manager,
        'ManagerCannotCancelError',
      )
    })

    it('cannot cancel an already-cancelled order', async () => {
      // place an order
      advanceOrderNonce()
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)

      // cancel the order
      await manager.connect(userA).cancelOrder(market.address, nextOrderNonce)

      await expect(manager.connect(userA).cancelOrder(market.address, nextOrderNonce)).to.be.revertedWithCustomError(
        manager,
        'ManagerCannotCancelError',
      )
    })

    it('cannot reuse an order nonce from a cancelled order', async () => {
      // place and cancel an order, invalidating the order nonce
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)
      await manager.connect(userA).cancelOrder(market.address, nextOrderNonce)

      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER),
      ).to.revertedWithCustomError(manager, 'ManagerInvalidOrderNonceError')
    })

    it('cannot reuse an order nonce from an executed order', async () => {
      // place and execute an order, invalidating the order nonce
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)
      await manager.connect(keeper).executeOrder(market.address, userA.address, nextOrderNonce)

      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER),
      ).to.revertedWithCustomError(manager, 'ManagerInvalidOrderNonceError')
    })

    it('checks whether an order is executable', async () => {
      // check an executable order
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)
      expect(await manager.checkOrder(market.address, userA.address, nextOrderNonce)).to.be.true
      advanceOrderNonce()

      // check an unexecutable order
      const unexecutableOrder = MAKER_ORDER
      unexecutableOrder.comparison = Compare.GTE
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, unexecutableOrder)
      expect(await manager.checkOrder(market.address, userA.address, nextOrderNonce)).to.be.false
    })
  })

  describe('#signed-messages', () => {
    let currentTime: BigNumber
    let lastNonce = 0

    beforeEach(async () => {
      currentTime = BigNumber.from(await currentBlockTimestamp())
    })

    function createActionMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 6) {
      return {
        action: {
          market: market.address,
          orderNonce: nextOrderNonce,
          maxFee: MAX_FEE,
          common: {
            account: userAddress,
            signer: signerAddress,
            domain: manager.address,
            nonce: nextNonce(),
            group: 0,
            expiry: currentTime.add(expiresInSeconds),
          },
        },
      }
    }

    function nextNonce(): BigNumber {
      return BigNumber.from(++lastNonce)
    }

    it('places an order using a signed message', async () => {
      advanceOrderNonce()
      const message = {
        order: {
          side: 0,
          comparison: 1,
          price: parse6decimal('1888.99'),
          delta: parse6decimal('200'),
        },
        ...createActionMessage(),
      }
      const signature = await signPlaceOrderAction(userA, verifier, message)

      await expect(manager.connect(keeper).placeOrderWithSignature(message, signature))
        .to.emit(manager, 'OrderPlaced')
        .withArgs(market.address, userA.address, message.order, nextOrderNonce)

      const order = await manager.orders(market.address, userA.address, nextOrderNonce)
      expect(order.side).to.equal(message.order.side)
      expect(order.comparison).to.equal(message.order.comparison)
      expect(order.price).to.equal(message.order.price)
      expect(order.delta).to.equal(message.order.delta)
    })

    it('cancels a request to place an order', async () => {
      // send the relayer a request to place an order
      advanceOrderNonce()
      const message = {
        order: {
          side: 0,
          comparison: 1,
          price: parse6decimal('1777.88'),
          delta: parse6decimal('100'),
        },
        ...createActionMessage(),
      }
      const signature = await signPlaceOrderAction(userA, verifier, message)

      // before processed, send the relayer a cancellation message
      const cancelMessage = {
        account: userA.address,
        signer: userA.address,
        domain: verifier.address,
        nonce: message.action.common.nonce,
        group: 0,
        expiry: constants.MaxUint256,
      }
      const cancelSignature = await signCommon(userA, verifier, cancelMessage)

      // relayer captures the cancel message and keeper processes that first
      await expect(verifier.connect(keeper).cancelNonceWithSignature(cancelMessage, cancelSignature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(message.action.common.account, message.action.common.nonce)

      // users original order message should be rejected
      await expect(manager.connect(keeper).placeOrderWithSignature(message, signature)).to.be.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )
    })

    it('cancels a placed order', async () => {
      // place an order
      advanceOrderNonce()
      await manager.connect(userA).placeOrder(market.address, nextOrderNonce, MAKER_ORDER)

      // create and sign a message requesting cancellation of the order
      const message = {
        ...createActionMessage(),
      }
      const signature = await signCancelOrderAction(userA, verifier, message)

      // keeper processes the request
      await expect(manager.connect(keeper).cancelOrderWithSignature(message, signature))
        .to.emit(manager, 'OrderCancelled')
        .withArgs(market.address, userA.address, message.action.orderNonce)
    })
  })
})
