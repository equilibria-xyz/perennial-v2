import { expect } from 'chai'

import {
  IVault,
  IVaultFactory,
  Market,
  IOracleProvider,
  VaultFactory,
  Compressor,
  KeeperOracle,
  PythFactory,
  Manager,
  Controller,
  Controller_Incentivized,
  Manager__factory,
  Manager_Optimism__factory,
  OrderVerifier__factory,
  MarketFactory,
  IERC20Metadata,
  OrderVerifier,
  IAccountVerifier,
  Account__factory,
  Account,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InstanceVars, createVault } from './MultiInvoker/setupHelpers'
import { BigNumber, utils, constants } from 'ethers'

import {
  DEFAULT_CHECKPOINT,
  DEFAULT_LOCAL,
  DEFAULT_ORDER,
  DEFAULT_POSITION,
  expectCheckpointEq,
  expectLocalEq,
  expectOrderEq,
  expectPositionEq,
  OracleReceipt,
  parse6decimal,
} from '../../../../common/testutil/types'
import { use } from 'chai'
import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { createMarket } from '../../helpers/marketHelpers'
import { deployController } from '../l2/CollateralAccounts/Arbitrum.test'
import { Address } from 'hardhat-deploy/dist/types'
import { Compare, compareOrders, DEFAULT_TRIGGER_ORDER, Side } from '../../helpers/TriggerOrders/order'
import { advanceBlock, currentBlockTimestamp } from '../../../../common/testutil/time'
import { signMarketTransfer, signRelayedTake } from '../../helpers/CollateralAccounts/eip712'
import { signPlaceOrderAction } from '../../helpers/TriggerOrders/eip712'
import { signTake } from '@perennial/v2-core/test/helpers/erc712'
import { Verifier, Verifier__factory } from '@perennial/v2-core/types/generated'
import { getEventArguments } from '../../../../common/testutil/transaction'

use(smock.matchers)

export const PRICE = utils.parseEther('3374.655169')

function payoff(number: BigNumber): BigNumber {
  return number.mul(number).div(utils.parseEther('1')).div(100000)
}

// hack around issues estimating gas for instrumented contracts when running tests under coverage
// also, need higher gasLimit to deploy incentivized controllers with optimizer disabled
const TX_OVERRIDES = { gasLimit: 12_000_000, maxPriorityFeePerGas: 0, maxFeePerGas: 100_000_000 }

