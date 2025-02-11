import { expect } from 'chai'
import { BigNumber, BigNumberish, CallOverrides, constants, utils } from 'ethers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'

import { advanceBlock, currentBlockTimestamp, increase } from '../../../../../common/testutil/time'
import { getEventArguments, getTimestamp } from '../../../../../common/testutil/transaction'
import { parse6decimal } from '../../../../../common/testutil/types'

import { IERC20Metadata, IMarketFactory, IMarket, IOracleProvider } from '@perennial/v2-core/types/generated'
import { IKeeperOracle } from '@perennial/v2-oracle/types/generated'
import {
  IAccount,
  IAccount__factory,
  IController,
  IEmptySetReserve,
  IManager,
  IOrderVerifier,
} from '../../../../types/generated'
import { PlaceOrderActionStruct } from '../../../../types/generated/contracts/TriggerOrders/Manager'

import { signAction, signCancelOrderAction, signPlaceOrderAction } from '../../../helpers/TriggerOrders/eip712'
import {
  Compare,
  compareOrders,
  DEFAULT_TRIGGER_ORDER,
  MAGIC_VALUE_CLOSE_POSITION,
  orderFromStructOutput,
  Side,
} from '../../../helpers/TriggerOrders/order'
import { transferCollateral } from '../../../helpers/marketHelpers'
import { advanceToPrice } from '../../../helpers/oracleHelpers'
import { Address } from 'hardhat-deploy/dist/types'
import { impersonate } from '../../../../../common/testutil'
import { FixtureVars } from './setupTypes'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const MAX_FEE = utils.parseEther('0.88')

const NO_INTERFACE_FEE = {
  interfaceFee: {
    amount: constants.Zero,
    receiver: constants.AddressZero,
    fixedFee: false,
    unwrap: false,
  },
}

// because we called hardhat_setNextBlockBaseFeePerGas, need this when running tests under coverage
const TX_OVERRIDES = { maxPriorityFeePerGas: 0, maxFeePerGas: 150_000_000 }

