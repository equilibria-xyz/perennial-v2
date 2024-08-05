import { expect } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { BigNumber, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { IMarket, IMarketFactory } from '@equilibria/perennial-v2/types/generated'
import { IERC20, IManager, IOrderVerifier, OrderVerifier, OrderVerifier__factory } from '../../types/generated'
import { signAction, signCancelOrderAction, signCommon, signPlaceOrderAction } from '../helpers/eip712'

const { ethers } = HRE

const MAX_FEE = utils.parseEther('8')

describe('Verifier', () => {
  let orderVerifier: OrderVerifier
  let manager: FakeContract<IManager>
  let market: FakeContract<IMarket>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let managerSigner: SignerWithAddress
  let orderVerifierSigner: SignerWithAddress
  let lastNonce = 0
  let lastOrderNonce = 30
  let currentTime: BigNumber

  function createCommonMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 18) {
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
  function createActionMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 12) {
    return {
      action: {
        market: market.address,
        orderNonce: nextOrderNonce(),
        maxFee: MAX_FEE,
        ...createCommonMessage(userAddress, signerAddress, expiresInSeconds),
      },
    }
  }

  function createPlaceOrderActionMessage(
    userAddress = userA.address,
    signerAddress = userAddress,
    expiresInSeconds = 6,
  ) {
    return {
      order: {
        side: 0,
        comparison: -1,
        price: parse6decimal('2010.33'),
        delta: parse6decimal('400'),
        maxFee: parse6decimal('0.67'),
        referrer: userB.address,
      },
      ...createActionMessage(userAddress, signerAddress, expiresInSeconds),
    }
  }

  function createCancelOrderActionMessage(
    userAddress = userA.address,
    signerAddress = userAddress,
    expiresInSeconds = 6,
  ) {
    return {
      ...createActionMessage(userAddress, signerAddress, expiresInSeconds),
    }
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    return BigNumber.from(++lastNonce)
  }

  function nextOrderNonce(): BigNumber {
    return BigNumber.from(++lastOrderNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()

    // deploy a verifier
    orderVerifier = await new OrderVerifier__factory(owner).deploy()
    const dsu = await smock.fake<IERC20>('IERC20')
    const marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    manager = await smock.fake<IManager>('IManager')

    orderVerifierSigner = await impersonate.impersonateWithBalance(orderVerifier.address, utils.parseEther('10'))
    managerSigner = await impersonate.impersonateWithBalance(manager.address, utils.parseEther('10'))
    market = await smock.fake<IMarket>('IMarket')
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  let signFunctionPrototype: (signer: SignerWithAddress, verifier: IOrderVerifier, action: any) => Promise<string>
  let verifyFunctionPrototype: (action: any, signature: string) => Promise<undefined>

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
