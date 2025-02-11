import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import {
  OracleFactory__factory,
  ProxyAdmin__factory,
  StorkFactory__factory,
  GasOracle__factory,
} from '../types/generated'
import { KeeperFactoryParameter } from '../util/constants'
import { TransparentUpgradeableProxyArgs } from './999_v2.3_migration'
import { PAYOFFS } from './002_deploy_payoff_and_verifier'

export const DEFAULT_KEEPER_ORACLE_TIMEOUT = 60
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
const log = (...args: unknown[]) => console.log('[Stork Oracle]', ...args)
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
    0n, // Compute Gas
    0n, // Compute Multiplier
    0n, // Compute Base
    0n, // Calldata Gas
    0n, // Calldata Multiplier
    0n, // Calldata Base
  ]
  await deploy('Stork_CommitmentGasOracle', {
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
    0n, // Compute Gas
    0n, // Compute Multiplier
    0n, // Compute Base
    0n, // Calldata Gas
    0n, // Calldata Multiplier
    0n, // Calldata Base
  ]
  await deploy('Stork_SettlementGasOracle', {
    contract: gasOracleContract,
    args: settlementGasOracleArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy stork Implementations
  log('  Deploying StorkFactory Impl...')
  const storkFactoryArgs: Parameters<StorkFactory__factory['deploy']> = [
    (await get('Stork')).address,
    (await get('Stork_CommitmentGasOracle')).address,
    (await get('Stork_SettlementGasOracle')).address,
    (await get('KeeperOracleImpl')).address,
  ]
  await deploy('StorkFactoryImpl', {
    contract: 'StorkFactory',
    args: storkFactoryArgs,
    from: deployer,
    skipIfAlreadyDeployed: false,
    log: true,
    autoMine: true,
  })

  // Deploy stork Factory
  const storkFactoryInterface = StorkFactory__factory.createInterface()
  const storkFactoryProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('StorkFactoryImpl')).address,
    proxyAdmin.address,
    storkFactoryInterface.encodeFunctionData('initialize', [(await get('OracleFactory')).address]),
  ]
  await deploy('StorkFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: storkFactoryProxyArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const storkFactory = new StorkFactory__factory(deployerSigner).attach((await get('StorkFactory')).address)

  // Register stork Factory
  if (!(await oracleFactory.factories(storkFactory.address))) {
    process.stdout.write('Registering stork factory with oracle factory...')
    await (await oracleFactory.register(storkFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Register payoff providers
  for (const payoffName of PAYOFFS) {
    process.stdout.write(`Registering payoff provider ${payoffName}...`)
    const payoffProvider = await get(payoffName)
    await (await storkFactory.register(payoffProvider.address)).wait()
    process.stdout.write('complete\n')
  }

  // If mainnet, use timelock as owner
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  if ((await storkFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await storkFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update stork factory parameter
  if ((await storkFactory.parameter()).latestGranularity.eq(0)) {
    process.stdout.write('Setting stork factory parameter...')
    await (
      await storkFactory.updateParameter(
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
func.tags = ['StorkOracle']