export function RunManagerTests(
  name: string,
  getFixture: (overrides?: CallOverrides) => Promise<FixtureVars>,
  fundWalletDSU: (wallet: SignerWithAddress, amount: BigNumber, overrides?: CallOverrides) => Promise<undefined>,
): void {
  describe(name, () => {
    let dsu: IERC20Metadata
    let usdc: IERC20Metadata
    let reserve: IEmptySetReserve
    let keeperOracle: IKeeperOracle
    let manager: IManager
    let marketFactory: IMarketFactory
    let market: IMarket
    let oracle: IOracleProvider
    let verifier: IOrderVerifier
    let controller: IController
    let owner: SignerWithAddress
    let userA: SignerWithAddress
    let userB: SignerWithAddress
    let userC: SignerWithAddress
    let userD: SignerWithAddress
    let keeper: SignerWithAddress
    let oracleFeeReceiver: SignerWithAddress
    let currentTime: BigNumber
    let keeperBalanceBefore: BigNumber
    let keeperEthBalanceBefore: BigNumber
    let lastMessageNonce = 0
    let lastPriceCommitted: BigNumber
    const nextOrderId: { [key: string]: BigNumber } = {}

    function advanceOrderId(user: SignerWithAddress) {
      nextOrderId[user.address] = nextOrderId[user.address].add(BigNumber.from(1))
    }

    async function checkCompensation(priceCommitments = 0) {
      await expect(manager.connect(keeper).claim(keeper.address, false, TX_OVERRIDES))
      const keeperFeesPaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      let keeperEthSpentOnGas = keeperEthBalanceBefore.sub(await keeper.getBalance())

      // If TXes in test required outside price commitments, compensate the keeper for them.
      // Note that calls to `commitPrice` in this module do not consume keeper gas.
      keeperEthSpentOnGas = keeperEthSpentOnGas.add(utils.parseEther('0.0000644306').mul(priceCommitments))

      // cost of transaction
      const keeperGasCostInUSD = keeperEthSpentOnGas.mul(2603)
      // keeper should be compensated between 100-200% of actual gas cost
      expect(keeperFeesPaid).to.be.within(keeperGasCostInUSD, keeperGasCostInUSD.mul(2))
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
          orderId: nextOrderId[userAddress],
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

    // deploys a collateral account
    async function createCollateralAccount(user: SignerWithAddress): Promise<IAccount> {
      const accountAddress = await controller.getAccountAddress(user.address)
      await controller.connect(user).deployAccount(TX_OVERRIDES)
      return IAccount__factory.connect(accountAddress, user)
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
    async function executeOrder(
      user: SignerWithAddress,
      orderId: BigNumberish,
      expectedInterfaceFee: BigNumber | undefined = undefined,
    ): Promise<BigNumber> {
      // ensure order is executable
      const [order, canExecute] = await manager.checkOrder(market.address, user.address, orderId)
      expect(canExecute).to.be.true

      // validate event
      const tx = await manager.connect(keeper).executeOrder(market.address, user.address, orderId, TX_OVERRIDES)
      // set the order's spent flag true to validate event
      const spentOrder = { ...orderFromStructOutput(order), isSpent: true }
      await expect(tx)
        .to.emit(manager, 'TriggerOrderExecuted')
        .withArgs(market.address, user.address, spentOrder, orderId)
        .to.emit(market, 'OrderCreated')
        .withArgs(user.address, anyValue, anyValue, constants.AddressZero, order.referrer, constants.AddressZero)
      if (order.interfaceFee.amount.gt(0)) {
        if (!expectedInterfaceFee && order.interfaceFee.fixedFee) {
          expectedInterfaceFee = order.interfaceFee.amount
        }
        if (expectedInterfaceFee) {
          await expect(tx)
            .to.emit(manager, 'TriggerOrderInterfaceFeeCharged')
            .withArgs(user.address, market.address, order.interfaceFee)
          const collateralAccountAddress = await controller.getAccountAddress(user.address)
          if (order.interfaceFee.unwrap) {
            await expect(tx)
              .to.emit(dsu, 'Transfer')
              .withArgs(collateralAccountAddress, manager.address, expectedInterfaceFee.mul(1e12))
          } else {
            await expect(tx)
              .to.emit(dsu, 'Transfer')
              .withArgs(collateralAccountAddress, manager.address, expectedInterfaceFee.mul(1e12))
          }
        }
      }
      const timestamp = await getTimestamp(tx)
      // ensure trigger order was marked as spent
      const deletedOrder = await manager.orders(market.address, user.address, orderId)
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
      interfaceFee = NO_INTERFACE_FEE,
    ): Promise<BigNumber> {
      const order = {
        side: side,
        comparison: comparison,
        price: price,
        delta: delta,
        maxFee: maxFee,
        isSpent: false,
        referrer: referrer,
        ...interfaceFee,
      }
      advanceOrderId(user)
      const orderId = nextOrderId[user.address]
      await expect(manager.connect(user).placeOrder(market.address, orderId, order, TX_OVERRIDES))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, user.address, order, orderId)

      const storedOrder = await manager.orders(market.address, user.address, orderId)
      compareOrders(storedOrder, order)
      return orderId
    }

    async function placeOrderWithSignature(
      user: SignerWithAddress,
      side: Side,
      comparison: Compare,
      price: BigNumber,
      delta: BigNumber,
      maxFee = MAX_FEE,
      referrer = constants.AddressZero,
      interfaceFee = NO_INTERFACE_FEE,
    ): Promise<BigNumber> {
      advanceOrderId(user)
      const message: PlaceOrderActionStruct = {
        order: {
          side: side,
          comparison: comparison,
          price: price,
          delta: delta,
          maxFee: maxFee,
          isSpent: false,
          referrer: referrer,
          ...interfaceFee,
        },
        ...createActionMessage(user.address),
      }
      const signature = await signPlaceOrderAction(user, verifier, message)

      await expect(manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES))
        .to.emit(manager, 'TriggerOrderPlaced')
        .withArgs(market.address, user.address, message.order, message.action.orderId)

      const storedOrder = await manager.orders(market.address, user.address, message.action.orderId)
      compareOrders(storedOrder, message.order)

      return BigNumber.from(message.action.orderId)
    }

    // set a realistic base gas fee to get realistic keeper compensation
    async function setNextBlockBaseFee() {
      await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100']) // 0.1 gwei
    }

    // prepares an account for use with the market and manager
    async function setupUser(
      dsu: IERC20Metadata,
      marketFactory: IMarketFactory,
      market: IMarket,
      manager: IManager,
      user: SignerWithAddress,
      amount: BigNumber,
    ) {
      // funds, approves, and deposits DSU into the market
      const reservedForFees = amount.mul(1).div(100)
      await fundWalletDSU(user, amount.mul(1e12))
      await dsu.connect(user).approve(market.address, amount.mul(1e12))
      await transferCollateral(user, market, amount.sub(reservedForFees))

      // allows manager to interact with markets on the user's behalf
      await marketFactory.connect(user).updateOperator(manager.address, true)

      // set up collateral account for fee payments
      const collateralAccount = await createCollateralAccount(user)
      dsu.connect(user).transfer(collateralAccount.address, reservedForFees.mul(1e12))
    }

    const fixture = async () => {
      currentTime = BigNumber.from(await currentBlockTimestamp())
      const fixture = await getFixture(TX_OVERRIDES)
      dsu = fixture.dsu
      usdc = fixture.usdc
      reserve = fixture.reserve
      keeperOracle = fixture.keeperOracle
      manager = fixture.manager
      marketFactory = fixture.marketFactory
      market = fixture.market
      oracle = fixture.oracle
      verifier = fixture.verifier
      controller = fixture.controller
      owner = fixture.owner
      userA = fixture.userA
      userB = fixture.userB
      userC = fixture.userC
      userD = fixture.userD
      keeper = fixture.keeper
      oracleFeeReceiver = fixture.oracleFeeReceiver

      nextOrderId[userA.address] = BigNumber.from(500)
      nextOrderId[userB.address] = BigNumber.from(500)

      // fund accounts and deposit all into market
      const amount = parse6decimal('100000')
      await setupUser(dsu, marketFactory, market, manager, userA, amount)
      await setupUser(dsu, marketFactory, market, manager, userB, amount)
      await setupUser(dsu, marketFactory, market, manager, userC, amount)
      await setupUser(dsu, marketFactory, market, manager, userD, amount)

      // commit a start price
      await commitPrice(parse6decimal('4444'))
    }

    // running tests serially; can build a few scenario scripts and test multiple things within each script
    before(async () => {
      await loadFixture(fixture)
    })

    beforeEach(async () => {
      await setNextBlockBaseFee()
      currentTime = BigNumber.from(await currentBlockTimestamp())
      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      keeperEthBalanceBefore = await keeper.getBalance()
    })

    afterEach(async () => {
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
        const orderId = await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3993.6'), parse6decimal('55'))
        expect(orderId).to.equal(BigNumber.from(501))

        // orders not executed; no position
        await ensureNoPosition(userA)
        await ensureNoPosition(userB)
      })

      it('multiple users can place orders', async () => {
        // if price drops below 3636.99, userA would have 10k maker position after both orders executed
        let orderId = await placeOrder(userA, Side.MAKER, Compare.LTE, parse6decimal('3636.99'), parse6decimal('45'))
        expect(orderId).to.equal(BigNumber.from(502))

        // userB queues up a 2.5k long position; same order nonce as userA's first order
        orderId = await placeOrder(userB, Side.LONG, Compare.GTE, parse6decimal('2222.22'), parse6decimal('2.5'))
        expect(orderId).to.equal(BigNumber.from(501))

        // orders not executed; no position
        await ensureNoPosition(userA)
        await ensureNoPosition(userB)
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

        await checkCompensation(3)
      })

      it('user can place an order using a signed message', async () => {
        const orderId = await placeOrderWithSignature(
          userA,
          Side.MAKER,
          Compare.GTE,
          parse6decimal('1000'),
          parse6decimal('-10'),
        )
        expect(orderId).to.equal(BigNumber.from(503))
        await checkCompensation(0)

        await executeOrder(userA, 503)
        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('90'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.5'))
        await commitPrice(parse6decimal('2801'))
      })

      it('user can cancel an order', async () => {
        // user places an order
        const orderId = await placeOrder(userA, Side.MAKER, Compare.GTE, parse6decimal('1001'), parse6decimal('-7'))
        expect(orderId).to.equal(BigNumber.from(504))

        // user cancels the order nonce
        await expect(manager.connect(userA).cancelOrder(market.address, orderId, TX_OVERRIDES))
          .to.emit(manager, 'TriggerOrderCancelled')
          .withArgs(market.address, userA.address, orderId)

        const storedOrder = await manager.orders(market.address, userA.address, orderId)
        expect(storedOrder.isSpent).to.be.true

        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('90'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.5'))
      })

      it('user can cancel an order using a signed message', async () => {
        // user places an order
        const orderId = await placeOrder(userA, Side.MAKER, Compare.GTE, parse6decimal('1002'), parse6decimal('-6'))
        expect(orderId).to.equal(BigNumber.from(505))

        // user creates and signs a message to cancel the order nonce
        const message = {
          ...createActionMessage(userA.address, orderId),
        }
        const signature = await signCancelOrderAction(userA, verifier, message)

        // keeper handles the request
        await expect(manager.connect(keeper).cancelOrderWithSignature(message, signature, TX_OVERRIDES))
          .to.emit(manager, 'TriggerOrderCancelled')
          .withArgs(market.address, userA.address, orderId)
        await checkCompensation(0)

        const storedOrder = await manager.orders(market.address, userA.address, orderId)
        expect(storedOrder.isSpent).to.be.true

        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('90'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.5'))
      })

      it('non-delegated signer cannot interact', async () => {
        // userB signs a message to change userA's position
        advanceOrderId(userA)
        const message: PlaceOrderActionStruct = {
          order: {
            ...DEFAULT_TRIGGER_ORDER,
            side: Side.MAKER,
            comparison: Compare.GTE,
            price: parse6decimal('1003'),
            delta: parse6decimal('2'),
          },
          ...createActionMessage(userA.address, nextMessageNonce(), userB.address),
        }
        const signature = await signPlaceOrderAction(userB, verifier, message)

        await expect(
          manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES),
        ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')
      })

      it('delegated signer can interact', async () => {
        // userA delegates userB
        await marketFactory.connect(userA).updateSigner(userB.address, true, TX_OVERRIDES)

        // userB signs a message to change userA's position
        advanceOrderId(userA)
        const message: PlaceOrderActionStruct = {
          order: {
            ...DEFAULT_TRIGGER_ORDER,
            side: Side.MAKER,
            comparison: Compare.GTE,
            price: parse6decimal('1004'),
            delta: parse6decimal('3'),
          },
          ...createActionMessage(userA.address, nextMessageNonce(), userB.address),
        }
        const signature = await signPlaceOrderAction(userB, verifier, message)

        await expect(manager.connect(keeper).placeOrderWithSignature(message, signature, TX_OVERRIDES))
          .to.emit(manager, 'TriggerOrderPlaced')
          .withArgs(market.address, userA.address, message.order, message.action.orderId)

        const storedOrder = await manager.orders(market.address, userA.address, message.action.orderId)
        compareOrders(storedOrder, message.order)

        // order was not executed, so no change in position
        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('90'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.5'))
        await checkCompensation(0)
      })

      it('charges flat interface fee upon execution', async () => {
        const positionBefore = await getPendingPosition(userA, Side.MAKER)
        const interfaceBalanceBefore = await dsu.balanceOf(userC.address)

        // user A reduces their maker position through a GUI which charges an interface fee
        const feeAmount = parse6decimal('3.5')
        const interfaceFee = {
          interfaceFee: {
            amount: feeAmount,
            receiver: userC.address,
            fixedFee: true,
            unwrap: false,
          },
        }
        const positionDelta = parse6decimal('-5')
        const orderId = await placeOrder(
          userA,
          Side.MAKER,
          Compare.LTE,
          parse6decimal('2828.28'),
          positionDelta,
          MAX_FEE,
          constants.AddressZero,
          interfaceFee,
        )
        expect(orderId).to.equal(BigNumber.from(508))

        // keeper executes the order and user settles themselves
        await executeOrder(userA, orderId)
        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(positionBefore.add(positionDelta))
        await commitPrice()
        await market.connect(userA).settle(userA.address, TX_OVERRIDES)

        // validate positions
        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('85'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('2.5'))

        // ensure fees were paid
        await manager.connect(userC).claim(userC.address, false, TX_OVERRIDES)
        expect(await dsu.balanceOf(userC.address)).to.equal(interfaceBalanceBefore.add(feeAmount.mul(1e12)))
        await checkCompensation(1)
      })

      it('unwraps flat interface fee upon execution', async () => {
        // user B increases their long position through a GUI which charges an interface fee
        const feeAmount = parse6decimal('2.75')
        const interfaceFee = {
          interfaceFee: {
            amount: feeAmount,
            receiver: userC.address,
            fixedFee: true,
            unwrap: true,
          },
        }
        const positionDelta = parse6decimal('1.5')
        const orderId = await placeOrder(
          userB,
          Side.LONG,
          Compare.GTE,
          parse6decimal('1900'),
          positionDelta,
          MAX_FEE,
          constants.AddressZero,
          interfaceFee,
        )
        expect(orderId).to.equal(BigNumber.from(502))

        // keeper executes the order and interface settles
        await executeOrder(userB, orderId)
        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('85'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('4')) // 2.5 + 1.5
        await commitPrice()
        await market.connect(userC).settle(userB.address, TX_OVERRIDES)

        // ensure fees were paid
        await manager.connect(userC).claim(userC.address, true, TX_OVERRIDES)
        expect(await usdc.balanceOf(userC.address)).to.equal(feeAmount)
        await checkCompensation(1)
      })

      it('unwraps notional interface fee upon execution', async () => {
        const interfaceBalanceBefore = await usdc.balanceOf(userC.address)

        // userB increases their long position through a GUI which charges a notional interface fee
        const interfaceFee = {
          interfaceFee: {
            amount: parse6decimal('0.0055'),
            receiver: userC.address,
            fixedFee: false,
            unwrap: true,
          },
        }
        const orderId = await placeOrder(
          userB,
          Side.LONG,
          Compare.GTE,
          parse6decimal('0.01'),
          parse6decimal('3'),
          MAX_FEE,
          constants.AddressZero,
          interfaceFee,
        )
        expect(orderId).to.equal(BigNumber.from(503))

        // keeper executes the order and user settles
        expect((await oracle.latest()).price).to.equal(parse6decimal('2801'))
        // delta * price * fee amount = 3 * 2801 * 0.0055
        const expectedInterfaceFee = parse6decimal('46.2165')
        await executeOrder(userB, orderId, expectedInterfaceFee)
        expect(await getPendingPosition(userA, Side.MAKER)).to.equal(parse6decimal('85'))
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('7')) // 4 + 3
        await commitPrice()
        await market.connect(userB).settle(userB.address, TX_OVERRIDES)

        // ensure fees were paid
        await manager.connect(userC).claim(userC.address, true, TX_OVERRIDES)
        expect(await usdc.balanceOf(userC.address)).to.equal(interfaceBalanceBefore.add(expectedInterfaceFee))
        await checkCompensation(1)
      })

      it('users can close positions', async () => {
        // can close directly
        let orderId = await placeOrder(userA, Side.MAKER, Compare.GTE, constants.Zero, MAGIC_VALUE_CLOSE_POSITION)
        expect(orderId).to.equal(BigNumber.from(509))

        // can close using a signed message
        orderId = await placeOrderWithSignature(
          userB,
          Side.LONG,
          Compare.LTE,
          parse6decimal('4000'),
          MAGIC_VALUE_CLOSE_POSITION,
        )
        expect(orderId).to.equal(BigNumber.from(504))

        // keeper closes the taker position before removing liquidity
        await executeOrder(userB, 504)
        await commitPrice()
        await executeOrder(userA, 509)
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

        nextOrderId[userA.address] = BigNumber.from(600)
        nextOrderId[userB.address] = BigNumber.from(600)
        nextOrderId[userC.address] = BigNumber.from(600)
        nextOrderId[userD.address] = BigNumber.from(600)
      })

      afterEach(async () => {
        await checkCompensation(1)
      })

      it('can execute an order with pending position before oracle request fulfilled', async () => {
        // userB has an unsettled long 1.2 position
        await changePosition(userB, 0, parse6decimal('1.2'), 0)
        expect((await market.positions(userB.address)).long).to.equal(0)
        expect(await getPendingPosition(userB, Side.LONG)).to.equal(parse6decimal('1.2'))

        // userB places an order to go long 0.8 more, and keeper executes it
        const orderId = await placeOrder(userB, Side.LONG, Compare.LTE, parse6decimal('2013'), parse6decimal('0.8'))
        expect(orderId).to.equal(BigNumber.from(601))
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
        const orderId = await placeOrder(userC, Side.SHORT, Compare.GTE, parse6decimal('1999.97'), parse6decimal('1.2'))
        expect(orderId).to.equal(BigNumber.from(601))
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
        const orderId = await placeOrder(userD, Side.LONG, Compare.LTE, triggerPrice, parse6decimal('3'))
        expect(orderId).to.equal(BigNumber.from(601))
        advanceBlock()

        // the order is not yet executable
        const [, canExecuteBefore] = await manager.checkOrder(market.address, userD.address, orderId)
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
          await setNextBlockBaseFee()

          // userA settled each time
          await market.settle(userA.address, TX_OVERRIDES)
        }
        // userC settled after considerable time
        await market.settle(userC.address, TX_OVERRIDES)

        // confirm order is now executable
        const [, canExecuteAfter] = await manager.checkOrder(market.address, userD.address, orderId)
        expect(canExecuteAfter).to.be.true

        // execute order
        const orderTimestamp = await executeOrder(userD, 601)
        expect(await getPendingPosition(userD, Side.LONG)).to.equal(parse6decimal('3'))

        // fulfill oracle version and settle
        await commitPrice(parse6decimal('2000.1'), orderTimestamp)
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userC.address)).short).to.equal(parse6decimal('2.26'))
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('3'))
      })

      it('market reverts when attempting to close an unsettled positive position', async () => {
        // userD submits order extending their long position, which keeper executes
        let orderId = await placeOrder(
          userD,
          Side.LONG,
          Compare.GTE,
          parse6decimal('0.01'),
          parse6decimal('1.5'),
          MAX_FEE,
          constants.AddressZero,
          NO_INTERFACE_FEE,
        )
        expect(orderId).to.equal(BigNumber.from(602))
        const longOrderTimestamp = await executeOrder(userD, orderId)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('3'))
        expect(await getPendingPosition(userD, Side.LONG)).to.equal(parse6decimal('4.5'))

        // before settling, userD closes their long position
        orderId = await placeOrder(userD, Side.LONG, Compare.LTE, parse6decimal('9999'), MAGIC_VALUE_CLOSE_POSITION)
        expect(orderId).to.equal(BigNumber.from(603))

        await expect(
          manager.connect(keeper).executeOrder(market.address, userD.address, orderId, TX_OVERRIDES),
        ).to.be.revertedWithCustomError(market, 'MarketOverCloseError')

        // keeper commits price, settles the long order
        await commitPrice(parse6decimal('2000.2'), longOrderTimestamp)
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('4.5'))
      })

      it('market handles attempt to close an unsettled negative position', async () => {
        // userD submits order reducing their long position, which keeper executes
        let orderId = await placeOrder(
          userD,
          Side.LONG,
          Compare.GTE,
          parse6decimal('0.01'),
          parse6decimal('-0.5'),
          MAX_FEE,
          constants.AddressZero,
          NO_INTERFACE_FEE,
        )
        expect(orderId).to.equal(BigNumber.from(604))
        const reduceOrderTimestamp = await executeOrder(userD, orderId)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('4.5'))
        expect(await getPendingPosition(userD, Side.LONG)).to.equal(parse6decimal('4'))

        // before settling, userD attempts to close their long position
        orderId = await placeOrder(userD, Side.LONG, Compare.LTE, parse6decimal('9999'), MAGIC_VALUE_CLOSE_POSITION)
        expect(orderId).to.equal(BigNumber.from(605))
        const closeOrderTimestamp = await executeOrder(userD, orderId)

        // keeper commits price, settles the long order
        await commitPrice(parse6decimal('2000.31'), reduceOrderTimestamp)
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('4'))

        // keeper commits another price, settles the close order
        await commitPrice(parse6decimal('2000.32'), closeOrderTimestamp)
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('0'))
      })

      it('charges notional interface fee on whole position when closing', async () => {
        const interfaceBalanceBefore = await dsu.balanceOf(userB.address)

        // userD starts with a long 3 position
        await changePosition(userD, 0, parse6decimal('3'), 0)
        await commitPrice(parse6decimal('2000.4'))
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('3'))
        expect(await getPendingPosition(userD, Side.LONG)).to.equal(parse6decimal('3'))

        // userD closes their long position
        const interfaceFee = {
          interfaceFee: {
            amount: parse6decimal('0.00654'),
            receiver: userB.address,
            fixedFee: false,
            unwrap: false,
          },
        }
        const orderId = await placeOrder(
          userD,
          Side.LONG,
          Compare.LTE,
          parse6decimal('9999'),
          MAGIC_VALUE_CLOSE_POSITION,
          MAX_FEE,
          constants.AddressZero,
          interfaceFee,
        )
        expect(orderId).to.equal(BigNumber.from(606))

        const expectedInterfaceFee = parse6decimal('39.247848') // position * price * fee
        const closeOrderTimestamp = await executeOrder(userD, orderId, expectedInterfaceFee)
        expect(await getPendingPosition(userD, Side.LONG)).to.equal(constants.Zero)

        // ensure fees were paid
        await manager.connect(userB).claim(userB.address, false, TX_OVERRIDES)
        expect(await dsu.balanceOf(userB.address)).to.equal(interfaceBalanceBefore.add(expectedInterfaceFee.mul(1e12)))

        // settle before next test
        await commitPrice(parse6decimal('2000.4'), closeOrderTimestamp)
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('0'))
      })

      it('charges notional interface fee when closing with a pending negative position', async () => {
        const interfaceBalanceBefore = await dsu.balanceOf(userB.address)

        // userD starts with a short 2 position
        await changePosition(userD, 0, 0, parse6decimal('2'))
        await commitPrice(parse6decimal('2000.5'))
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).short).to.equal(parse6decimal('2'))

        // userD reduces their position by 0.35 but does not settle
        const negOrderTimestamp = await changePosition(userD, 0, 0, parse6decimal('1.65'))
        expect(await getPendingPosition(userD, Side.SHORT)).to.equal(parse6decimal('1.65'))

        // userD closes their short position
        const interfaceFee = {
          interfaceFee: {
            amount: parse6decimal('0.0051'),
            receiver: userB.address,
            fixedFee: false,
            unwrap: false,
          },
        }
        const orderId = await placeOrder(
          userD,
          Side.SHORT,
          Compare.LTE,
          parse6decimal('9999'),
          MAGIC_VALUE_CLOSE_POSITION,
          MAX_FEE,
          constants.AddressZero,
          interfaceFee,
        )
        expect(orderId).to.equal(BigNumber.from(607))

        // position * price * fee = 1.65 * 2000.5 * 0.0051
        const expectedInterfaceFee = parse6decimal('16.8342075')
        await setNextBlockBaseFee()
        const closeOrderTimestamp = await executeOrder(userD, orderId, expectedInterfaceFee)
        expect(await getPendingPosition(userD, Side.SHORT)).to.equal(constants.Zero)

        // ensure fees were paid
        await manager.connect(userB).claim(userB.address, false, TX_OVERRIDES)
        expect(await dsu.balanceOf(userB.address)).to.equal(interfaceBalanceBefore.add(expectedInterfaceFee.mul(1e12)))

        // settle before next test
        await commitPrice(parse6decimal('2000.4'), negOrderTimestamp)
        await commitPrice(parse6decimal('2000.4'), closeOrderTimestamp)
        await setNextBlockBaseFee()
        await market.settle(userD.address, TX_OVERRIDES)
        expect((await market.positions(userD.address)).long).to.equal(parse6decimal('0'))
      })
    })
  })
}
