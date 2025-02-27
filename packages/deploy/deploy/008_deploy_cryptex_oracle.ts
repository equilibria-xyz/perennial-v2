import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import {
  OracleFactory__factory,
  ProxyAdmin__factory,
  MetaQuantsFactory__factory,
  GasOracle__factory,
} from '../types/generated'
import { KeeperFactoryParameter } from '../util/constants'
import { TransparentUpgradeableProxyArgs } from './999_v2.3_migration'
import { PAYOFFS } from './002_deploy_payoff_and_verifier'

export const SIGNERS: { [key: string]: string } = {
  arbitrum: '0xd24b631031524A2be9825D2Bb1b22416b0a254D8',
  arbitrumSepolia: '0x6B9d43F52C7d49C298c69d2e4C26f58D20886256',
}

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
const log = (...args: unknown[]) => console.log('[Cryptex Oracle]', ...args)
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
  await deploy('Cryptex_CommitmentGasOracle', {
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

  // Deploy cryptex Implementations
  log('  Deploying CryptexFactory Impl...')
  const cryptexFactoryArgs: Parameters<MetaQuantsFactory__factory['deploy']> = [
    SIGNERS[getNetworkName()],
    (await get('Cryptex_CommitmentGasOracle')).address,
    (await get('SettlementGasOracle')).address,
    'CryptexFactory',
    (await get('KeeperOracleImpl')).address,
  ]
  await deploy('CryptexFactoryImpl', {
    contract: 'MetaQuantsFactory',
    args: cryptexFactoryArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy cryptex Factory
  const cryptexFactoryInterface = MetaQuantsFactory__factory.createInterface()
  const cryptexFactoryProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('CryptexFactoryImpl')).address,
    proxyAdmin.address,
    cryptexFactoryInterface.encodeFunctionData('initialize', [(await get('OracleFactory')).address]),
  ]
  await deploy('CryptexFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: cryptexFactoryProxyArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const cryptexFactory = new MetaQuantsFactory__factory(deployerSigner).attach((await get('CryptexFactory')).address)

  // Register cryptex Factory
  if (!(await oracleFactory.factories(cryptexFactory.address))) {
    process.stdout.write('Registering cryptex factory with oracle factory...')
    await (await oracleFactory.register(cryptexFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Register payoff providers
  for (const payoffName of PAYOFFS) {
    process.stdout.write(`Registering payoff provider ${payoffName}...`)
    const payoffProvider = await get(payoffName)
    await (await cryptexFactory.register(payoffProvider.address)).wait()
    process.stdout.write('complete\n')
  }

  // If mainnet, use timelock as owner
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  if ((await cryptexFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await cryptexFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update cryptex factory parameter
  if ((await cryptexFactory.parameter()).latestGranularity.eq(0)) {
    process.stdout.write('Setting cryptex factory parameter...')
    await (
      await cryptexFactory.updateParameter(
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
func.tags = ['CryptexOracle']
