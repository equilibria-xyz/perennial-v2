import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import HRE from 'hardhat'

import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { parse6decimal } from '../../../../common/testutil/types'
import { IERC20, IFactory, IMarketFactory, IMarket, IOracleProvider } from '@perennial/v2-core/types/generated'

import {
  AggregatorV3Interface,
  ArbGasInfo,
  IAccount,
  IAccount__factory,
  IController,
  IEmptySetReserve,
  IOrderVerifier,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../../types/generated'
import { signCancelOrderAction, signCommon, signPlaceOrderAction } from '../../helpers/TriggerOrders/eip712'
import { OracleVersionStruct } from '../../../types/generated/contracts/TriggerOrders/test/TriggerOrderTester'
import { Compare, compareOrders, DEFAULT_TRIGGER_ORDER, Side } from '../../helpers/TriggerOrders/order'
import { deployController } from '../../helpers/setupHelpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

const { ethers } = HRE

const FIRST_ORDER_ID = BigNumber.from(300)

const MAX_FEE = utils.parseEther('3.8')

const KEEP_CONFIG = {
  multiplierBase: 0,
  bufferBase: 0,
  multiplierCalldata: 0,
  bufferCalldata: 0,
}

const MAKER_ORDER = {
  ...DEFAULT_TRIGGER_ORDER,
  side: Side.MAKER,
  comparison: Compare.LTE,
  price: parse6decimal('2222.33'),
  delta: parse6decimal('100'),
  maxFee: MAX_FEE,
}

const MARKET_UPDATE_ABSOLUTE_REF_PROTOTYPE = 'update(address,uint256,uint256,uint256,int256,bool,address)'

describe('Manager', () => {
  let usdc: FakeContract<IERC20>
  let dsu: FakeContract<IERC20>
  let reserve: FakeContract<IEmptySetReserve>
  let manager: Manager_Arbitrum
  let marketFactory: FakeContract<IMarketFactory>
  let market: FakeContract<IMarket>
  let marketOracle: FakeContract<IOracleProvider>
  let verifier: IOrderVerifier
  let controller: IController
  let ethOracle: FakeContract<AggregatorV3Interface>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let collateralAccountA: IAccount
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let nextOrderId = FIRST_ORDER_ID

  function advanceOrderId(): BigNumber {
    return (nextOrderId = nextOrderId.add(BigNumber.from(1)))
  }

  // deploys a collateral account
  async function createCollateralAccount(user: SignerWithAddress): Promise<IAccount> {
    const accountAddress = await controller.getAccountAddress(user.address)
    await controller.connect(user).deployAccount()
    return IAccount__factory.connect(accountAddress, user)
  }

  function createOracleVersion(price: BigNumber, valid = true): OracleVersionStruct {
    return {
      timestamp: Math.floor(Date.now() / 1000),
      price: price,
      valid: valid,
    }
  }

  const fixture = async () => {
    usdc = await smock.fake<IERC20>('IERC20')
    dsu = await smock.fake<IERC20>('IERC20')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market = await smock.fake<IMarket>('IMarket')
    verifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)
    controller = await deployController(owner, usdc.address, dsu.address, reserve.address, marketFactory.address)

    // deploy the order manager
    manager = await new Manager_Arbitrum__factory(owner).deploy(
      usdc.address,
      dsu.address,
      reserve.address,
      marketFactory.address,
      verifier.address,
      controller.address,
    )

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
    // no need for meaningful keep configs, as keeper compensation is not tested here
    await manager.initialize(ethOracle.address, KEEP_CONFIG, KEEP_CONFIG)

    // however users still need a collateral account, and manager must be operator
    collateralAccountA = await createCollateralAccount(userA)
    marketFactory.operators.whenCalledWith(userA.address, manager.address).returns(true)
  }

  before(async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    // Hardhat testnet does not support Arbitrum built-ins; need this for realistic keeper fees
    await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
  })

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
      advanceOrderId()
      await expect(manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, userA.address, MAKER_ORDER, nextOrderId)

      const order = await manager.orders(market.address, userA.address, nextOrderId)
      compareOrders(order, MAKER_ORDER)
    })

    it('cancels an order', async () => {
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      await expect(manager.connect(userA).cancelOrder(market.address, nextOrderId))
        .to.emit(manager, 'TriggerOrderCancelled')
        .withArgs(market.address, userA.address, nextOrderId)
    })

    it('replaces an order', async () => {
      // submit the original order
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      const replacement = { ...MAKER_ORDER }
      replacement.price = parse6decimal('2333.44')

      // submit a replacement with the same order nonce
      await expect(manager.connect(userA).placeOrder(market.address, nextOrderId, replacement))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, userA.address, replacement, nextOrderId)

      const order = await manager.orders(market.address, userA.address, nextOrderId)
      compareOrders(order, replacement)
    })

    it('prevents user from replacing with an empty order', async () => {
      // submit the original order
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      // user cannot overwrite an order with an empty order (should use cancelOrder instead)
      const replacement = {
        ...DEFAULT_TRIGGER_ORDER,
        side: 0,
        comparison: 0,
        price: 0,
        delta: 0,
        maxFee: MAX_FEE,
      }
      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderId, replacement),
      ).to.be.revertedWithCustomError(manager, 'TriggerOrderInvalidError')
    })

    it('prevents user from reducing maxFee', async () => {
      // submit the original order
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      // user cannot reduce maxFee
      const replacement = { ...MAKER_ORDER }
      replacement.maxFee = MAKER_ORDER.maxFee.sub(1)
      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderId, replacement),
      ).to.be.revertedWithCustomError(manager, 'ManagerCannotReduceMaxFee')

      // user cannot zero maxFee
      replacement.maxFee = constants.Zero
      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderId, replacement),
      ).to.be.revertedWithCustomError(manager, 'ManagerCannotReduceMaxFee')
    })

    it('keeper can execute orders', async () => {
      // place a maker and long order
      const nonce1 = advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)
      const nonce2 = advanceOrderId()
      const longOrder = {
        ...DEFAULT_TRIGGER_ORDER,
        side: Side.LONG,
        comparison: Compare.GTE,
        price: parse6decimal('2111.2'),
        delta: parse6decimal('60'),
      }
      await manager.connect(userB).placeOrder(market.address, nextOrderId, longOrder)

      // execute userA's order
      await manager.connect(keeper).executeOrder(market.address, userA.address, nonce1)
      expect(market.settle).to.have.been.calledWith(userA.address)
      expect(market.positions).to.have.been.calledWith(userA.address)
      expect(market[MARKET_UPDATE_ABSOLUTE_REF_PROTOTYPE]).to.have.been.calledWith(
        userA.address,
        MAKER_ORDER.delta,
        0,
        0,
        0,
        false,
        constants.AddressZero,
      )
      expect(dsu.transferFrom).to.have.been.calledWith(collateralAccountA.address, manager.address, 0)

      // reverts if not manager not operator
      await expect(
        manager.connect(keeper).executeOrder(market.address, userB.address, nonce2),
      ).to.be.revertedWithCustomError(controller, 'ControllerNotOperatorError')

      // reverts if no collateral account created
      marketFactory.operators.whenCalledWith(userB.address, manager.address).returns(true)
      await expect(manager.connect(keeper).executeOrder(market.address, userB.address, nonce2)).to.be.reverted

      // execute userB's order
      const collateralAccountB = await createCollateralAccount(userB)
      marketFactory.operators.whenCalledWith(userB.address, manager.address).returns(true)
      await manager.connect(keeper).executeOrder(market.address, userB.address, nonce2)
      expect(market.settle).to.have.been.calledWith(userB.address)
      expect(market.positions).to.have.been.calledWith(userB.address)
      expect(market[MARKET_UPDATE_ABSOLUTE_REF_PROTOTYPE]).to.have.been.calledWith(
        userB.address,
        0,
        longOrder.delta,
        0,
        0,
        false,
        constants.AddressZero,
      )
      expect(dsu.transferFrom).to.have.been.calledWith(collateralAccountB.address, manager.address, 0)
    })

    it('cannot cancel an executed maker order', async () => {
      // place an order
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      // execute the order
      await manager.connect(keeper).executeOrder(market.address, userA.address, nextOrderId)

      await expect(manager.connect(userA).cancelOrder(market.address, nextOrderId)).to.be.revertedWithCustomError(
        manager,
        'ManagerCannotCancelError',
      )
    })

    it('cannot cancel an already-cancelled order', async () => {
      // place an order
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      // cancel the order
      await manager.connect(userA).cancelOrder(market.address, nextOrderId)

      await expect(manager.connect(userA).cancelOrder(market.address, nextOrderId)).to.be.revertedWithCustomError(
        manager,
        'ManagerCannotCancelError',
      )
    })

    it('cannot reuse an order nonce from a cancelled order', async () => {
      // place and cancel an order, invalidating the order nonce
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)
      await manager.connect(userA).cancelOrder(market.address, nextOrderId)

      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER),
      ).to.revertedWithCustomError(manager, 'ManagerInvalidOrderNonceError')
    })

    it('cannot reuse an order nonce from an executed order', async () => {
      // place and execute an order, invalidating the order nonce
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)
      await manager.connect(keeper).executeOrder(market.address, userA.address, nextOrderId)

      await expect(
        manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER),
      ).to.revertedWithCustomError(manager, 'ManagerInvalidOrderNonceError')
    })

    interface TestScenario {
      comparison: Compare
      oraclePrice: BigNumber
      orderPrice: BigNumber
      expectedResult: boolean
    }

    async function testCheckOrder(scenario: TestScenario) {
      for (const side of [Side.MAKER, Side.LONG, Side.SHORT]) {
        marketOracle.latest.returns(createOracleVersion(scenario.oraclePrice))
        const order = {
          ...DEFAULT_TRIGGER_ORDER,
          side: side,
          comparison: scenario.comparison,
          price: scenario.orderPrice,
          delta: parse6decimal('9'),
        }
        advanceOrderId()
        await expect(manager.connect(userA).placeOrder(market.address, nextOrderId, order))
          .to.emit(manager, 'TriggerOrderPlaced')
          .withArgs(market.address, userA.address, order, nextOrderId)

        const [, canExecute] = await manager.checkOrder(market.address, userA.address, nextOrderId)
        expect(canExecute).to.equal(scenario.expectedResult)
      }
    }

    it('checks whether orders are executable when oracle price exceeds order price', async () => {
      // oracle price exceeds order price
      await testCheckOrder({
        comparison: Compare.LTE,
        oraclePrice: parse6decimal('2000'),
        orderPrice: parse6decimal('1999'),
        expectedResult: false,
      })
      await testCheckOrder({
        comparison: Compare.GTE,
        oraclePrice: parse6decimal('2000'),
        orderPrice: parse6decimal('1999'),
        expectedResult: true,
      })
    })

    it('checks whether orders are executable when order price exceeds oracle price', async () => {
      // oracle price exceeds order price
      await testCheckOrder({
        comparison: Compare.LTE,
        oraclePrice: parse6decimal('2001.332'),
        orderPrice: parse6decimal('2001.333'),
        expectedResult: true,
      })
      await testCheckOrder({
        comparison: Compare.GTE,
        oraclePrice: parse6decimal('2001.332'),
        orderPrice: parse6decimal('2001.333'),
        expectedResult: false,
      })
    })

    it('checks whether orders are executable when oracle price equals order price', async () => {
      // oracle price exceeds order price
      await testCheckOrder({
        comparison: Compare.LTE,
        oraclePrice: parse6decimal('2002.052'),
        orderPrice: parse6decimal('2002.052'),
        expectedResult: true,
      })
      await testCheckOrder({
        comparison: Compare.GTE,
        oraclePrice: parse6decimal('2002.052'),
        orderPrice: parse6decimal('2002.052'),
        expectedResult: true,
      })
    })
  })

  describe('#interface-fees', () => {
    const FIXED_FEE_AMOUNT = parse6decimal('0.25')

    beforeEach(async () => {
      expect(await manager.claimable(userB.address)).to.equal(0)
      // userA places an order with an interface fee
      const orderId = advanceOrderId()
      const makerOrderWithFee = {
        ...MAKER_ORDER,
        interfaceFee: {
          amount: FIXED_FEE_AMOUNT,
          receiver: userB.address,
          fixedFee: true,
          unwrap: false,
        },
      }
      await manager.connect(userA).placeOrder(market.address, orderId, makerOrderWithFee)

      // keeper executes the order, userB earns their fee
      await manager.connect(keeper).executeOrder(market.address, userA.address, orderId)
      expect(await manager.claimable(userB.address)).to.equal(FIXED_FEE_AMOUNT)
    })

    it('recipient can claim fee', async () => {
      await manager.connect(userB).claim(userB.address, false)
      expect(dsu.transfer).to.have.been.calledWith(userB.address, FIXED_FEE_AMOUNT.mul(1e12))
    })

    it('operator can claim fee', async () => {
      marketFactory.operators.whenCalledWith(userB.address, userA.address).returns(true)
      await manager.connect(userA).claim(userB.address, false)
      expect(dsu.transfer).to.have.been.calledWith(userA.address, FIXED_FEE_AMOUNT.mul(1e12))
    })

    it('non-operator can not claim fee', async () => {
      marketFactory.operators.whenCalledWith(userB.address, userA.address).returns(false)
      await expect(manager.connect(userA).claim(userB.address, false)).to.be.revertedWithCustomError(
        manager,
        'ManagerNotOperatorError',
      )
    })

    it('fee can be unwrapped', async () => {
      usdc.balanceOf.reset()
      usdc.balanceOf.returnsAtCall(0, 0)
      usdc.balanceOf.returnsAtCall(1, FIXED_FEE_AMOUNT)
      usdc.transfer.returns(true)
      await manager.connect(userB).claim(userB.address, true)
      expect(reserve.redeem).to.have.been.calledWith(FIXED_FEE_AMOUNT.mul(1e12))
      expect(usdc.transfer).to.have.been.calledWith(userB.address, FIXED_FEE_AMOUNT)
    })
  })

  describe('#signed-messages', () => {
    let currentTime: BigNumber
    let lastNonce = 0

    beforeEach(async () => {
      currentTime = BigNumber.from(await currentBlockTimestamp())
    })

    function createActionMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 30) {
      return {
        action: {
          market: market.address,
          orderId: nextOrderId,
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
      advanceOrderId()
      const message = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.MAKER,
          comparison: Compare.GTE,
          price: parse6decimal('1888.99'),
          delta: parse6decimal('200'),
        },
        ...createActionMessage(),
      }
      const signature = await signPlaceOrderAction(userA, verifier, message)

      await expect(manager.connect(keeper).placeOrderWithSignature(message, signature))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, userA.address, message.order, nextOrderId)

      const order = await manager.orders(market.address, userA.address, nextOrderId)
      compareOrders(order, message.order)
    })

    it('cancels a request to place an order', async () => {
      // send the relayer a request to place an order
      advanceOrderId()
      const message = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.MAKER,
          comparison: Compare.GTE,
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
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)

      // create and sign a message requesting cancellation of the order
      const message = {
        ...createActionMessage(),
      }
      const signature = await signCancelOrderAction(userA, verifier, message)

      // keeper processes the request
      await expect(manager.connect(keeper).cancelOrderWithSignature(message, signature))
        .to.emit(manager, 'TriggerOrderCancelled')
        .withArgs(market.address, userA.address, message.action.orderId)
    })

    it('keeper can execute short order placed from a signed message', async () => {
      // directly place and execute a maker order
      advanceOrderId()
      await manager.connect(userA).placeOrder(market.address, nextOrderId, MAKER_ORDER)
      await manager.connect(keeper).executeOrder(market.address, userA.address, nextOrderId)

      // place a short order using a signed message
      // different user can use the same order nonce
      const message = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.SHORT,
          comparison: Compare.GTE,
          price: parse6decimal('1888.99'),
          delta: parse6decimal('30'),
          referrer: userA.address,
        },
        ...createActionMessage(userB.address),
      }
      const signature = await signPlaceOrderAction(userB, verifier, message)

      // keeper places the order
      await createCollateralAccount(userB)
      await marketFactory.operators.whenCalledWith(userB.address, manager.address).returns(true)
      await expect(manager.connect(keeper).placeOrderWithSignature(message, signature))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, userB.address, message.order, nextOrderId)

      // keeper executes the short order
      await manager.connect(keeper).executeOrder(market.address, userB.address, nextOrderId)
    })
  })
})
