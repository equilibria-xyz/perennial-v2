import { expect } from 'chai'
import HRE from 'hardhat'
import { Controller, Controller__factory } from '../../types/generated'

const { ethers } = HRE

describe('Account', () => {
  let controller: Controller

  beforeEach(async () => {
    const [owner] = await ethers.getSigners()
    controller = await new Controller__factory(owner).deploy()
  })

  it('can generate unique addresses', async () => {
    const [, userA, userB] = await ethers.getSigners()

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

  // TODO: test account creation through signed message
})
