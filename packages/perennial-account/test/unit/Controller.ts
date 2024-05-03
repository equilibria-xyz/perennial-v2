import { expect } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { Controller, Controller__factory, Verifier, Verifier__factory } from '../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { signAction, signCommon, signDeployAccount, signUpdateSigner } from '../helpers/erc712'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { ActionStruct } from '../../types/generated/contracts/Verifier'
import { Address } from 'hardhat-deploy/dist/types'
import { AccountDeployedEventObject } from '../../types/generated/contracts/Controller'

const { ethers } = HRE

describe('Controller', () => {
  let controller: Controller
  let verifier: Verifier
  let verifierSigner: SignerWithAddress
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(user: SignerWithAddress, feeOverride = utils.parseEther('12'), expiresInSeconds = 6) {
    return {
      action: {
        fee: feeOverride,
        common: {
          account: user.address,
          domain: controller.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(expiresInSeconds),
        },
      },
    }
  }

  // deploys a collateral account for the specified user and returns the address
  async function createCollateralAccount(user: SignerWithAddress): Promise<Address> {
    const deployAccountMessage = {
      user: user.address,
      ...createAction(user),
    }
    const signatureCreate = await signDeployAccount(user, verifier, deployAccountMessage)
    const tx = await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signatureCreate)
    // get the address from event arguments rather than making an extra RPC call
    const creationArgs = (await tx.wait()).events?.find(e => e.event === 'AccountDeployed')
      ?.args as any as AccountDeployedEventObject
    return creationArgs.account
  }

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    controller = await new Controller__factory(owner).deploy()
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    await controller.initialize(verifier.address)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  describe('#messaging', () => {
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
  })

  describe('#creation', () => {
    it('calculates unique addresses', async () => {
      const accountAddressA = await controller.getAccountAddress(userA.address)
      expect(accountAddressA).to.not.equal(userA.address)

      const accountAddressB = await controller.getAccountAddress(userB.address)
      expect(accountAddressB).to.not.equal(accountAddressA)
    })

    it('created address matches calculated address', async () => {
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)

      const accountAddressActual = await controller.connect(userA).callStatic.deployAccount()
      await expect(controller.connect(userA).deployAccount())
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)

      expect(accountAddressCalculated).to.equal(accountAddressActual)
    })

    it('creates collateral accounts from a signed message', async () => {
      const deployAccountMessage = {
        user: userA.address,
        ...createAction(userA),
      }

      // ensure message verification works
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
      const controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
      const signerResult = await verifier
        .connect(controllerSigner)
        .callStatic.verifyDeployAccount(deployAccountMessage, signature)
      expect(signerResult).to.eq(userA.address)

      // deploy and confirm address of the account matches calculated expectation
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)
      await expect(controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature))
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)

      // validate owners mapping was updated properly
      expect(await controller.owners(accountAddressCalculated)).to.equal(userA.address)
    })
  })

  describe('#delegation', () => {
    let accountAddressA: Address
    let accountAddressB: Address

    beforeEach(async () => {
      accountAddressA = await controller.getAccountAddress(userA.address)
      accountAddressB = await controller.getAccountAddress(userB.address)
    })

    it('can assign and disable a delegate', async () => {
      // validate initial state
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false

      // userA assigns userB as delegated signer for their collateral account
      await expect(controller.connect(userA).updateSigner(userB.address, true))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(accountAddressA, userB.address, true)
      expect(await controller.signers(accountAddressA, userB.address)).to.be.true

      // no-op update should neither revert nor change state
      await expect(controller.connect(userA).updateSigner(userB.address, true))
      expect(await controller.signers(accountAddressA, userB.address)).to.be.true

      // userA disables userB's delegatation rights
      await expect(controller.connect(userA).updateSigner(userB.address, false))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(accountAddressA, userB.address, false)
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false

      // no-op update should neither revert nor change state
      await expect(controller.connect(userA).updateSigner(userB.address, false))
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false

      // userA re-enables userB's delegation rights
      await expect(controller.connect(userA).updateSigner(userB.address, true))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(accountAddressA, userB.address, true)
      expect(await controller.signers(accountAddressA, userB.address)).to.be.true
    })

    it('cannot assign a delegate unless collateral account was created', async () => {
      // TODO: For discussion; this currently is not possible because the owner mapping will not exist.
      // We could spend extra gas to create that mapping, but that could become a keeper griefing vector.

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        account: accountAddressA,
        delegate: userB.address,
        newEnabled: true,
        ...createAction(userB),
      }

      // owner is unknown
      expect(await controller.owners(accountAddressA)).to.equal(constants.AddressZero)

      // should revert attempting to assign the delegate
      const signature = await signUpdateSigner(userA, verifier, updateSignerMessage)
      await expect(
        controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'InvalidSignerError')
    })

    it('can assign a delegate from a signed message', async () => {
      // validate initial state
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false

      // create the collateral account
      const accountAddress = await createCollateralAccount(userA)
      expect(accountAddress).to.equal(accountAddressA)

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        account: accountAddressA,
        delegate: userB.address,
        newEnabled: true,
        ...createAction(userA),
      }
      const signature = await signUpdateSigner(userA, verifier, updateSignerMessage)

      // ensure message verification works
      const controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
      const signerResult = await verifier
        .connect(controllerSigner)
        .callStatic.verifyUpdateSigner(updateSignerMessage, signature)
      expect(signerResult).to.eq(userA.address)

      // assign the delegate
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(accountAddressA, userB.address, true)
      expect(await controller.signers(accountAddressA, userB.address)).to.be.true
    })

    it('cannot assign a delegate from an unauthorized signer', async () => {
      // validate initial state
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false

      // create the collateral account
      await createCollateralAccount(userA)

      // userB signs a message granting them delegation rights to userA's collateral account
      const updateSignerMessage = {
        account: accountAddressA,
        delegate: userB.address,
        newEnabled: true,
        ...createAction(userA),
      }
      const signature = await signUpdateSigner(userB, verifier, updateSignerMessage)

      // ensure message verification fails
      const controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
      const signerResult = await verifier
        .connect(controllerSigner)
        .callStatic.verifyUpdateSigner(updateSignerMessage, signature)
      expect(signerResult).to.not.eq(userA.address)

      // ensure assignment fails
      await expect(
        controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'InvalidSignerError')
    })

    it('can disable a delegate from a signed message', async () => {
      // set up initial state
      await createCollateralAccount(userA)
      await controller.connect(userA).updateSigner(userB.address, true)
      expect(await controller.signers(accountAddressA, userB.address)).to.be.true

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        account: accountAddressA,
        delegate: userB.address,
        newEnabled: false,
        ...createAction(userA),
      }
      const signature = await signUpdateSigner(userA, verifier, updateSignerMessage)

      // disable the delegate
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(accountAddressA, userB.address, false)
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false
    })
  })
})
