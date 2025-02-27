import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ProxyAdmin__factory } from '../types/generated'
import { TransparentUpgradeableProxyArgs } from './999_v2.3_migration'

const log = (...args: unknown[]) => console.log('[Payoff & Verifier]', ...args)
export const PAYOFFS = ['PowerHalf', 'PowerTwo', 'Inverse']
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  // Deploy and register payoffs
  for (const payoffName of PAYOFFS) {
    await deploy(payoffName, {
      contract: payoffName,
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }

  // Deploy verifier
  await deployVerifier(hre)
}

async function deployVerifier(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const proxyAdmin = new ProxyAdmin__factory(await ethers.getSigner(deployer)).attach((await get('ProxyAdmin')).address)

  log('Deploying Verifier...')
  log('  Deploying Verifier Impl...')
  await deploy('VerifierImpl', {
    contract: 'Verifier',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  log('  Deploying Verifier Proxy...')
  const verifierProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('VerifierImpl')).address,
    proxyAdmin.address,
    '0x',
  ]
  await deploy('Verifier', {
    contract: 'TransparentUpgradeableProxy',
    args: verifierProxyArgs,
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  log('Done deploying Verifier...')
}

export default func
func.tags = ['PayoffAndVerifier']
