import HRE from 'hardhat'
import { expect } from 'chai'
import { TimelockController, TimelockController__factory } from '../../../../types/generated'
import { getMultisigAddress } from '../../../../../common/testutil/constants'
import { constants } from 'ethers'

describe('Verify Timelock', () => {
  let timelock: TimelockController

  beforeEach(async () => {
    const { deployments, ethers } = HRE
    const [signer] = await ethers.getSigners()
    timelock = TimelockController__factory.connect((await deployments.get('TimelockController')).address, signer)
  })

  it('TimelockController', async () => {
    const deployer = (await HRE.deployments.get('TimelockController')).receipt?.from
    expect(!!deployer).to.not.be.false

    // Make typescript happy
    if (!deployer) throw new Error()

    expect(await timelock.callStatic.getMinDelay()).to.equal(60)

    const ADMIN_ROLE = await timelock.callStatic.DEFAULT_ADMIN_ROLE()
    const PROPOSER_ROLE = await timelock.callStatic.PROPOSER_ROLE()
    const EXECUTOR_ROLE = await timelock.callStatic.EXECUTOR_ROLE()
    const CANCELLER_ROLE = await timelock.callStatic.CANCELLER_ROLE()
    const TIMELOCK_ADMIN_ROLE = await timelock.callStatic.TIMELOCK_ADMIN_ROLE()

    // deployer can only cancel
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, deployer)).to.be.true
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, deployer)).to.be.false

    // Timelock should admin itself
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, timelock.address)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, timelock.address)).to.be.false
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, timelock.address)).to.be.false
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, timelock.address)).to.be.false
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, timelock.address)).to.be.true

    // Zero address (open role) should be able to execute
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, constants.AddressZero)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, constants.AddressZero)).to.be.false
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, constants.AddressZero)).to.be.true
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, constants.AddressZero)).to.be.false
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, constants.AddressZero)).to.be.false

    const safe = '0xBCefBBafD7fbA950713941a319061A64524c4e30'

    // safe should be able to propose
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, safe)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, safe)).to.be.true
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, safe)).to.be.false
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, safe)).to.be.false
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, safe)).to.be.false
  })
})
