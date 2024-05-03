import { expect } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { Controller, Controller__factory, Verifier, Verifier__factory } from '../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { signAction, signCommon, signDeployAccount } from '../helpers/erc712'
import { impersonate, time } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'

const { ethers } = HRE

describe('Controller', () => {
  let controller: Controller
  let verifier: Verifier
  let verifierSigner: SignerWithAddress
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let relayer: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB, relayer, keeper] = await ethers.getSigners()
    controller = await new Controller__factory(owner).deploy()
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    await controller.initialize(verifier.address)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  it('calculates unique addresses', async () => {
    const accountAddressA = await controller.getAccountAddress(userA.address)
    expect(accountAddressA).to.not.equal(userA.address)

    const accountAddressB = await controller.getAccountAddress(userB.address)
    expect(accountAddressB).to.not.equal(accountAddressA)
  })

  it('created address matches calculated address', async () => {
    const [owner] = await ethers.getSigners()

    const accountAddressCalculated = await controller.getAccountAddress(userA.address)

    const accountAddressActual = await controller.connect(userA).callStatic.deployAccount()
    await expect(controller.connect(userA).deployAccount())
      .to.emit(controller, 'AccountDeployed')
      .withArgs(userA.address, accountAddressCalculated)

    expect(accountAddressCalculated).to.equal(accountAddressActual)
  })

  it('should verify common', async () => {
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

  it('should verify action', async () => {
    // ensures any problems with message encoding are not caused by a common data type
    const nonce = nextNonce()
    const actionMessage = {
      relayer: relayer.address,
      fee: utils.parseEther('12'),
      common: {
        account: userB.address,
        domain: verifier.address,
        nonce: nonce,
        group: 0,
        expiry: constants.MaxUint256, // TODO: currentTime.add(6),
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

  it('creates collateral accounts from a signed message', async () => {
    const deployAccountMessage = {
      user: userA.address,
      action: {
        relayer: relayer.address,
        fee: utils.parseEther('12'),
        common: {
          account: userA.address,
          domain: controller.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(6),
        },
      },
    }

    const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
    const controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
    const signerResult = await verifier
      .connect(controllerSigner)
      .callStatic.verifyDeployAccount(deployAccountMessage, signature)
    expect(signerResult).to.eq(userA.address)

    const accountAddressCalculated = await controller.getAccountAddress(userA.address)
    await expect(controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature))
      .to.emit(controller, 'AccountDeployed')
      .withArgs(userA.address, accountAddressCalculated)
  })
})
