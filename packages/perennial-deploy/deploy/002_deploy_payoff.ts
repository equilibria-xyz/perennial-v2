import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { PayoffFactory__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ProxyAdmin__factory } from '@equilibria/perennial-v2/types/generated'

const PAYOFFS = [
  'Giga',
  'Kilo',
  'KiloPowerHalf',
  'KiloPowerTwo',
  'Mega',
  'MegaPowerTwo',
  'Micro',
  'MicroPowerTwo',
  'Milli',
  'MilliPowerHalf',
  'MilliPowerTwo',
  'Nano',
  'PowerHalf',
  'PowerTwo',
]

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Factory
  await deploy('PayoffFactoryImpl', {
    contract: 'PayoffFactory',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const payoffFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('PayoffFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('PayoffFactoryImpl')).address,
      proxyAdmin.address,
      payoffFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const payoffFactory = new PayoffFactory__factory(deployerSigner).attach((await get('PayoffFactory')).address)

  // Deploy Instances
  for (const payoffName of PAYOFFS) {
    const payoff = await deploy(payoffName, {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
    if (!(await payoffFactory.instances(payoff.address))) {
      process.stdout.write(`Registering payoff ${payoffName}...`)
      await payoffFactory.register(payoff.address)
      process.stdout.write('complete\n')
    }
  }

  if ((await payoffFactory.owner()).toLowerCase() !== (await get('TimelockController')).address.toLowerCase()) {
    process.stdout.write('Setting owner to timelock...')
    await payoffFactory.updatePendingOwner((await get('TimelockController')).address)
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Payoff']
