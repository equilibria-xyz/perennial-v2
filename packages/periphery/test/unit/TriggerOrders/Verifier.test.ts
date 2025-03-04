import { expect } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { BigNumber, ContractTransaction, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'

import { impersonate } from '../../../../common/testutil'
import { parse6decimal } from '../../../../common/testutil/types'
import { currentBlockTimestamp } from '../../../../common/testutil/time'

import { signAction, signCancelOrderAction, signCommon, signPlaceOrderAction } from '../../helpers/TriggerOrders/eip712'
import { DEFAULT_TRIGGER_ORDER } from '../../helpers/TriggerOrders/order'
import { IMarket } from '@perennial/v2-core/types/generated'
import {
  IManager,
  IMarketFactory,
  IOrderVerifier,
  OrderVerifier,
  OrderVerifier__factory,
} from '../../../types/generated'

const { ethers } = HRE

const MAX_FEE = utils.parseEther('8')

describe('Verifier', () => {
  let orderVerifier: OrderVerifier
  let manager: FakeContract<IManager>
  let market: FakeContract<IMarket>
  let marketFactory: FakeContract<IMarketFactory>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let orderVerifierSigner: SignerWithAddress
  let lastNonce = 0
  let lastOrderId = 30
  let currentTime: BigNumber

  function createCommonMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 24) {
    return {
      common: {
        account: userAddress,
        signer: signerAddress,
        domain: orderVerifier.address,
        nonce: nextNonce(),
        group: 0,
        expiry: currentTime.add(expiresInSeconds),
      },
    }
  }

  // create a default action for the specified user
  function createActionMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 24) {
    return {
      action: {
        market: market.address,
        orderId: nextOrderId(),
        maxFee: MAX_FEE,
        ...createCommonMessage(userAddress, signerAddress, expiresInSeconds),
      },
    }
  }

  function createPlaceOrderActionMessage(
    userAddress = userA.address,
    signerAddress = userAddress,
    expiresInSeconds = 12,
  ) {
    return {
      order: {
        ...DEFAULT_TRIGGER_ORDER,
        price: parse6decimal('2010.33'),
        delta: parse6decimal('400'),
        maxFee: parse6decimal('0.67'),
        referrer: userB.address,
        interfaceFee: {
          amount: parse6decimal('0.0053'),
          receiver: userC.address,
          fixedFee: false,
          unwrap: true,
        },
      },
      ...createActionMessage(userAddress, signerAddress, expiresInSeconds),
    }
  }

  function createCancelOrderActionMessage(
    userAddress = userA.address,
    signerAddress = userAddress,
    expiresInSeconds = 12,
  ) {
    return {
      ...createActionMessage(userAddress, signerAddress, expiresInSeconds),
    }
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    return BigNumber.from(++lastNonce)
  }

  function nextOrderId(): BigNumber {
    return BigNumber.from(++lastOrderId)
  }

  const fixture = async () => {
    ;[owner, userA, userB, userC] = await ethers.getSigners()

    // deploy a verifier
    manager = await smock.fake<IManager>('IManager')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    orderVerifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)

    orderVerifierSigner = await impersonate.impersonateWithBalance(orderVerifier.address, utils.parseEther('10'))
    market = await smock.fake<IMarket>('IMarket')
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  let signFunctionPrototype: (signer: SignerWithAddress, verifier: IOrderVerifier, action: any) => Promise<string>
  let verifyFunctionPrototype: (action: any, signature: string) => Promise<ContractTransaction>

  describe('#positive', () => {
    async function check(
      message: { action: { common: { nonce: any } } },
      signFunction: typeof signFunctionPrototype,
      verifyFunction: typeof verifyFunctionPrototype,
    ) {
      const signature = await signFunction(userA, orderVerifier, message)

      const verification = await verifyFunction(message, signature)
      await expect(verification)
        .to.emit(orderVerifier, 'NonceCancelled')
        .withArgs(userA.address, message.action.common.nonce)

      expect(await orderVerifier.nonces(userA.address, message.action.common.nonce)).to.eq(true)
    }

    it('verifies common messages', async () => {
      // ensures domain, chain, and verifier are configured properly
      const message = createCommonMessage().common
      const signature = await signCommon(userA, orderVerifier, message)

      await expect(orderVerifier.connect(orderVerifierSigner).verifyCommon(message, signature))
        .to.emit(orderVerifier, 'NonceCancelled')
        .withArgs(userA.address, message.nonce)

      expect(await orderVerifier.nonces(userA.address, message.nonce)).to.eq(true)
    })

    it('rejects common w/ invalid signer or operator', async () => {
      const message = createCommonMessage(userA.address, userB.address).common
      const signature = await signCommon(userB, orderVerifier, message)

      await expect(
        orderVerifier.connect(orderVerifierSigner).verifyCommon(message, signature),
      ).to.be.revertedWithCustomError(orderVerifier, 'VerifierInvalidSignerError')

      expect(await orderVerifier.nonces(userA.address, message.nonce)).to.eq(false)
    })

    it('verifies actions', async () => {
      // ensures any problems with message encoding are not caused by a common data type
      const message = createActionMessage().action
      const signature = await signAction(userA, orderVerifier, message)

      await expect(orderVerifier.connect(orderVerifierSigner).verifyAction(message, signature))
        .to.emit(orderVerifier, 'NonceCancelled')
        .withArgs(userA.address, message.common.nonce)

      expect(await orderVerifier.nonces(userA.address, message.common.nonce)).to.eq(true)
    })

    it('verifies place order requests', async () => {
      await check(
        createPlaceOrderActionMessage(),
        signPlaceOrderAction,
        orderVerifier.connect(orderVerifierSigner).verifyPlaceOrder,
      )
    })

    it('verifies cancel order requests', async () => {
      await check(
        createCancelOrderActionMessage(),
        signCancelOrderAction,
        orderVerifier.connect(orderVerifierSigner).verifyCancelOrder,
      )
    })
  })

  describe('#negative', () => {
    let requests: Array<{
      message: { action: any }
      signFunc: typeof signFunctionPrototype
      verifyFunc: typeof verifyFunctionPrototype
    }>

    beforeEach(async () => {
      // builds a list of messages upon which negative testing shall be performed
      requests = [
        {
          message: createPlaceOrderActionMessage(),
          signFunc: signPlaceOrderAction,
          verifyFunc: orderVerifier.connect(orderVerifierSigner).verifyPlaceOrder,
        },
        {
          message: createCancelOrderActionMessage(),
          signFunc: signCancelOrderAction,
          verifyFunc: orderVerifier.connect(orderVerifierSigner).verifyCancelOrder,
        },
      ]
    })

    async function reject(
      message: { action: { common: { nonce: any } } },
      signFunction: typeof signFunctionPrototype,
      verifyFunction: typeof verifyFunctionPrototype,
      reason: string,
      signer = userA,
    ) {
      const signature = await signFunction(signer, orderVerifier, message)

      const verification = verifyFunction(message, signature)
      await expect(verification).to.be.revertedWithCustomError(orderVerifier, reason)
    }

    it('rejects requests with invalid domain', async () => {
      for (const request of requests) {
        request.message.action.common.domain = userB.address
        await reject(request.message, request.signFunc, request.verifyFunc, 'VerifierInvalidDomainError')
      }
    })

    async function signIncorrectly(signer: SignerWithAddress, verifier: IOrderVerifier, action: any): Promise<string> {
      return '0xd3Adb33f'
    }

    it('rejects requests with invalid signature', async () => {
      for (const request of requests) {
        await reject(request.message, signIncorrectly, request.verifyFunc, 'VerifierInvalidSignatureError')
      }
    })

    it('rejects requests with invalid signer', async () => {
      for (const request of requests) {
        await reject(request.message, request.signFunc, request.verifyFunc, 'VerifierInvalidSignerError', userB)
      }
    })

    it('rejects requests with invalid nonce', async () => {
      for (const request of requests) {
        const signature = await request.signFunc(userA, orderVerifier, request.message)
        await request.verifyFunc(request.message, signature)
        await reject(request.message, request.signFunc, request.verifyFunc, 'VerifierInvalidNonceError', userB)
      }
    })

    it('rejects requests with invalid group', async () => {
      await orderVerifier.connect(userA).cancelGroup(4)
      for (const request of requests) {
        request.message.action.common.group = 4
        await reject(request.message, request.signFunc, request.verifyFunc, 'VerifierInvalidGroupError', userB)
      }
    })

    it('rejects expired requests', async () => {
      await orderVerifier.connect(userA).cancelGroup(4)
      for (const request of requests) {
        request.message.action.common.expiry = 1487005200
        await reject(request.message, request.signFunc, request.verifyFunc, 'VerifierInvalidExpiryError', userB)
      }
    })
  })
})
