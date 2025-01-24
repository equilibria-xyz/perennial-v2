import { expect } from 'chai'

import {
  Market,
  Compressor,
  KeeperOracle,
  PythFactory,
  Manager,
  Controller_Incentivized,
  MarketFactory,
  IERC20Metadata,
  OrderVerifier,
  IAccountVerifier,
  Account__factory,
  Account,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InstanceVars } from './MultiInvoker/setupHelpers'
import { BigNumber, utils, constants } from 'ethers'

import { parse6decimal } from '../../../../common/testutil/types'
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
    let nextOrderId = BigNumber.from(0)
    let orderVerifier: OrderVerifier
    let controllerVerifier: IAccountVerifier
    let marketVerifier: Verifier
    let keeperOracle: KeeperOracle

    const fixture = async () => {
      instanceVars = await getFixture()
      const { dsu, oracle, marketFactory, owner, chainlinkKeptFeed } = instanceVars
      market = await createMarket(owner, marketFactory, dsu, oracle)
      ;[pythOracleFactory, keeperOracle] = await getKeeperOracle()
      await keeperOracle.register(oracle.address)
      await oracle.register(market.address)
      ;[manager, orderVerifier] = await getManager(dsu, marketFactory)
      ;[controller, controllerVerifier] = await deployController(owner, marketFactory, chainlinkKeptFeed)
      compressor = await createCompressor(instanceVars, pythOracleFactory, controller, manager)
      marketVerifier = Verifier__factory.connect(await market.verifier(), owner)

      await advanceToPrice(PRICE)
    }

    // deploys and funds a collateral account
    async function createCollateralAccount(user: SignerWithAddress, amount: BigNumber): Promise<Account> {
      const { usdc, marketFactory } = instanceVars
      const accountAddress = await controller.getAccountAddress(user.address)
      await fundWalletUSDC(user, amount)
      await usdc.connect(user).transfer(accountAddress, amount, TX_OVERRIDES)
      const tx = await controller.connect(user).deployAccount()

      // verify the address from event arguments
      const creationArgs = await getEventArguments(tx, 'AccountDeployed')
      expect(creationArgs.account).to.equal(accountAddress)

      // approve the collateral account as operator
      await marketFactory.connect(user).updateOperator(accountAddress, true, TX_OVERRIDES)

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
        referrer: instanceVars.referrer.address,
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

    const getInvokeParams = async (
      priceCommitmentData: string,
      version: BigNumber,
      market: string,
      account: SignerWithAddress,
      signer: SignerWithAddress,
      tradeCollateral: BigNumber,
      tradeAmount: BigNumber,
      minPrice: BigNumber,
      maxPrice: BigNumber,
      group: BigNumber,
      nonce: BigNumber,
      relayerMaxFee: BigNumber,
      triggerOrderMaxFee: BigNumber,
      triggerOrderInterfaceFee: BigNumber,
    ) => {
      const expiresInSeconds = version.add(BigNumber.from(120)) // version + 2 mins
      const marketTransfer = {
        market: market,
        amount: tradeCollateral,
        ...createCAAction(account.address, nonce, group, expiresInSeconds, signer.address, relayerMaxFee),
      }

      const marketAMMOrder = {
        take: createTakeOrder(
          market,
          nonce.add(1),
          group,
          account.address,
          expiresInSeconds,
          tradeAmount,
          signer.address,
        ),
        ...createCAAction(account.address, nonce.add(2), group, expiresInSeconds, signer.address, relayerMaxFee),
      }

      const triggerOrderSL = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: tradeAmount.gte(0) ? Side.LONG : Side.SHORT,
          comparison: Compare.LTE,
          price: payoff(minPrice).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: triggerOrderMaxFee,
          referrer: instanceVars.referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: instanceVars.referrer.address,
            amount: triggerOrderInterfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market,
          nonce.add(3),
          group,
          account.address,
          expiresInSeconds,
          signer.address,
          triggerOrderMaxFee,
        ),
      }

      advanceOrderId()

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: tradeAmount.gte(0) ? Side.LONG : Side.SHORT,
          comparison: Compare.GTE,
          price: payoff(maxPrice).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: triggerOrderMaxFee,
          referrer: instanceVars.referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: instanceVars.referrer.address,
            amount: triggerOrderInterfaceFee,
            fixedFee: true,
          },
        },
        ...createTOAction(
          market,
          nonce.add(4),
          group,
          account.address,
          expiresInSeconds,
          signer.address,
          triggerOrderMaxFee,
        ),
      }

      const marketTransferSignature = await signMarketTransfer(signer, controllerVerifier, marketTransfer)
      const triggerOrderSLSignature = await signPlaceOrderAction(signer, orderVerifier, triggerOrderSL)
      const triggerOrderTPSignature = await signPlaceOrderAction(signer, orderVerifier, triggerOrderTP)
      const marketOrderOuterSignature = await signRelayedTake(signer, controllerVerifier, marketAMMOrder)
      const marketOrderInnerSignature = await signTake(signer, marketVerifier, marketAMMOrder.take)

      const invokeParams = {
        priceCommitmentData,
        version,
        market,
        account: account.address,
        signer: signer.address,
        tradeCollateral,
        tradeAmount,
        minPrice: triggerOrderSL.order.price,
        maxPrice: triggerOrderTP.order.price,
        group,
        nonce,
        relayerMaxFee,
        triggerOrderMaxFee,
        triggerOrderInterfaceFee,
        triggerOrderSLId: triggerOrderSL.action.orderId,
        triggerOrderTPId: triggerOrderTP.action.orderId,
        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      }

      return {
        invokeParams,
        marketTransfer,
        marketAMMOrder,
        triggerOrderSL,
        triggerOrderTP,
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
      const { marketFactory, user, userB, dsu } = instanceVars
      await createCollateralAccount(user, parse6decimal('10000'))

      await marketFactory.connect(user).updateOperator(manager.address, true, TX_OVERRIDES)

      // userB deposits and opens maker position, adding liquidity to market
      const COLLATERAL_B = parse6decimal('10000')
      const POSITION_B = parse6decimal('2')
      await dsu.connect(userB).approve(market.address, constants.MaxUint256, TX_OVERRIDES)
      await market
        .connect(userB)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          userB.address,
          POSITION_B,
          0,
          0,
          COLLATERAL_B,
          false,
          TX_OVERRIDES,
        )
    })

    it('creates a valid order', async () => {
      const { user } = instanceVars
      const { invokeParams, marketTransfer, marketAMMOrder, triggerOrderSL, triggerOrderTP } = await getInvokeParams(
        '0x',
        BigNumber.from(await currentBlockTimestamp()),
        market.address,
        user,
        user,
        parse6decimal('9000'),
        parse6decimal('1.5'),
        PRICE.sub(utils.parseEther('100')),
        PRICE.add(utils.parseEther('100')),
        BigNumber.from(0),
        BigNumber.from(0),
        parse6decimal('0.3'),
        parse6decimal('0.3'),
        BigNumber.from(0),
      )

      await compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })

      // check user state
      expect((await market.pendingOrders(user.address, 1)).longPos).to.equal(marketAMMOrder.take.amount)

      // check order state
      const storedSLOrder = await manager.orders(market.address, user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, triggerOrderSL.order)

      const storedTPOrder = await manager.orders(market.address, user.address, triggerOrderTP.action.orderId)
      compareOrders(storedTPOrder, triggerOrderTP.order)
    })

    it('creates a valid order, and hits stop loss', async () => {
      const { user, userB } = instanceVars
      const { invokeParams, marketTransfer, marketAMMOrder, triggerOrderSL, triggerOrderTP } = await getInvokeParams(
        '0x',
        BigNumber.from(await currentBlockTimestamp()),
        market.address,
        user,
        user,
        parse6decimal('9000'),
        parse6decimal('1.5'),
        PRICE.sub(utils.parseEther('100')),
        PRICE.add(utils.parseEther('100')),
        BigNumber.from(0),
        BigNumber.from(0),
        parse6decimal('0.3'),
        parse6decimal('0.3'),
        BigNumber.from(0),
      )

      await compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })

      // check user state
      expect((await market.pendingOrders(user.address, 1)).longPos).to.equal(marketAMMOrder.take.amount)

      // check order state
      let storedSLOrder = await manager.orders(market.address, user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, triggerOrderSL.order)

      const storedTPOrder = await manager.orders(market.address, user.address, triggerOrderTP.action.orderId)
      compareOrders(storedTPOrder, triggerOrderTP.order)

      await advanceToPrice()

      await market.connect(user).settle(user.address, TX_OVERRIDES)
      await market.connect(userB).settle(userB.address, TX_OVERRIDES)

      await advanceToPrice(PRICE.sub(utils.parseEther('100')))

      await manager
        .connect(user)
        .executeOrder(market.address, user.address, triggerOrderSL.action.orderId, TX_OVERRIDES)

      // check user state
      expect((await market.pendingOrders(user.address, 2)).longNeg).to.equal(marketAMMOrder.take.amount)

      // check order state
      storedSLOrder = await manager.orders(market.address, user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, { ...triggerOrderSL.order, isSpent: true })
    })

    it('creates a valid order, and hits take profit price', async () => {
      const { user, userB } = instanceVars
      const { invokeParams, marketTransfer, marketAMMOrder, triggerOrderSL, triggerOrderTP } = await getInvokeParams(
        '0x',
        BigNumber.from(await currentBlockTimestamp()),
        market.address,
        user,
        user,
        parse6decimal('9000'),
        parse6decimal('1.5'),
        PRICE.sub(utils.parseEther('100')),
        PRICE.add(utils.parseEther('100')),
        BigNumber.from(0),
        BigNumber.from(0),
        parse6decimal('0.3'),
        parse6decimal('0.3'),
        BigNumber.from(0),
      )
      await compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })

      // check user state
      expect((await market.pendingOrders(user.address, 1)).longPos).to.equal(marketAMMOrder.take.amount)

      // check order state
      const storedSLOrder = await manager.orders(market.address, user.address, triggerOrderSL.action.orderId)
      compareOrders(storedSLOrder, triggerOrderSL.order)

      let storedTPOrder = await manager.orders(market.address, user.address, triggerOrderTP.action.orderId)
      compareOrders(storedTPOrder, triggerOrderTP.order)

      await advanceToPrice()

      await market.connect(user).settle(user.address, TX_OVERRIDES)
      await market.connect(userB).settle(userB.address, TX_OVERRIDES)

      await advanceToPrice(PRICE.add(utils.parseEther('100')))

      await manager
        .connect(user)
        .executeOrder(market.address, user.address, triggerOrderTP.action.orderId, TX_OVERRIDES)

      // check user state
      expect((await market.pendingOrders(user.address, 2)).longNeg).to.equal(marketAMMOrder.take.amount)

      // check order state
      storedTPOrder = await manager.orders(market.address, user.address, triggerOrderTP.action.orderId)
      compareOrders(storedTPOrder, { ...triggerOrderTP.order, isSpent: true })
    })
  })
}
