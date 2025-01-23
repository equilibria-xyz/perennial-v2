import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { BigNumber, utils } from 'ethers'

import {
  Compressor,
  Compressor__factory,
  IMarket,
  IERC20,
  IPythFactory,
  IManager,
  IOrderVerifier,
  IAccountVerifier,
  IOracleFactory,
  Controller_Incentivized,
} from '../../../types/generated'

import { parse6decimal } from '../../../../common/testutil/types'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { Address } from 'hardhat-deploy/dist/types'
import { signMarketTransfer, signRelayedTake } from '../../helpers/CollateralAccounts/eip712'
import { Compare, DEFAULT_TRIGGER_ORDER, Side } from '../../helpers/TriggerOrders/order'
import { signPlaceOrderAction } from '../../helpers/TriggerOrders/eip712'
import { signTake } from '@perennial/v2-core/test/helpers/erc712'
import { IVerifier } from '@perennial/v2-oracle/types/generated'

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

describe('Compressor', function () {
  let compressor: Compressor
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let referrer: SignerWithAddress
  let dsu: FakeContract<IERC20>
  let market: FakeContract<IMarket>
  let pythFactory: FakeContract<IPythFactory>
  let controller: FakeContract<Controller_Incentivized>
  let controllerVerifier: FakeContract<IAccountVerifier>
  let manager: FakeContract<IManager>
  let managerVerifier: FakeContract<IOrderVerifier>
  let marketVerifier: FakeContract<IVerifier>
  let oracleFactory: FakeContract<IOracleFactory>
  const nextOrderId = BigNumber.from(0)

  beforeEach(async () => {
    ;[owner, referrer, user] = await ethers.getSigners()
    dsu = await smock.fake<IERC20>('IERC20')
    pythFactory = await smock.fake<IPythFactory>('IPythFactory')
    controller = await smock.fake<Controller_Incentivized>('Controller_Incentivized')
    manager = await smock.fake<IManager>('IManager')
    controllerVerifier = await smock.fake<IAccountVerifier>('IAccountVerifier')
    managerVerifier = await smock.fake<IOrderVerifier>('IOrderVerifier')
    marketVerifier = await smock.fake<IVerifier>('IVerifier')
    market = await smock.fake<IMarket>('IMarket')
    oracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    compressor = await new Compressor__factory(owner).deploy(
      dsu.address,
      pythFactory.address,
      controller.address,
      manager.address,
      oracleFactory.address,
      referrer.address,
    )
  })

  describe('placeOrderBundle', function () {
    const createCAAction = async (
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

    const createTOAction = async (
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

    const createTakeOrder = async (
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

    it('calls all contracts correctly', async () => {
      const nonce = BigNumber.from(0)
      const group = BigNumber.from(0)
      const version = BigNumber.from(await currentBlockTimestamp())
      const tradeAmount = parse6decimal('10')
      const maxFee = parse6decimal('0.3')
      const interfaceFee = BigNumber.from(0)
      const marketTransfer = {
        market: market.address,
        amount: parse6decimal('4'),
        ...(await createCAAction(user.address, nonce, group, version.add(BigNumber.from(120)), user.address, maxFee)),
      }

      const takeOrder = await createTakeOrder(
        market.address,
        nonce.add(1),
        group,
        user.address,
        version.add(BigNumber.from(120)),
        tradeAmount,
      )

      const marketOrder = {
        take: takeOrder,
        ...(await createCAAction(
          user.address,
          nonce.add(2),
          group,
          version.add(BigNumber.from(120)),
          user.address,
          parse6decimal('0.3'),
        )),
      }

      const triggerOrderSL = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.LTE,
          price: parse6decimal('1888.99'),
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
        ...(await createTOAction(market.address, nonce.add(3), group, user.address, version.add(BigNumber.from(120)))),
      }

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.GTE,
          price: parse6decimal('1888.99'),
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
        ...(await createTOAction(market.address, nonce.add(4), group, user.address, version.add(BigNumber.from(120)))),
      }

      const marketTransferSignature = await signMarketTransfer(user, controllerVerifier, marketTransfer)
      const triggerOrderSLSignature = await signPlaceOrderAction(user, managerVerifier, triggerOrderSL)
      const triggerOrderTPSignature = await signPlaceOrderAction(user, managerVerifier, triggerOrderTP)
      const marketOrderOuterSignature = await signRelayedTake(user, controllerVerifier, marketOrder)
      const marketOrderInnerSignature = await signTake(user, marketVerifier, marketOrder.take)

      const invokeParams = {
        priceCommitmentData: '0x',
        version: version,

        market: market.address,
        account: user.address,
        signer: user.address,

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

      dsu.balanceOf.returns(utils.parseEther('100'))
      dsu.transfer.returns(true)
      oracleFactory.ids.returns(PYTH_ETH_USD_PRICE_FEED)
      await expect(compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })).to.not.be.reverted

      // check that all the actions are called correctly
      expect(pythFactory.commit).to.have.been.calledWith(
        [PYTH_ETH_USD_PRICE_FEED],
        version,
        invokeParams.priceCommitmentData,
      )
      expect(controller.marketTransferWithSignature).to.have.been.calledWith(marketTransfer, marketTransferSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderSL, triggerOrderSLSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderTP, triggerOrderTPSignature)
      expect(controller.relayTake).to.have.been.calledWith(
        marketOrder,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
      )
    })

    it('transfers the excess DSU to the sender', async () => {
      const nonce = BigNumber.from(0)
      const group = BigNumber.from(0)
      const version = BigNumber.from(await currentBlockTimestamp())
      const tradeAmount = parse6decimal('10')
      const maxFee = parse6decimal('0.3')
      const interfaceFee = BigNumber.from(0)
      const marketTransfer = {
        market: market.address,
        amount: parse6decimal('4'),
        ...(await createCAAction(user.address, nonce, group, version.add(BigNumber.from(120)), user.address, maxFee)),
      }

      const takeOrder = await createTakeOrder(
        market.address,
        nonce.add(1),
        group,
        user.address,
        version.add(BigNumber.from(120)),
        tradeAmount,
      )

      const marketOrder = {
        take: takeOrder,
        ...(await createCAAction(
          user.address,
          nonce.add(2),
          group,
          version.add(BigNumber.from(120)),
          user.address,
          parse6decimal('0.3'),
        )),
      }

      const triggerOrderSL = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.LTE,
          price: parse6decimal('1888.99'),
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
        ...(await createTOAction(market.address, nonce.add(3), group, user.address, version.add(BigNumber.from(120)))),
      }

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: Side.LONG,
          comparison: Compare.GTE,
          price: parse6decimal('1888.99'),
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
        ...(await createTOAction(market.address, nonce.add(4), group, user.address, version.add(BigNumber.from(120)))),
      }

      const marketTransferSignature = await signMarketTransfer(user, controllerVerifier, marketTransfer)
      const triggerOrderSLSignature = await signPlaceOrderAction(user, managerVerifier, triggerOrderSL)
      const triggerOrderTPSignature = await signPlaceOrderAction(user, managerVerifier, triggerOrderTP)
      const marketOrderOuterSignature = await signRelayedTake(user, controllerVerifier, marketOrder)
      const marketOrderInnerSignature = await signTake(user, marketVerifier, marketOrder.take)

      const invokeParams = {
        priceCommitmentData: '0x',
        version: version,

        market: market.address,
        account: user.address,
        signer: user.address,

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

      dsu.balanceOf.returnsAtCall(0, utils.parseEther('100'))
      dsu.balanceOf.returnsAtCall(1, utils.parseEther('200'))
      dsu.transfer.returns(true)
      oracleFactory.ids.returns(PYTH_ETH_USD_PRICE_FEED)
      await expect(compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })).to.not.be.reverted

      // check that all the actions are called correctly
      expect(dsu.transfer).to.have.been.calledWith(user.address, utils.parseEther('100'))
      expect(pythFactory.commit).to.have.been.calledWith(
        [PYTH_ETH_USD_PRICE_FEED],
        version,
        invokeParams.priceCommitmentData,
      )
      expect(controller.marketTransferWithSignature).to.have.been.calledWith(marketTransfer, marketTransferSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderSL, triggerOrderSLSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderTP, triggerOrderTPSignature)
      expect(controller.relayTake).to.have.been.calledWith(
        marketOrder,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
      )
    })
  })
})
