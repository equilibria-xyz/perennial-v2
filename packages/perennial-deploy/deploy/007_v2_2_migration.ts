import { HardhatRuntimeEnvironment, Libraries } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import { INITIAL_AMOUNT } from './005_deploy_vault'
import { L1_GAS_BUFFERS } from './003_deploy_oracle'
import { MARKET_LIBRARIES } from './004_deploy_market'

const SkipIfAlreadyDeployed = false

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const log = (...args: unknown[]) => console.log('[v2.2 Migration]', ...args)
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  if (!isArbitrum(getNetworkName()) || !isMainnet(getNetworkName())) {
    log('Skipping. This migration is only for Arbitrum Mainnet')
    return
  }

  log('Deploying v2.2 migration...')

  // Market: Market + all external libs, MarketFactory
  log('Deploying Market Contracts...')
  log('  Deploying Market libs...')
  const marketLibrariesBuilt: Libraries = {}
  for (const library of MARKET_LIBRARIES) {
    marketLibrariesBuilt[library.name] = (
      await deploy(library.name, {
        contract: library.contract,
        from: deployer,
        skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
        log: true,
        autoMine: true,
      })
    ).address
  }
  log('  Deploying Market Impl...')
  const marketImpl = await deploy('MarketImpl', {
    contract: 'Market',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
    libraries: marketLibrariesBuilt,
  })
  log('  Deploying Market Factory Impl...')
  await deploy('MarketFactoryImpl', {
    contract: 'MarketFactory',
    args: [(await get('OracleFactory')).address, marketImpl.address],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Market Contracts...')

  // Vault: Vault, VaultFactory
  log('Deploying Vault...')
  log('  Deploying Vault Impl...')
  const vaultImpl = await deploy('VaultImpl', {
    contract: 'Vault',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Vault Factory Impl...')
  await deploy('VaultFactoryImpl', {
    contract: 'VaultFactory',
    args: [(await get('MarketFactory')).address, vaultImpl.address, INITIAL_AMOUNT],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Vault...')

  // Oracles: Oracle, OracleFactory, KeeperOracle, PowerHalf, PowerTwo, PythFactory_{Arbitrum}
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
  await deploy('OracleFactoryImpl', {
    contract: 'OracleFactory',
    args: [(await get('OracleImpl')).address],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('  Deploying KeeperOracle Impl...')
  const pythFactoryContract = isArbitrum(getNetworkName()) ? 'PythFactory_Arbitrum' : 'PythFactory_Optimism'
  await deploy('KeeperOracleImpl', {
    contract: 'KeeperOracle',
    args: [60],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('  Deploying PythFactory Impl...')
  const commitBufferOracle = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata
    : L1_GAS_BUFFERS.base.commitCalldata
  const incrementalBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitIncrement
  await deploy('PythFactoryImpl', {
    contract: pythFactoryContract,
    args: [
      (await get('Pyth')).address,
      (await get('KeeperOracleImpl')).address,
      4,
      12,
      {
        multiplierBase: 0, // Unused
        bufferBase: 788_000, // Each Call uses approx 750k gas
        multiplierCalldata: 0,
        bufferCalldata: commitBufferOracle,
      },
      {
        multiplierBase: ethers.utils.parseEther('1.05'), // Gas usage tracks full call
        bufferBase: 100_000, // Initial Fee + Transfers
        multiplierCalldata: ethers.utils.parseEther('1.05'), // Gas usage tracks full L1 calldata,
        bufferCalldata: 0,
      },
      incrementalBuffer,
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying PowerHalf...')
  await deploy('PowerHalf', {
    args: [],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying PowerTwo...')
  await deploy('PowerTwo', {
    args: [],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('Done deploying Oracles...')

  // Extensions: MultiInvoker_{Arbitrum}, Gauntlet Coordinator
  log('Deploying Extensions...')
  log('  Deploying MultiInvoker Impl...')
  const multiInvokerContract = isArbitrum(getNetworkName()) ? 'MultiInvoker_Arbitrum' : 'MultiInvoker_Optimism'
  const multiInvokerContractName = isArbitrum(getNetworkName())
    ? 'MultiInvokerImpl_Arbitrum'
    : 'MultiInvokerImpl_Optimism'

  const commitBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
  await deploy(multiInvokerContractName, {
    contract: multiInvokerContract,
    args: [
      (await get('USDC')).address,
      (await get('DSU')).address,
      (await get('MarketFactory')).address,
      (await get('VaultFactory')).address,
      (await getOrNull('DSUBatcher'))?.address ?? ethers.constants.AddressZero,
      (await get('DSUReserve')).address,
      1_500_000, // Full Order Commit uses about 1.5M gas
      commitBuffer,
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  await deploy('GauntletCoordinator', {
    contract: 'Coordinator',
    args: [],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Extensions...')

  log(`
    Step 0 of v2.2 migration complete! Next Steps: https://github.com/equilibria-xyz/perennial-v2/blob/1a40c59618a233e8517bee6d48b58124e11686ce/runbooks/MIGRATION_v2.2.md
  `)
}

export default func
func.tags = ['v2_2_Migration']
