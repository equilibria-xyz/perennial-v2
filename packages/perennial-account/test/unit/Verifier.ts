import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { BigNumber, constants, utils } from 'ethers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { IController, Verifier, Verifier__factory } from '../../types/generated'
import {
  signAction,
  signCommon,
  signDeployAccount,
  signMarketTransfer,
  signRebalanceConfigChange,
  signSignerUpdate,
  signWithdrawal,
} from '../helpers/erc712'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'

const { ethers } = HRE

describe('Verifier', () => {
  let verifier: Verifier
  let verifierSigner: SignerWithAddress
  let controller: FakeContract<IController>
  let controllerSigner: SignerWithAddress
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user
  function createAction(userAddress: Address, feeOverride = utils.parseEther('12'), expiresInSeconds = 6) {
    return {
      action: {
        maxFee: feeOverride,
        common: {
          account: userAddress,
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
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  it('verifies common messages', async () => {
    // ensures domain, chain, and verifier are configured properly
    const nonce = nextNonce()
    const commonMessage = {
      account: userA.address,
      domain: verifier.address,
      nonce: nonce,
      group: 0,
      expiry: constants.MaxUint256,
    }
    const signature = await signCommon(userA, verifier, commonMessage)

    const verifyResult = await verifier.connect(verifierSigner).callStatic.verifyCommon(commonMessage, signature)
    await expect(verifier.connect(verifierSigner).verifyCommon(commonMessage, signature))
      .to.emit(verifier, 'NonceCancelled')
      .withArgs(userA.address, nonce)

    expect(verifyResult).to.eq(userA.address)
    expect(await verifier.nonces(userA.address, nonce)).to.eq(true)
  })

  it('verifies actions', async () => {
    // ensures any problems with message encoding are not caused by a common data type
    const nonce = nextNonce()
    const actionMessage = {
      account: (await smock.fake('IAccount')).address,
      maxFee: utils.parseEther('12'),
      common: {
        account: userB.address,
        domain: verifier.address,
        nonce: nonce,
        group: 0,
        expiry: currentTime.add(6),
      },
    }
    const signature = await signAction(userB, verifier, actionMessage)

    const verifyResult = await verifier.connect(verifierSigner).callStatic.verifyAction(actionMessage, signature)
    await expect(verifier.connect(verifierSigner).verifyAction(actionMessage, signature))
      .to.emit(verifier, 'NonceCancelled')
      .withArgs(userB.address, nonce)

    expect(verifyResult).to.eq(userB.address)
    expect(await verifier.nonces(userB.address, nonce)).to.eq(true)
  })

  it('verifies deployAccount messages', async () => {
    const deployAccountMessage = {
      ...createAction(userA.address),
    }
    const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

    const signerResult = await verifier
      .connect(controllerSigner)
      .callStatic.verifyDeployAccount(deployAccountMessage, signature)
    expect(signerResult).to.eq(userA.address)
  })

  it('verifies marketTransfer messages', async () => {
    const market = await smock.fake('IMarket')
    const marketTransferMessage = {
      market: market.address,
      amount: constants.MaxInt256,
      ...createAction(userA.address),
    }
    const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

    const signerResult = await verifier
      .connect(controllerSigner)
      .callStatic.verifyMarketTransfer(marketTransferMessage, signature)
    expect(signerResult).to.eq(userA.address)
  })

  it('verifies rebalanceConfigChange messages', async () => {
    const btcMarket = await smock.fake('IMarket')
    const ethMarket = await smock.fake('IMarket')

    const rebalanceConfigChangeMessage = {
      markets: [btcMarket.address, ethMarket.address],
      configs: [
        { minCollateralization: parse6decimal('1.15'), maxCollateralization: parse6decimal('1.45') },
        { minCollateralization: parse6decimal('1.20'), maxCollateralization: parse6decimal('1.50') },
      ],
      ...createAction(userA.address),
    }
    const signature = await signRebalanceConfigChange(userA, verifier, rebalanceConfigChangeMessage)

    const signerResult = await verifier
      .connect(controllerSigner)
      .callStatic.verifyRebalanceConfigChange(rebalanceConfigChangeMessage, signature)
    expect(signerResult).to.eq(userA.address)
  })

  it('verifies signerUpdate messages', async () => {
    const updateSignerMessage = {
      signer: userB.address,
      approved: true,
      ...createAction(userA.address),
    }
    const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)

    const signerResult = await verifier
      .connect(controllerSigner)
      .callStatic.verifySignerUpdate(updateSignerMessage, signature)
    expect(signerResult).to.eq(userA.address)
  })

  it('verifies withdrawal messages', async () => {
    const usdc = await smock.fake('IERC20')
    const withdrawalMessage = {
      amount: parse6decimal('55.5'),
      unwrap: false,
      ...createAction(userA.address),
    }
    const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

    const signerResult = await verifier
      .connect(controllerSigner)
      .callStatic.verifyWithdrawal(withdrawalMessage, signature)
    expect(signerResult).to.eq(userA.address)
  })
})