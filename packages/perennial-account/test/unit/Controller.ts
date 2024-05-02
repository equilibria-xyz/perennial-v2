import { expect } from 'chai'
import HRE from 'hardhat'
import { BigNumber, utils } from 'ethers'
import { Controller, Controller__factory, Verifier, Verifier__factory } from '../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { signDeployAccount } from '../helpers/erc712'
import { impersonate, time } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'

const { ethers } = HRE

describe('Controller', () => {
  let controller: Controller
  let verifier: Verifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    controller = await new Controller__factory(owner).deploy()
    verifier = await new Verifier__factory(owner).deploy()
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

    const accountAddressCalculated = await controller.getAccountAddress(owner.address)

    // TODO: move to helper function
    const accountAddressActual = await controller.connect(owner).callStatic.deployAccount()
    await controller.connect(owner).deployAccount()
    // TODO: check event was emitted

    expect(accountAddressCalculated).to.equal(accountAddressActual)
  })

  it('creates collateral accounts from a signed message', async () => {
    const deployAccountMessage = {
      user: userA.address,
      common: {
        account: userA.address,
        domain: verifier.address,
        nonce: nextNonce(),
        group: 0,
        expiry: currentTime.add(6),
      },
    }

    const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
    console.log('user', userA.address, 'verifier', verifier.address, 'controller', controller.address)
    console.log('signed message for', userA.address, 'with domain', verifier.address, signature)
    // FIXME: if keeper executes the TX, the domain won't match
    const verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    const signer = await verifier
      .connect(verifierSigner)
      .callStatic.verifyDeployAccount(deployAccountMessage, signature)
    // we don't actually want to call this here, because it will invalidate the nonce
    // await expect(verifier.connect(verifierSigner).verifyDeployAccount(deployAccountMessage, signature)).to.not.be.reverted
    // FIXME: verification passed, but this returns a random address each execution
    expect(signer).to.eq(userA.address)

    // await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature)
    // await controller.connect(verifierSigner).deployAccountWithSignature(deployAccountMessage, signature)
  })
})
