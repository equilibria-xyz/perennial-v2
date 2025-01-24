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

export const PRICE = utils.parseEther('3374.655169')

function payoff(number: BigNumber): BigNumber {
  return number.mul(number).div(utils.parseEther('1')).div(100000)
}

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
  let orderVerifier: FakeContract<IOrderVerifier>
  let marketVerifier: FakeContract<IVerifier>
  let oracleFactory: FakeContract<IOracleFactory>
  let nextOrderId = BigNumber.from(0)

  beforeEach(async () => {
    ;[owner, referrer, user] = await ethers.getSigners()
    dsu = await smock.fake<IERC20>('IERC20')
    pythFactory = await smock.fake<IPythFactory>('IPythFactory')
    controller = await smock.fake<Controller_Incentivized>('Controller_Incentivized')
    manager = await smock.fake<IManager>('IManager')
    controllerVerifier = await smock.fake<IAccountVerifier>('IAccountVerifier')
    orderVerifier = await smock.fake<IOrderVerifier>('IOrderVerifier')
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
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
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

      nextOrderId = nextOrderId.add(1)

      const triggerOrderTP = {
        order: {
          ...DEFAULT_TRIGGER_ORDER,
          side: tradeAmount.gte(0) ? Side.LONG : Side.SHORT,
          comparison: Compare.GTE,
          price: payoff(maxPrice).div(1e12),
          delta: tradeAmount.mul(-1),
          maxFee: triggerOrderMaxFee,
          referrer: referrer.address,
          interfaceFee: {
            ...DEFAULT_TRIGGER_ORDER.interfaceFee,
            receiver: referrer.address,
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
        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      }
    }

    it('calls all contracts correctly', async () => {
      const {
        invokeParams,
        marketTransfer,
        marketAMMOrder,
        triggerOrderSL,
        triggerOrderTP,
        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      } = await getInvokeParams(
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

      dsu.balanceOf.returns(utils.parseEther('100'))
      dsu.transfer.returns(true)
      oracleFactory.ids.returns(PYTH_ETH_USD_PRICE_FEED)
      await expect(compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })).to.not.be.reverted

      // check that all the actions are called correctly
      expect(pythFactory.commit).to.have.been.calledWith(
        [PYTH_ETH_USD_PRICE_FEED],
        invokeParams.version,
        invokeParams.priceCommitmentData,
      )
      expect(controller.marketTransferWithSignature).to.have.been.calledWith(marketTransfer, marketTransferSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderSL, triggerOrderSLSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderTP, triggerOrderTPSignature)
      expect(controller.relayTake).to.have.been.calledWith(
        marketAMMOrder,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
      )
    })

    it('transfers the excess DSU to the sender', async () => {
      const {
        invokeParams,
        marketTransfer,
        marketAMMOrder,
        triggerOrderSL,
        triggerOrderTP,
        marketTransferSignature,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
        triggerOrderSLSignature,
        triggerOrderTPSignature,
      } = await getInvokeParams(
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

      dsu.balanceOf.returnsAtCall(0, utils.parseEther('100'))
      dsu.balanceOf.returnsAtCall(1, utils.parseEther('200'))
      dsu.transfer.returns(true)
      oracleFactory.ids.returns(PYTH_ETH_USD_PRICE_FEED)
      await expect(compressor.connect(user).placeOrderBundle(invokeParams, { value: 1 })).to.not.be.reverted

      // check that all the actions are called correctly
      expect(dsu.transfer).to.have.been.calledWith(user.address, utils.parseEther('100'))
      expect(pythFactory.commit).to.have.been.calledWith(
        [PYTH_ETH_USD_PRICE_FEED],
        invokeParams.version,
        invokeParams.priceCommitmentData,
      )
      expect(controller.marketTransferWithSignature).to.have.been.calledWith(marketTransfer, marketTransferSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderSL, triggerOrderSLSignature)
      expect(manager.placeOrderWithSignature).to.have.been.calledWith(triggerOrderTP, triggerOrderTPSignature)
      expect(controller.relayTake).to.have.been.calledWith(
        marketAMMOrder,
        marketOrderOuterSignature,
        marketOrderInnerSignature,
      )
    })
  })
})
