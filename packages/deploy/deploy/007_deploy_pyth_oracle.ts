import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import {
  GasOracle__factory,
  OracleFactory__factory,
  ProxyAdmin__factory,
  PythFactory__factory,
} from '../types/generated'
import { PAYOFFS } from './002_deploy_payoff_and_verifier'
import { TransparentUpgradeableProxyArgs } from './999_v2.3_migration'
import { KeeperFactoryParameter } from '../util/constants'

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

const SkipIfAlreadyDeployed = true
const log = (...args: unknown[]) => console.log('[Pyth Oracle]', ...args)
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)
  const owner = isMainnet(hre.network.name) ? (await get('TimelockController')).address : deployer

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  log('  Deploying CommitmentGasOracle...')
  const gasOracleContract = isArbitrum(getNetworkName()) ? 'GasOracle_Arbitrum' : 'GasOracle_Optimism'
  const commitmentGasOracleArgs: Parameters<GasOracle__factory['deploy']> = [
    (await get('ChainlinkETHUSDFeed')).address,
    8, // Chainlink Decimals
    788_000n, // Compute Gas
    ethers.utils.parseEther('1.05'), // Compute Multiplier
    50_000n, // Compute Base
    35_200n, // Calldata Gas
    ethers.utils.parseEther('1.05'), // Calldata Multiplier
    0n, // Calldata Base
  ]
  await deploy('CommitmentGasOracle', {
    contract: gasOracleContract,
    args: commitmentGasOracleArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying SettleGasOracle...')
  const settlementGasOracleArgs: Parameters<GasOracle__factory['deploy']> = [
    (await get('ChainlinkETHUSDFeed')).address,
    8, // Chainlink Decimals
    316_000n, // Compute Gas
    ethers.utils.parseEther('1.05'), // Compute Multiplier
    50_000n, // Compute Base
    6_000n, // Calldata Gas
    ethers.utils.parseEther('1.05'), // Calldata Multiplier
    0n, // Calldata Base
  ]
  await deploy('SettlementGasOracle', {
    contract: gasOracleContract,
    args: settlementGasOracleArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Pyth Implementations
  log('  Deploying PythFactory Impl...')
  const pythFactoryArgs: Parameters<PythFactory__factory['deploy']> = [
    (await get('Pyth')).address,
    (await get('CommitmentGasOracle')).address,
    (await get('SettlementGasOracle')).address,
    (await get('KeeperOracleImpl')).address,
  ]
  await deploy('PythFactoryImpl', {
    contract: 'PythFactory',
    args: pythFactoryArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Pyth Factory
  const pythFactoryInterface = PythFactory__factory.createInterface()
  const pythFactoryProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('PythFactoryImpl')).address,
    proxyAdmin.address,
    pythFactoryInterface.encodeFunctionData('initialize', [(await get('OracleFactory')).address]),
  ]
  await deploy('PythFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: pythFactoryProxyArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const pythFactory = new PythFactory__factory(deployerSigner).attach((await get('PythFactory')).address)

  // Register Pyth Factory
  if (!(await oracleFactory.factories(pythFactory.address))) {
    process.stdout.write('Registering pyth factory with oracle factory...')
    await (await oracleFactory.register(pythFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Register payoff providers
  for (const payoffName of PAYOFFS) {
    process.stdout.write(`Registering payoff provider ${payoffName}...`)
    const payoffProvider = await get(payoffName)
    await (await pythFactory.register(payoffProvider.address)).wait()
    process.stdout.write('complete\n')
  }

  // If mainnet, use timelock as owner
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  if ((await pythFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await pythFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update pyth factory parameter
  if ((await pythFactory.parameter()).latestGranularity.eq(0)) {
    process.stdout.write('Setting pyth factory parameter...')
    await (
      await pythFactory.updateParameter(
        KeeperFactoryParameter.granularity,
        KeeperFactoryParameter.oracleFee,
        KeeperFactoryParameter.validFrom,
        KeeperFactoryParameter.validTo,
      )
    ).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['PythOracle']
