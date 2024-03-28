import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { PayoffFactory__factory, ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isMainnet } from '../../common/testutil/network'

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
  'CentimilliPowerTwo',
]

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy and register payoffs
  for (const payoffName of PAYOFFS) {
    const payoff = await deploy(payoffName, {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
    if (!(await payoffFactory.instances(payoff.address))) {
      process.stdout.write(`Registering payoff ${payoffName}...`)
      await (await payoffFactory.register(payoff.address)).wait()
      process.stdout.write('complete\n')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await payoffFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await payoffFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Payoff']
