import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { BigNumber, constants, utils } from 'ethers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { AccountVerifier, AccountVerifier__factory, IController } from '../../types/generated'
import {
  signAction,
  signCommon,
  signDeployAccount,
  signMarketTransfer,
  signRebalanceConfigChange,
  signRelayedGroupCancellation,
  signRelayedNonceCancellation,
  signRelayedSignerUpdate,
  signWithdrawal,
} from '../helpers/erc712'
import {
  signGroupCancellation,
  signCommon as signNonceCancellation,
  signSignerUpdate,
} from '@equilibria/perennial-v2-verifier/test/helpers/erc712'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { Verifier, Verifier__factory } from '@equilibria/perennial-v2-verifier/types/generated'

const { ethers } = HRE

describe('Verifier', () => {
  let accountVerifier: AccountVerifier
  let accountVerifierSigner: SignerWithAddress
  let controller: FakeContract<IController>
  let controllerSigner: SignerWithAddress
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user
  function createAction(
    userAddress: Address,
    signerAddress: Address,
    maxFee = utils.parseEther('12'),
    expiresInSeconds = 6,
  ) {
    return {
      action: {
        maxFee: maxFee,
        common: {
          account: userAddress,
          signer: signerAddress,
          domain: controller.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(expiresInSeconds),
        },
      },
    }
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()
    controller = await smock.fake<IController>('IController')
    accountVerifier = await new AccountVerifier__factory(owner).deploy()
    accountVerifierSigner = await impersonate.impersonateWithBalance(accountVerifier.address, utils.parseEther('10'))
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  describe('#non-relayed', () => {
    it('verifies common messages', async () => {
      // ensures domain, chain, and verifier are configured properly
      const nonce = nextNonce()
      const commonMessage = {
        account: userA.address,
        signer: userA.address,
        domain: accountVerifier.address,
        nonce: nonce,
        group: 0,
        expiry: constants.MaxUint256,
      }
      const signature = await signCommon(userA, accountVerifier, commonMessage)

      await accountVerifier.connect(accountVerifierSigner).callStatic.verifyCommon(commonMessage, signature)
      await expect(accountVerifier.connect(accountVerifierSigner).verifyCommon(commonMessage, signature))
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, nonce)

      expect(await accountVerifier.nonces(userA.address, nonce)).to.eq(true)
    })

    it('verifies actions', async () => {
      // ensures any problems with message encoding are not caused by a common data type
      const nonce = nextNonce()
      const actionMessage = {
        account: (await smock.fake('IAccount')).address,
        maxFee: utils.parseEther('12'),
        common: {
          account: userB.address,
          signer: userB.address,
          domain: accountVerifier.address,
          nonce: nonce,
          group: 0,
          expiry: currentTime.add(6),
        },
      }
      const signature = await signAction(userB, accountVerifier, actionMessage)

      await expect(accountVerifier.connect(accountVerifierSigner).verifyAction(actionMessage, signature))
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userB.address, nonce)

      expect(await accountVerifier.nonces(userB.address, nonce)).to.eq(true)
    })

    it('verifies deployAccount messages', async () => {
      const deployAccountMessage = {
        ...createAction(userA.address, userA.address),
      }
      const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)

      await expect(accountVerifier.connect(controllerSigner).verifyDeployAccount(deployAccountMessage, signature)).to
        .not.be.reverted
    })

    it('verifies marketTransfer messages', async () => {
      const market = await smock.fake('IMarket')
      const marketTransferMessage = {
        market: market.address,
        amount: constants.MaxInt256,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

      await expect(accountVerifier.connect(controllerSigner).verifyMarketTransfer(marketTransferMessage, signature)).to
        .not.be.reverted
    })

    it('verifies rebalanceConfigChange messages', async () => {
      const btcMarket = await smock.fake('IMarket')
      const ethMarket = await smock.fake('IMarket')

      const rebalanceConfigChangeMessage = {
        group: constants.Zero,
        markets: [btcMarket.address, ethMarket.address],
        configs: [
          { target: parse6decimal('0.55'), threshold: parse6decimal('0.038') },
          { target: parse6decimal('0.45'), threshold: parse6decimal('0.031') },
        ],
        maxFee: constants.Zero,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signRebalanceConfigChange(userA, accountVerifier, rebalanceConfigChangeMessage)

      await expect(
        accountVerifier.connect(controllerSigner).verifyRebalanceConfigChange(rebalanceConfigChangeMessage, signature),
      ).to.not.be.reverted
    })

    it('verifies withdrawal messages', async () => {
      const withdrawalMessage = {
        amount: parse6decimal('55.5'),
        unwrap: false,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signWithdrawal(userA, accountVerifier, withdrawalMessage)

      await expect(accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature)).to.not.be
        .reverted
    })
  })

  describe('#relayed', () => {
    let downstreamVerifier: Verifier

    beforeEach(async () => {
      downstreamVerifier = await new Verifier__factory(owner).deploy()
    })

    it('verifies relayedNonceCancellation messages', async () => {
      const nonceCancellation = {
        account: userA.address,
        signer: userA.address,
        domain: userA.address,
        nonce: 4,
        group: 0,
        expiry: currentTime.add(60),
      }
      const innerSignature = await signNonceCancellation(userA, downstreamVerifier, nonceCancellation)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifyCommon(nonceCancellation, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, nonceCancellation.nonce)

      // create and sign the outer message
      const relayedNonceCancellation = {
        nonceCancellation: nonceCancellation,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedNonceCancellation(userA, accountVerifier, relayedNonceCancellation)
      // ensure outer message verification succeeds
      await expect(
        accountVerifier
          .connect(controllerSigner)
          .verifyRelayedNonceCancellation(relayedNonceCancellation, outerSignature),
      )
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedNonceCancellation.action.common.nonce)
    })

    it('verifies relayedGroupCancellation messages', async () => {
      const groupCancellation = {
        group: 6,
        common: {
          account: userA.address,
          signer: userA.address,
          domain: userA.address,
          nonce: 0,
          group: 0,
          expiry: currentTime.add(60),
        },
      }
      const innerSignature = await signGroupCancellation(userA, downstreamVerifier, groupCancellation)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifyGroupCancellation(groupCancellation, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, 0)

      const relayedGroupCancellation = {
        groupCancellation: groupCancellation,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedGroupCancellation(userA, accountVerifier, relayedGroupCancellation)
      // ensure outer message verification succeeds
      await expect(
        accountVerifier
          .connect(controllerSigner)
          .verifyRelayedGroupCancellation(relayedGroupCancellation, outerSignature),
      )
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedGroupCancellation.action.common.nonce)
    })

    it('verifies relayedSignerUpdate messages', async () => {
      // create and sign the inner message
      const signerUpdate = {
        access: {
          accessor: userB.address,
          approved: true,
        },
        common: {
          account: userA.address,
          signer: userA.address,
          domain: userA.address,
          nonce: nextNonce(), // TODO: inner nonce is unrelated to AccountVerifier and should be chosen separately
          group: 0,
          expiry: currentTime.add(60),
        },
      }
      const innerSignature = await signSignerUpdate(userA, downstreamVerifier, signerUpdate)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifySignerUpdate(signerUpdate, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, signerUpdate.common.nonce)

      // create and sign the outer message
      const relayedSignerUpdateMessage = {
        signerUpdate: signerUpdate,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedSignerUpdate(userA, accountVerifier, relayedSignerUpdateMessage)
      // ensure outer message verification succeeds
      await expect(
        accountVerifier.connect(controllerSigner).verifyRelayedSignerUpdate(relayedSignerUpdateMessage, outerSignature),
      )
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedSignerUpdateMessage.action.common.nonce)
    })
  })
})
