import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  Controller,
  Controller__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  Verifier,
  Verifier__factory,
} from '../../types/generated'
import { signDeployAccount, signWithdrawal } from '../helpers/erc712'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, compatible with Market
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Market has 466k at height 208460709
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'
const USDCe_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' // Arbitrum bridged USDC

describe('Controller', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller
  let verifier: Verifier
  let verifierSigner: SignerWithAddress
  let accountA: Account
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(
    userAddress: Address,
    signerAddress: Address,
    feeOverride = utils.parseEther('14'),
    expiresInSeconds = 16,
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
          expiry: currentTime.add(expiresInSeconds),
        },
      },
    }
  }

  // funds specified wallet with 50k collateral
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    const dsuOwner = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    expect(await dsu.balanceOf(DSU_HOLDER)).to.be.greaterThan(utils.parseEther('50000'))
    await dsu.connect(dsuOwner).transfer(wallet.address, utils.parseEther('50000'))
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    // set up users and deploy artifacts
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
    usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, owner)
    controller = await new Controller__factory(owner).deploy()
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    await controller.initialize(verifier.address, usdc.address, dsu.address, DSU_RESERVE)

    // create a collateral account for userA with 15k collateral in it
    await fundWallet(userA)
    const accountAddressA = await controller.getAccountAddress(userA.address)
    await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'))
    const deployAccountMessage = {
      ...createAction(userA.address, userA.address),
    }
    const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
    await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature)
    accountA = Account__factory.connect(accountAddressA, userA)
  }

  beforeEach(async () => {
    currentTime = BigNumber.from(await currentBlockTimestamp())
    await loadFixture(fixture)
  })

  describe('#withdrawal', () => {
    it('can unwrap and partially withdraw funds from a signed message', async () => {
      // sign message to perform a partial withdrawal
      const withdrawalAmount = parse6decimal('6000')
      const withdrawalMessage = {
        amount: withdrawalAmount,
        unwrap: true,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature))
        .to.emit(usdc, 'Transfer')
        .withArgs(accountA.address, userA.address, withdrawalAmount)

      // ensure owner was credited the USDC and account's DSU was debited
      expect(await usdc.balanceOf(userA.address)).to.equal(withdrawalAmount)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('9000')) // 15k-9k
      expect(await usdc.balanceOf(accountA.address)).to.equal(0) // no USDC was deposited
    })

    it('can fully withdraw from a delegated signer', async () => {
      // configure userB as delegated signer
      await controller.connect(userA).updateSigner(userB.address, true)

      // delegate signs message for full withdrawal
      const withdrawalMessage = {
        amount: constants.MaxUint256,
        unwrap: true,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature)).to.not.be.reverted

      // ensure owner was credit all the USDC and account is empty
      expect(await usdc.balanceOf(userA.address)).to.equal(parse6decimal('15000'))
      expect(await dsu.balanceOf(accountA.address)).to.equal(0) // all DSU was withdrawan
      expect(await usdc.balanceOf(accountA.address)).to.equal(0) // no USDC was deposited
    })

    it('rejects withdrawals from unauthorized signer', async () => {
      expect(await controller.signers(accountA.address, userB.address)).to.be.false

      // unauthorized user signs message for withdrawal
      const withdrawalMessage = {
        amount: parse6decimal('2000'),
        unwrap: false,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // ensure withdrawal fails
      await expect(
        controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'InvalidSignerError')
    })
  })
})
