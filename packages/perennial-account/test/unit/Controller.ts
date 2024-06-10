import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { BigNumber, constants, utils } from 'ethers'
import {
  Controller,
  Controller__factory,
  IERC20,
  IEmptySetReserve,
  Verifier,
  Verifier__factory,
} from '../../types/generated'
import { AccountDeployedEventObject } from '../../types/generated/contracts/Controller'
import { signDeployAccount, signSignerUpdate } from '../helpers/erc712'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { smock } from '@defi-wonderland/smock'

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

  // create a default action for the specified user with reasonable fee and expiry
  async function createAction(
    userAddress: Address,
    signerAddress: Address,
    feeOverride = utils.parseEther('12'),
    expiresInSeconds = 6,
  ) {
    return {
      action: {
        maxFee: feeOverride,
        common: {
          account: userAddress,
          signer: signerAddress,
          domain: controller.address,
          nonce: nextNonce(),
          group: 0,
          expiry: (await currentBlockTimestamp()) + expiresInSeconds,
        },
      },
    }
  }

  // deploys a collateral account for the specified user and returns the address
  async function createCollateralAccount(user: SignerWithAddress): Promise<Address> {
    const deployAccountMessage = {
      ...(await createAction(user.address, user.address)),
    }
    const signatureCreate = await signDeployAccount(user, verifier, deployAccountMessage)
    const tx = await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signatureCreate)
    // verify the address from event arguments
    const creationArgs = (await tx.wait()).events?.find(e => e.event === 'AccountDeployed')
      ?.args as any as AccountDeployedEventObject
    const accountAddress = await controller.getAccountAddress(user.address)
    expect(creationArgs.account).to.equal(accountAddress)
    return accountAddress
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    controller = await new Controller__factory(owner).deploy()
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))

    // TODO: move to setupHelpers module, which doesn't exist in this branch
    const usdc = await smock.fake<IERC20>('IERC20')
    const dsu = await smock.fake<IERC20>('IERC20')
    const reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    await controller.initialize(verifier.address, usdc.address, dsu.address, reserve.address)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
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
        ...(await createAction(userA.address, userA.address)),
      }
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

      // deploy and confirm address of the account matches calculated expectation
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)
      await expect(controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature))
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)
    })

    it('creates collateral accounts from a delegated signer', async () => {
      // delegate userB to sign for userA
      await controller.connect(userA).updateSigner(userB.address, true)

      // create a message to create collateral account for userA but sign it as userB
      const deployAccountMessage = {
        ...(await createAction(userA.address, userB.address)),
      }
      const signature = await signDeployAccount(userB, verifier, deployAccountMessage)

      // create the account
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)
      await expect(controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature))
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)
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
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // no-op update should neither revert nor change state
      await expect(controller.connect(userA).updateSigner(userB.address, true))
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // userA disables userB's delegatation rights
      await expect(controller.connect(userA).updateSigner(userB.address, false))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, false)
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // no-op update should neither revert nor change state
      await expect(controller.connect(userA).updateSigner(userB.address, false))
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // userA re-enables userB's delegation rights
      await expect(controller.connect(userA).updateSigner(userB.address, true))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true
    })

    it('can assign a delegate from a signed message', async () => {
      // validate initial state
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // create the collateral account
      const accountAddress = await createCollateralAccount(userA)
      expect(accountAddress).to.equal(accountAddressA)

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...(await createAction(userA.address, userA.address)),
      }
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)

      // assign the delegate
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true
    })

    it('can assign a delegate before collateral account was created', async () => {
      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...(await createAction(userA.address, userA.address)),
      }

      // assign the delegate
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true
    })

    it('cannot assign a delegate from an unauthorized signer', async () => {
      // validate initial state
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // create the collateral account
      await createCollateralAccount(userA)

      // userB signs a message granting them delegation rights to userA's collateral account
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...(await createAction(userA.address, userB.address)),
      }
      const signature = await signSignerUpdate(userB, verifier, updateSignerMessage)

      // ensure message verification fails
      const controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
      const signerResult = await verifier
        .connect(controllerSigner)
        .callStatic.verifySignerUpdate(updateSignerMessage, signature)
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
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: false,
        ...(await createAction(userA.address, userA.address)),
      }
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)

      // disable the delegate
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, false)
      expect(await controller.signers(userA.address, userB.address)).to.be.false
    })
  })
})
