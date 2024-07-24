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
import {
  IERC20,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier,
  OrderVerifier__factory,
} from '../../types/generated'
import { signAction, signCommon, signPlaceOrderAction } from '../helpers/eip712'

const { ethers } = HRE

const MAX_FEE = utils.parseEther('8')

describe('Verifier', () => {
  let orderVerifier: OrderVerifier
  let manager: Manager_Arbitrum
  let market: FakeContract<IMarket>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let managerSigner: SignerWithAddress
  let orderVerifierSigner: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  function createCommonMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 6) {
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
  function createActionMessage(userAddress = userA.address, signerAddress = userAddress, expiresInSeconds = 6) {
    return {
      action: {
        market: market.address,
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
      },
      ...createActionMessage(userAddress, signerAddress, expiresInSeconds),
    }
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()

    // deploy a verifier
    orderVerifier = await new OrderVerifier__factory(owner).deploy()
    const dsu = await smock.fake<IERC20>('IERC20')
    const marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    // TODO: don't really need a real manager here
    manager = await new Manager_Arbitrum__factory(owner).deploy(
      dsu.address,
      marketFactory.address,
      orderVerifier.address,
    )

    orderVerifierSigner = await impersonate.impersonateWithBalance(orderVerifier.address, utils.parseEther('10'))
    managerSigner = await impersonate.impersonateWithBalance(manager.address, utils.parseEther('10'))
    market = await smock.fake<IMarket>('IMarket')
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  let signFunctionPrototype: (signer: SignerWithAddress, verifier: any, action: any) => string
  let verifyFunctionPrototype: (action: any, signature: string) => any

  describe('#positive', () => {
    // TODO: consider optional nonce parameter allowing this to be used for common and action messages
    // facility for signing and checking that verification was sucessful for any message containing an action
    async function check(
      message: { action: { common: { nonce: any } } },
      signFunction: signFunctionPrototype,
      verifyFunction: verifyFunctionPrototype,
    ) {
      const signature = await signFunction(userA, orderVerifier, message)

      const verification = verifyFunction(message, signature)
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

      // TODO: old way of testing; remove this
      /*const message = createPlaceOrderActionMessage()
      const signature = await signPlaceOrderAction(userA, orderVerifier, message)

      await expect(orderVerifier.connect(orderVerifierSigner).verifyPlaceOrder(message, signature))
        .to.emit(orderVerifier, 'NonceCancelled')
        .withArgs(userA.address, message.action.common.nonce)

      expect(await orderVerifier.nonces(userA.address, message.action.common.nonce)).to.eq(true)*/
    })
  })

  describe('#negative', () => {
    // TODO: create check facility which expects specific reverts
    // TODO: iterate through each message type, testing each revert case
  })
})
