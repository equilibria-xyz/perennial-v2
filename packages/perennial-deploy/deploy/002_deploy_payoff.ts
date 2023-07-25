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
    await payoffFactory.register(payoff.address)
  }

  // TODO: ownership

  // const DSU = new TestnetDSU__factory(deployerSigner).attach((await get('TestnetDSU')).address)
  // const reserveAddress = (await get('TestnetReserve')).address
  // if ((await DSU.minter()).toLowerCase() !== reserveAddress) {
  //   process.stdout.write('Setting minter to reserve...')
  //   await (await DSU.updateMinter(reserveAddress)).wait(2)
  //   process.stdout.write('complete\n')
  // }
}

export default func
func.tags = ['Payoff']
