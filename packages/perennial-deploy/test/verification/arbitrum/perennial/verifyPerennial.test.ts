import HRE from 'hardhat'
import { expect } from 'chai'
import {
  MarketFactory,
  MarketFactory__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TimelockController,
  TimelockController__factory,
} from '../../../../types/generated'
import { getLabsMultisig, getMultisigAddress } from '../../../../../common/testutil/constants'
import ethers from 'ethers'

describe('Verify Perennial', () => {
  let timelock: TimelockController
  let proxyAdmin: ProxyAdmin
  let marketFactory: MarketFactory
  let multisig: string
  let labsMultisig: string

  beforeEach(async () => {
    const { deployments, ethers } = HRE
    const [signer] = await ethers.getSigners()
    timelock = TimelockController__factory.connect((await deployments.get('TimelockController')).address, signer)
    proxyAdmin = ProxyAdmin__factory.connect((await deployments.get('ProxyAdmin')).address, signer)
    marketFactory = MarketFactory__factory.connect((await deployments.get('MarketFactory')).address, signer)
    if (!getMultisigAddress('arbitrum')) throw new Error('No Multisig Found')
    multisig = getMultisigAddress('arbitrum') as string

    if (!getLabsMultisig('arbitrum')) throw new Error('No Multisig Found')
    labsMultisig = getLabsMultisig('arbitrum') as string
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
    expect(await timelock.callStatic.hasRole(ADMIN_ROLE, ethers.constants.AddressZero)).to.be.false
    expect(await timelock.callStatic.hasRole(PROPOSER_ROLE, ethers.constants.AddressZero)).to.be.false
    expect(await timelock.callStatic.hasRole(EXECUTOR_ROLE, ethers.constants.AddressZero)).to.be.true
    expect(await timelock.callStatic.hasRole(CANCELLER_ROLE, ethers.constants.AddressZero)).to.be.false
    expect(await timelock.callStatic.hasRole(TIMELOCK_ADMIN_ROLE, ethers.constants.AddressZero)).to.be.false
  })

  it('ProxyAdmin', async () => {
    expect(await proxyAdmin.callStatic.owner()).to.equal(timelock.address)
  })

  it('MarketFactory', async () => {
    await expect(marketFactory.callStatic.initialize()).to.be.reverted
    expect(await marketFactory.callStatic.owner()).to.equal(timelock.address)
    expect(await marketFactory.callStatic.pauser()).to.equal(labsMultisig)
    expect(await marketFactory.callStatic.implementation()).to.equal((await HRE.deployments.get('MarketImpl')).address)
    expect(await proxyAdmin.callStatic.getProxyAdmin(marketFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(marketFactory.address)).to.equal(
      (await HRE.deployments.get('MarketFactoryImpl')).address,
    )
  })

  it('Protocol Parameters', async () => {
    const param = await marketFactory.callStatic.parameter()
    expect(await marketFactory.paused()).to.be.false
    expect(param.protocolFee).to.equal(0)
    expect(param.maxFee).to.equal(0)
    expect(param.maxFeeAbsolute).to.equal(0)
    expect(param.maxCut).to.equal(0)
    expect(param.maxRate).to.equal(0)
    expect(param.minMaintenance).to.equal(0)
    expect(param.minEfficiency).to.equal(0)
  })
})
