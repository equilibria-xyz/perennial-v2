import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Deployment } from 'hardhat-deploy/dist/types'
import { getMultisigAddress } from '../../common/testutil/constants'
import { Factory, Factory__factory, ProxyAdmin, ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const TIMELOCK_MIN_DELAY = 2 * 24 * 60 * 60

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  const networkName = getNetworkName()
  const dsuAddress = (await getOrNull('DSU'))?.address
  const multisigAddress = getMultisigAddress(networkName) || deployer
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  console.log('using DSU address: ' + dsuAddress)
  console.log('using Multisig address: ' + multisigAddress)

  // IMPLEMENTATIONS

  const marketImpl: Deployment = await deploy('Market_Impl', {
    contract: 'Market',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const factoryImpl: Deployment = await deploy('Factory_Impl', {
    contract: 'Controller',
    from: deployer,
    args: [marketImpl.address],
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // TIMELOCK

  const timelockController: Deployment = await deploy('TimelockController', {
    from: deployer,
    args: [TIMELOCK_MIN_DELAY, [multisigAddress], [ethers.constants.AddressZero]],
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // PROXY OWNERS

  await deploy('ProxyAdmin', {
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const proxyAdmin: ProxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // PROXIES

  await deploy('Factory_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [factoryImpl.address, proxyAdmin.address, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // INITIALIZE

  const factory: Factory = new Factory__factory(deployerSigner).attach((await get('Factory_Proxy')).address)

  if ((await factory.owner()) !== ethers.constants.AddressZero) {
    console.log('Controller already initialized.')
  } else {
    process.stdout.write('initializing Controller... ')
    await (await factory.initialize()).wait(2)
    process.stdout.write('complete.\n')
  }

  // TRANSFER OWNERSHIP

  if ((await proxyAdmin.owner()) === timelockController.address) {
    console.log(`proxyAdmin owner already set to ${timelockController.address}`)
  } else {
    process.stdout.write(`transferring proxyAdmin owner to ${timelockController.address}... `)
    await (await proxyAdmin.transferOwnership(timelockController.address)).wait(2)
    process.stdout.write('complete.\n')
  }
}

export default func
func.tags = ['Core']
