import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isMainnet } from '../../common/testutil/network'
import { KeeperOracle__factory, OracleFactory__factory, ProxyAdmin__factory } from '../types/generated'

export const DEFAULT_KEEPER_ORACLE_TIMEOUT = 30
export const L1_GAS_BUFFERS = {
  arbitrum: {
    commitCalldata: 31_000,
    commitIncrement: 4_200,
  },
  base: {
    commitCalldata: 17_000,
    commitIncrement: 4_200,
  },
}

export const DEFAULT_GRANULARITY = 10

const SkipIfAlreadyDeployed = false
const log = (...args: unknown[]) => console.log('[Oracle]', ...args)
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)
  const owner = isMainnet(hre.network.name) ? (await get('TimelockController')).address : deployer

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Oracle Implementations
  log('Deploying Oracles...')
  log('  Deploying Oracle Impl...')
  await deploy('OracleImpl', {
    contract: 'Oracle',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Oracle Factory Impl...')
  const oracleFactoryArgs: Parameters<OracleFactory__factory['deploy']> = [(await get('OracleImpl')).address]
  await deploy('OracleFactoryImpl', {
    contract: 'OracleFactory',
    args: oracleFactoryArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Oracle Factory
  const oracleFactoryInterface = OracleFactory__factory.createInterface()
  await deploy('OracleFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('OracleFactoryImpl')).address,
      proxyAdmin.address,
      oracleFactoryInterface.encodeFunctionData('initialize'),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  log('  Deploying KeeperOracle Impl...')
  const keeperOracleArgs: Parameters<KeeperOracle__factory['deploy']> = [DEFAULT_KEEPER_ORACLE_TIMEOUT]
  await deploy('KeeperOracleImpl', {
    contract: 'KeeperOracle',
    args: keeperOracleArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // If mainnet, use timelock as owner
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await oracleFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await oracleFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update oracle factory parameter
  if ((await oracleFactory.parameter()).maxGranularity.eq(1)) {
    process.stdout.write('Setting oracle factory parameter...')
    await (
      await oracleFactory.updateParameter({
        maxGranularity: 60,
        maxOracleFee: ethers.utils.parseUnits('0.25', 6),
        maxSettlementFee: ethers.utils.parseUnits('2', 6),
      })
    ).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Oracle']
