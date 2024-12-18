import HRE from 'hardhat'
import { expect } from 'chai'
import {
  ProxyAdmin,
  ProxyAdmin__factory,
  TimelockController,
  TimelockController__factory,
} from '../../../../types/generated'
import { getMultisigAddress } from '../../../../../common/testutil/constants'
import { constants } from 'ethers'

describe('Verify Perennial', () => {
  let timelock: TimelockController
  let proxyAdmin: ProxyAdmin
  let multisig: string

  beforeEach(async () => {
    const { deployments, ethers } = HRE
    const [signer] = await ethers.getSigners()
    timelock = TimelockController__factory.connect((await deployments.get('TimelockController')).address, signer)
    proxyAdmin = ProxyAdmin__factory.connect((await deployments.get('ProxyAdmin')).address, signer)
    if (!getMultisigAddress('arbitrum')) throw new Error('No Multisig Found')
    multisig = getMultisigAddress('arbitrum') as string
  })

  it('TimelockController', async () => {
    const deployer = (await HRE.deployments.get('TimelockController')).receipt?.from
    expect(!!deployer).to.not.be.false

    // Make typescript happy
    if (!deployer) throw new Error()

    const ADMIN_ROLE = await timelock.callStatic.DEFAULT_ADMIN_ROLE()
    const PROPOSER_ROLE = await timelock.callStatic.PROPOSER_ROLE()
    const EXECUTOR_ROLE = await timelock.callStatic.EXECUTOR_ROLE()
    const CANCELLER_ROLE = await timelock.callStatic.CANCELLER_ROLE()
    const TIMELOCK_ADMIN_ROLE = await timelock.callStatic.TIMELOCK_ADMIN_ROLE()

    expect(await timelock.callStatic.getMinDelay()).to.equal(60)

    // Deployer should have no admin rights
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, deployer)).to.be.false
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, deployer)).to.be.false

    // Multisig can propose and cancel
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, multisig)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, multisig)).to.be.true
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, multisig)).to.be.false
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, multisig)).to.be.true
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, multisig)).to.be.false

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
  })

  it('ProxyAdmin', async () => {
    expect(await proxyAdmin.callStatic.owner()).to.equal(timelock.address)
  })
})
