import { expect } from 'chai'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { BigNumber, constants, utils } from 'ethers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import HRE from 'hardhat'

import {
  signAction,
  signCommon,
  signDeployAccount,
  signMarketTransfer,
  signRebalanceConfigChange,
  signRelayedAccessUpdateBatch,
  signRelayedGroupCancellation,
  signRelayedNonceCancellation,
  signRelayedOperatorUpdate,
  signRelayedSignerUpdate,
  signRelayedTake,
  signWithdrawal,
} from '../../helpers/CollateralAccounts/eip712'
import {
  signAccessUpdateBatch,
  signGroupCancellation,
  signCommon as signNonceCancellation,
  signOperatorUpdate,
  signSignerUpdate,
  signTake,
} from '@perennial/v2-core/test/helpers/erc712'
import { impersonate } from '../../../../common/testutil'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { parse6decimal } from '../../../../common/testutil/types'
import { Verifier, Verifier__factory } from '@perennial/v2-core/types/generated'
import { AccountVerifier, AccountVerifier__factory, IController, IMarketFactory } from '../../../types/generated'
import {
  RelayedTakeStruct,
  TakeStruct,
} from '../../../types/generated/contracts/CollateralAccounts/interfaces/IRelayVerifier'

const { ethers } = HRE

describe('Verifier', () => {
  let accountVerifier: AccountVerifier
  let accountVerifierSigner: SignerWithAddress
  let controller: FakeContract<IController>
  let controllerSigner: SignerWithAddress
  let marketFactory: FakeContract<IMarketFactory>
  let market: FakeContract<IMarket>
  let marketSigner: SignerWithAddress
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user
  function createAction(
    userAddress: Address,
    signerAddress = userAddress,
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
    ;[owner, userA, userB, userC] = await ethers.getSigners()
    controller = await smock.fake<IController>('IController')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    accountVerifier = await new AccountVerifier__factory(owner).deploy(marketFactory.address)
    accountVerifierSigner = await impersonate.impersonateWithBalance(accountVerifier.address, utils.parseEther('10'))
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
    market = await smock.fake('IMarket')
    marketSigner = await impersonate.impersonateWithBalance(market.address, utils.parseEther('10'))
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

    it('rejects common w/ invalid signer or operator', async () => {
      const commonMessage = {
        account: userA.address,
        signer: userB.address,
        domain: accountVerifier.address,
        nonce: nextNonce(),
        group: 0,
        expiry: constants.MaxUint256,
      }
      const signature = await signCommon(userB, accountVerifier, commonMessage)

      await expect(
        accountVerifier.connect(accountVerifierSigner).verifyCommon(commonMessage, signature),
      ).to.be.revertedWithCustomError(accountVerifier, 'VerifierInvalidSignerError')

      expect(await accountVerifier.nonces(userA.address, commonMessage.nonce)).to.eq(false)
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
        ...createAction(userA.address),
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
        ...createAction(userA.address),
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
        ...createAction(userA.address),
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
        ...createAction(userA.address),
      }
      const signature = await signWithdrawal(userA, accountVerifier, withdrawalMessage)

      await expect(accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature)).to.not.be
        .reverted
    })

    it('rejects verification of message signed by unauthorized signer', async () => {
      // specify the correct signer in the message, but sign as someone else
      const withdrawalMessage = {
        amount: parse6decimal('55.6'),
        unwrap: false,
        ...createAction(userA.address),
      }
      const signature = await signWithdrawal(userB, accountVerifier, withdrawalMessage)
      // verifier should revert
      await expect(
        accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(accountVerifier, 'VerifierInvalidSignerError')
    })

    it('rejects verification of message with wrong domain', async () => {
      const withdrawalMessage = {
        amount: parse6decimal('55.6'),
        unwrap: false,
        ...createAction(userA.address),
      }
      withdrawalMessage.action.common.domain = accountVerifier.address
      const signature = await signWithdrawal(userA, accountVerifier, withdrawalMessage)
      await expect(
        accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(accountVerifier, 'VerifierInvalidDomainError')
    })

    it('prevents replay attack using invalidated nonce', async () => {
      const withdrawalMessage = {
        amount: parse6decimal('27.75'),
        unwrap: false,
        ...createAction(userA.address),
      }
      const signature = await signWithdrawal(userA, accountVerifier, withdrawalMessage)

      // first verification should succeed
      await expect(accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature)).to.not.be
        .reverted
      // second verification should revert
      await expect(
        accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(accountVerifier, 'VerifierInvalidNonceError')
    })

    it('prevents verification of cancelled group nonce', async () => {
      const withdrawalMessage = {
        amount: parse6decimal('27.75'),
        unwrap: false,
        ...createAction(userA.address),
      }
      withdrawalMessage.action.common.group = 4
      const signature = await signWithdrawal(userA, accountVerifier, withdrawalMessage)

      // first verification should succeed
      await expect(accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature)).to.not.be
        .reverted

      // invalidate the group nonce
      await accountVerifier.connect(userA).cancelGroup(4)

      // second verification using fresh nonce but cancelled group should fail
      withdrawalMessage.action.common.nonce = nextNonce()
      await expect(
        accountVerifier.connect(controllerSigner).verifyWithdrawal(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(accountVerifier, 'VerifierInvalidGroupError')
    })
  })

  describe('#relayed', () => {
    let downstreamVerifier: Verifier

    function createCommon() {
      return {
        common: {
          account: userA.address,
          signer: userA.address,
          domain: userA.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(60),
        },
      }
    }

    beforeEach(async () => {
      downstreamVerifier = await new Verifier__factory(owner).deploy()
      await downstreamVerifier.initialize(marketFactory.address)
    })

    it('verifies relayedTake messages', async () => {
      const take: TakeStruct = {
        amount: parse6decimal('15'),
        referrer: userC.address,
        common: {
          account: userB.address,
          signer: userB.address,
          domain: market.address,
          nonce: 1,
          group: 0,
          expiry: currentTime.add(60),
        },
      }
      const innerSignature = await signTake(userB, downstreamVerifier, take)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(marketSigner).verifyTake(take, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userB.address, take.common.nonce)

      // create and sign the outer messsage
      const relayedTake: RelayedTakeStruct = {
        take: take,
        ...createAction(userA.address),
      }
      const outerSignature = await signRelayedTake(userA, accountVerifier, relayedTake)
      // ensure outer message verification succeeds
      await expect(accountVerifier.connect(controllerSigner).verifyRelayedTake(relayedTake, outerSignature))
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedTake.action.common.nonce)
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
        ...createAction(userA.address),
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
        ...createCommon(),
      }
      const innerSignature = await signGroupCancellation(userA, downstreamVerifier, groupCancellation)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifyGroupCancellation(groupCancellation, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, groupCancellation.common.nonce)

      const relayedGroupCancellation = {
        groupCancellation: groupCancellation,
        ...createAction(userA.address),
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

    it('verifies relayedOperatorUpdate messages', async () => {
      // create and sign the inner message
      const operatorUpdate = {
        access: {
          accessor: userB.address,
          approved: false,
        },
        ...createCommon(),
      }
      const innerSignature = await signOperatorUpdate(userA, downstreamVerifier, operatorUpdate)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifyOperatorUpdate(operatorUpdate, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, operatorUpdate.common.nonce)

      // create and sign the outer message
      const relayedOperatorUpdateMessage = {
        operatorUpdate: operatorUpdate,
        ...createAction(userA.address),
      }
      const outerSignature = await signRelayedOperatorUpdate(userA, accountVerifier, relayedOperatorUpdateMessage)
      // ensure outer message verification succeeds
      await expect(
        accountVerifier
          .connect(controllerSigner)
          .verifyRelayedOperatorUpdate(relayedOperatorUpdateMessage, outerSignature),
      )
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedOperatorUpdateMessage.action.common.nonce)
    })

    it('verifies relayedSignerUpdate messages', async () => {
      // create and sign the inner message
      const signerUpdate = {
        access: {
          accessor: userB.address,
          approved: true,
        },
        ...createCommon(),
      }
      const innerSignature = await signSignerUpdate(userA, downstreamVerifier, signerUpdate)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifySignerUpdate(signerUpdate, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, signerUpdate.common.nonce)

      // create and sign the outer message
      const relayedSignerUpdateMessage = {
        signerUpdate: signerUpdate,
        ...createAction(userA.address),
      }
      const outerSignature = await signRelayedSignerUpdate(userA, accountVerifier, relayedSignerUpdateMessage)
      // ensure outer message verification succeeds
      await expect(
        accountVerifier.connect(controllerSigner).verifyRelayedSignerUpdate(relayedSignerUpdateMessage, outerSignature),
      )
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedSignerUpdateMessage.action.common.nonce)
    })

    it('verifies relayedAccessUpdateBatch messages', async () => {
      // create and sign the inner message
      const accessUpdateBatch = {
        operators: [{ accessor: userB.address, approved: true }],
        signers: [{ accessor: userC.address, approved: true }],
        ...createCommon(),
      }
      const innerSignature = await signAccessUpdateBatch(userA, downstreamVerifier, accessUpdateBatch)
      // ensure downstream verification will succeed
      await expect(downstreamVerifier.connect(userA).verifyAccessUpdateBatch(accessUpdateBatch, innerSignature))
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, accessUpdateBatch.common.nonce)

      // create and sign the outer message
      const relayedAccessUpdateBatchMessage = {
        accessUpdateBatch: accessUpdateBatch,
        ...createAction(userA.address),
      }
      const outerSignature = await signRelayedAccessUpdateBatch(userA, accountVerifier, relayedAccessUpdateBatchMessage)
      // ensure outer message verification succeeds
      await expect(
        accountVerifier
          .connect(controllerSigner)
          .verifyRelayedAccessUpdateBatch(relayedAccessUpdateBatchMessage, outerSignature),
      )
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedAccessUpdateBatchMessage.action.common.nonce)
    })

    it('prevents verification of expired messages', async () => {
      // create and sign the outer message
      const relayedSignerUpdateMessage = {
        signerUpdate: {
          access: {
            accessor: userB.address,
            approved: true,
          },
          ...createCommon(),
        },
        ...createAction(userA.address),
      }
      relayedSignerUpdateMessage.action.common.expiry = currentTime.sub(BigNumber.from(1))
      const outerSignature = await signRelayedSignerUpdate(userA, accountVerifier, relayedSignerUpdateMessage)
      await expect(
        accountVerifier.connect(controllerSigner).verifyRelayedSignerUpdate(relayedSignerUpdateMessage, outerSignature),
      ).to.be.revertedWithCustomError(accountVerifier, 'VerifierInvalidExpiryError')
    })
  })
})