export function RunCompressorTests(
  getFixture: () => Promise<InstanceVars>,
  createCompressor: (
    instanceVars: InstanceVars,
    pythOracleFactory: PythFactory,
    controller: Controller_Incentivized,
    manager: Manager,
  ) => Promise<Compressor>,
  getKeeperOracle: () => Promise<[PythFactory, KeeperOracle]>,
  getManager: (dsu: IERC20Metadata, marketFactory: MarketFactory) => Promise<[Manager, OrderVerifier]>,
  fundWalletDSU: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  fundWalletUSDC: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  advanceToPrice: (price?: BigNumber) => Promise<void>,
  mockGasInfo: () => Promise<void>,
): void {
  describe('placeOrderBundle', () => {
    let instanceVars: InstanceVars
    let market: Market
    let compressor: Compressor
    let pythOracleFactory: PythFactory
    let controller: Controller_Incentivized
    let manager: Manager
    let referrer: SignerWithAddress
    let nextOrderId = BigNumber.from(0)
    let dsu: IERC20Metadata
    let usdc: IERC20Metadata
    let orderVerifier: OrderVerifier
    let controllerVerifier: IAccountVerifier
    let marketVerifier: Verifier
    let keeperOracle: KeeperOracle

    const fixture = async () => {
      instanceVars = await getFixture()
      dsu = instanceVars.dsu
      usdc = instanceVars.usdc
      referrer = instanceVars.referrer
      market = await createMarket(instanceVars.owner, instanceVars.marketFactory, instanceVars.dsu, instanceVars.oracle)
      ;[pythOracleFactory, keeperOracle] = await getKeeperOracle()
      await keeperOracle.register(instanceVars.oracle.address)
      await instanceVars.oracle.register(market.address)
      ;[manager, orderVerifier] = await getManager(instanceVars.dsu, instanceVars.marketFactory)
      ;[controller, controllerVerifier] = await deployController(
        instanceVars.owner,
        instanceVars.marketFactory,
        instanceVars.chainlinkKeptFeed,
      )
      compressor = await createCompressor(instanceVars, pythOracleFactory, controller, manager)
      marketVerifier = Verifier__factory.connect(await market.verifier(), instanceVars.owner)

      await advanceToPrice(PRICE)
    }

    // deploys and funds a collateral account
    async function createCollateralAccount(user: SignerWithAddress, amount: BigNumber): Promise<Account> {
      const accountAddress = await controller.getAccountAddress(user.address)
      await fundWalletUSDC(user, amount)
      await usdc.connect(user).transfer(accountAddress, amount, TX_OVERRIDES)
      const tx = await controller.connect(user).deployAccount()

      // verify the address from event arguments
      const creationArgs = await getEventArguments(tx, 'AccountDeployed')
      expect(creationArgs.account).to.equal(accountAddress)

      // approve the collateral account as operator
      await instanceVars.marketFactory.connect(user).updateOperator(accountAddress, true, TX_OVERRIDES)

      return Account__factory.connect(accountAddress, user)
    }

    function advanceOrderId(): BigNumber {
      return (nextOrderId = nextOrderId.add(BigNumber.from(1)))
    }

    const createCAAction = (
      userAddress: Address,
      nonce: BigNumber,
      group: BigNumber,
      expiresInSeconds: BigNumber,
      signerAddress = userAddress,
      maxFee = parse6decimal('0.3'),
    ) => {
      return {
        action: {
          maxFee: maxFee,
          common: {
            account: userAddress,
            signer: signerAddress,
            domain: controller.address,
            nonce: nonce,
            group: group,
            expiry: expiresInSeconds,
          },
        },
      }
    }

    const createTOAction = (
      marketAddress: Address,
      nonce: BigNumber,
      group: BigNumber,
      userAddress: Address,
      expiresInSeconds: BigNumber,
      signerAddress = userAddress,
      maxFee = parse6decimal('0.3'),
    ) => {
      return {
        action: {
          market: marketAddress,
          orderId: nextOrderId,
          maxFee: maxFee,
          common: {
            account: userAddress,
            signer: signerAddress,
            domain: manager.address,
            nonce: nonce,
            group: group,
            expiry: expiresInSeconds,
          },
        },
      }
    }

    const createTakeOrder = (
      marketAddress: Address,
      nonce: BigNumber,
      group: BigNumber,
      userAddress: Address,
      expiresInSeconds: BigNumber,
      amount: BigNumber,
      signerAddress = userAddress,
    ) => {
      return {
        amount: amount,
        referrer: referrer.address,
        common: {
          account: userAddress,
          signer: signerAddress,
          domain: marketAddress,
          nonce: nonce,
          group: group,
          expiry: expiresInSeconds,
        },
      }
    }

    before(async () => {
      // touch the provider, such that smock doesn't error out running a single test
      await advanceBlock()
      // mock gas information for the chain being tested
      await mockGasInfo()
    })

    beforeEach(async () => {
      await loadFixture(fixture)
      await createCollateralAccount(instanceVars.user, parse6decimal('10000'))

      await instanceVars.marketFactory.connect(instanceVars.user).updateOperator(manager.address, true, TX_OVERRIDES)

      // userB deposits and opens maker position, adding liquidity to market
      const COLLATERAL_B = parse6decimal('10000')
      const POSITION_B = parse6decimal('2')
      await dsu.connect(instanceVars.userB).approve(market.address, constants.MaxUint256, TX_OVERRIDES)
      await market
        .connect(instanceVars.userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          instanceVars.userB.address,
          POSITION_B,
          0,
          0,
          COLLATERAL_B,
          false,
          TX_OVERRIDES,
        )
    })

    it('creates a valid order', async () => {
      const nonce = BigNumber.from(0)
      const group = BigNumber.from(0)
      const version = BigNumber.from(await currentBlockTimestamp())
      const tradeAmount = parse6decimal('1.5')
      const maxFee = parse6decimal('0.3')
      const interfaceFee = BigNumber.from(0)
      const marketTransfer = {
        market: market.address,
        amount: parse6decimal('9000'),
        ...createCAAction(
          instanceVars.user.address,
          nonce,
          group,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const takeOrder = createTakeOrder(
        market.address,
        nonce.add(1),
        group,
        instanceVars.user.address,
        version.add(BigNumber.from(120)),
        tradeAmount,
      )

      const marketOrder = {
        take: takeOrder,
        ...createCAAction(
          instanceVars.user.address,
          nonce.add(2),
          group,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const triggerOrderSL = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.LTE,
          price: payoff(PRICE.sub(utils.parseEther('100'))).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: maxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
            amount: interfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market.address,
          nonce.add(3),
          group,
          instanceVars.user.address,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      advanceOrderId()

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.GTE,
          price: payoff(PRICE.add(utils.parseEther('100'))).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: maxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
            amount: interfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market.address,
          nonce.add(4),
          group,
          instanceVars.user.address,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const marketTransferSignature = await signMarketTransfer(instanceVars.user, controllerVerifier, marketTransfer)
      const triggerOrderSLSignature = await signPlaceOrderAction(instanceVars.user, orderVerifier, triggerOrderSL)
      const triggerOrderTPSignature = await signPlaceOrderAction(instanceVars.user, orderVerifier, triggerOrderTP)
      const marketOrderOuterSignature = await signRelayedTake(instanceVars.user, controllerVerifier, marketOrder)
      const marketOrderInnerSignature = await signTake(instanceVars.user, marketVerifier, marketOrder.take)

      const invokeParams = {
        priceCommitmentData: '0x',
        version: version,

        market: market.address,
        account: instanceVars.user.address,
        signer: instanceVars.user.address,

        tradeCollateral: marketTransfer.amount,
        tradeAmount: marketOrder.take.amount,
        minPrice: triggerOrderSL.order.price,
        maxPrice: triggerOrderTP.order.price,

        group: group,
        nonce: nonce,
        relayerMaxFee: marketTransfer.action.maxFee,
        triggerOrderMaxFee: triggerOrderSL.action.maxFee,

        triggerOrderInterfaceFee: interfaceFee,
        triggerOrderSLId: triggerOrderSL.action.orderId,
        triggerOrderTPId: triggerOrderTP.action.orderId,

        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      }

      await compressor.connect(instanceVars.user).placeOrderBundle(invokeParams, { value: 1 })

      // check user state
      expect((await market.pendingOrders(instanceVars.user.address, 1)).longPos).to.equal(tradeAmount)

      // check order state
      const storedSLOrder = await manager.orders(
        market.address,
        instanceVars.user.address,
        triggerOrderSL.action.orderId,
      )
      compareOrders(storedSLOrder, triggerOrderSL.order)

      const storedTPOrder = await manager.orders(
        market.address,
        instanceVars.user.address,
        triggerOrderTP.action.orderId,
      )
      compareOrders(storedTPOrder, triggerOrderTP.order)
    })

    it('creates a valid order, and hits stop loss', async () => {
      const nonce = BigNumber.from(0)
      const group = BigNumber.from(0)
      const version = BigNumber.from(await currentBlockTimestamp())
      const tradeAmount = parse6decimal('1.5')
      const maxFee = parse6decimal('0.3')
      const interfaceFee = BigNumber.from(0)
      const marketTransfer = {
        market: market.address,
        amount: parse6decimal('9000'),
        ...createCAAction(
          instanceVars.user.address,
          nonce,
          group,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const takeOrder = createTakeOrder(
        market.address,
        nonce.add(1),
        group,
        instanceVars.user.address,
        version.add(BigNumber.from(120)),
        tradeAmount,
      )

      const marketOrder = {
        take: takeOrder,
        ...createCAAction(
          instanceVars.user.address,
          nonce.add(2),
          group,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const triggerOrderSL = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.LTE,
          price: payoff(PRICE.sub(utils.parseEther('100'))).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: maxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
            amount: interfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market.address,
          nonce.add(3),
          group,
          instanceVars.user.address,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      advanceOrderId()

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.GTE,
          price: payoff(PRICE.add(utils.parseEther('100'))).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: maxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
            amount: interfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market.address,
          nonce.add(4),
          group,
          instanceVars.user.address,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const marketTransferSignature = await signMarketTransfer(instanceVars.user, controllerVerifier, marketTransfer)
      const triggerOrderSLSignature = await signPlaceOrderAction(instanceVars.user, orderVerifier, triggerOrderSL)
      const triggerOrderTPSignature = await signPlaceOrderAction(instanceVars.user, orderVerifier, triggerOrderTP)
      const marketOrderOuterSignature = await signRelayedTake(instanceVars.user, controllerVerifier, marketOrder)
      const marketOrderInnerSignature = await signTake(instanceVars.user, marketVerifier, marketOrder.take)

      const invokeParams = {
        priceCommitmentData: '0x',
        version: version,

        market: market.address,
        account: instanceVars.user.address,
        signer: instanceVars.user.address,

        tradeCollateral: marketTransfer.amount,
        tradeAmount: marketOrder.take.amount,
        minPrice: triggerOrderSL.order.price,
        maxPrice: triggerOrderTP.order.price,

        group: group,
        nonce: nonce,
        relayerMaxFee: marketTransfer.action.maxFee,
        triggerOrderMaxFee: triggerOrderSL.action.maxFee,

        triggerOrderInterfaceFee: interfaceFee,
        triggerOrderSLId: triggerOrderSL.action.orderId,
        triggerOrderTPId: triggerOrderTP.action.orderId,

        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      }

      await compressor.connect(instanceVars.user).placeOrderBundle(invokeParams, { value: 1 })

      // check user state
      expect((await market.pendingOrders(instanceVars.user.address, 1)).longPos).to.equal(tradeAmount)

      // check order state
      let storedSLOrder = await manager.orders(market.address, instanceVars.user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, triggerOrderSL.order)

      const storedTPOrder = await manager.orders(
        market.address,
        instanceVars.user.address,
        triggerOrderTP.action.orderId,
      )
      compareOrders(storedTPOrder, triggerOrderTP.order)

      await advanceToPrice()

      await market.connect(instanceVars.user).settle(instanceVars.user.address, TX_OVERRIDES)
      await market.connect(instanceVars.userB).settle(instanceVars.userB.address, TX_OVERRIDES)

      await advanceToPrice(PRICE.sub(utils.parseEther('100')))

      await manager
        .connect(instanceVars.user)
        .executeOrder(market.address, instanceVars.user.address, triggerOrderSL.action.orderId, TX_OVERRIDES)

      // check user state
      expect((await market.pendingOrders(instanceVars.user.address, 2)).longNeg).to.equal(tradeAmount)

      // check order state
      storedSLOrder = await manager.orders(market.address, instanceVars.user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, { ...triggerOrderSL.order, isSpent: true })
    })

    it('creates a valid order, and hits take profit price', async () => {
      const nonce = BigNumber.from(0)
      const group = BigNumber.from(0)
      const version = BigNumber.from(await currentBlockTimestamp())
      const tradeAmount = parse6decimal('1.5')
      const maxFee = parse6decimal('0.3')
      const interfaceFee = BigNumber.from(0)
      const marketTransfer = {
        market: market.address,
        amount: parse6decimal('9000'),
        ...createCAAction(
          instanceVars.user.address,
          nonce,
          group,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const takeOrder = createTakeOrder(
        market.address,
        nonce.add(1),
        group,
        instanceVars.user.address,
        version.add(BigNumber.from(120)),
        tradeAmount,
      )

      const marketOrder = {
        take: takeOrder,
        ...createCAAction(
          instanceVars.user.address,
          nonce.add(2),
          group,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const triggerOrderSL = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.LTE,
          price: payoff(PRICE.sub(utils.parseEther('100'))).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: maxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
            amount: interfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market.address,
          nonce.add(3),
          group,
          instanceVars.user.address,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      advanceOrderId()

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.GTE,
          price: payoff(PRICE.add(utils.parseEther('100'))).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: maxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
            amount: interfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market.address,
          nonce.add(4),
          group,
          instanceVars.user.address,
          version.add(BigNumber.from(120)),
          instanceVars.user.address,
          maxFee,
        ),
      }

      const marketTransferSignature = await signMarketTransfer(instanceVars.user, controllerVerifier, marketTransfer)
      const triggerOrderSLSignature = await signPlaceOrderAction(instanceVars.user, orderVerifier, triggerOrderSL)
      const triggerOrderTPSignature = await signPlaceOrderAction(instanceVars.user, orderVerifier, triggerOrderTP)
      const marketOrderOuterSignature = await signRelayedTake(instanceVars.user, controllerVerifier, marketOrder)
      const marketOrderInnerSignature = await signTake(instanceVars.user, marketVerifier, marketOrder.take)

      const invokeParams = {
        priceCommitmentData: '0x',
        version: version,

        market: market.address,
        account: instanceVars.user.address,
        signer: instanceVars.user.address,

        tradeCollateral: marketTransfer.amount,
        tradeAmount: marketOrder.take.amount,
        minPrice: triggerOrderSL.order.price,
        maxPrice: triggerOrderTP.order.price,

        group: group,
        nonce: nonce,
        relayerMaxFee: marketTransfer.action.maxFee,
        triggerOrderMaxFee: triggerOrderSL.action.maxFee,

        triggerOrderInterfaceFee: interfaceFee,
        triggerOrderSLId: triggerOrderSL.action.orderId,
        triggerOrderTPId: triggerOrderTP.action.orderId,

        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      }

      await compressor.connect(instanceVars.user).placeOrderBundle(invokeParams, { value: 1 })

      // check user state
      expect((await market.pendingOrders(instanceVars.user.address, 1)).longPos).to.equal(tradeAmount)

      // check order state
      const storedSLOrder = await manager.orders(market.address, instanceVars.user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, triggerOrderSL.order)

      let storedTPOrder = await manager.orders(market.address, instanceVars.user.address, triggerOrderTP.action.orderId)
      compareOrders(storedTPOrder, triggerOrderTP.order)

      await advanceToPrice()

      await market.connect(instanceVars.user).settle(instanceVars.user.address, TX_OVERRIDES)
      await market.connect(instanceVars.userB).settle(instanceVars.userB.address, TX_OVERRIDES)

      await advanceToPrice(PRICE.add(utils.parseEther('100')))

      await manager
        .connect(instanceVars.user)
        .executeOrder(market.address, instanceVars.user.address, triggerOrderTP.action.orderId, TX_OVERRIDES)

      // check user state
      expect((await market.pendingOrders(instanceVars.user.address, 2)).longNeg).to.equal(tradeAmount)

      // check order state
      storedTPOrder = await manager.orders(market.address, instanceVars.user.address, triggerOrderTP.action.orderId)
      compareOrders(storedTPOrder, { ...triggerOrderTP.order, isSpent: true })
    })
  })
}
