import { HardhatRuntimeEnvironment, Libraries } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import { INITIAL_AMOUNT } from './005_deploy_vault'
import { DEFAULT_GRANULARITY, L1_GAS_BUFFERS } from './003_deploy_oracle'
import { MARKET_LIBRARIES } from './004_deploy_market'
import { OracleFactory__factory, ProxyAdmin__factory, PythFactory__factory } from '../types/generated'
import { PAYOFFS } from './002_deploy_payoff'
import { cmsqETHOracleID, msqBTCOracleID } from '../util/constants'

const SkipIfAlreadyDeployed = false

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const log = (...args: unknown[]) => console.log('[v2.2 Migration]', ...args)
  const write = (str: string) => process.stdout.write(`[v2.2 Migration] ${str}`)

  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  if (!isArbitrum(getNetworkName()) || !isMainnet(getNetworkName())) {
    log('Skipping. This migration is only for Arbitrum Mainnet')
    return
  }
  const deployerSigner = await ethers.getSigner(deployer)
  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

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

  // Deploy new PythFactoryProxy and setup oracles
  const previousPythFactory = (await get('PythFactory')).address
  const pythFactoryInterface = PythFactory__factory.createInterface()
  await deploy('PythFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('PythFactoryImpl')).address,
      proxyAdmin.address,
      pythFactoryInterface.encodeFunctionData('initialize', [
        (await get('OracleFactory')).address,
        (await get('ChainlinkETHUSDFeed')).address,
        (await get('DSU')).address,
      ]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)
  const pythFactory = new PythFactory__factory(deployerSigner).attach((await get('PythFactory')).address)
  log('  Setting up PythFactory...')
  if (!(await pythFactory.callers(oracleFactory.address))) {
    write('    Authorizing oracle factory to call pyth factory...')
    await (await pythFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }
  if ((await pythFactory.granularity()).effectiveAfter.eq(0)) {
    write('    Setting granularity...')
    await (await pythFactory.updateGranularity(DEFAULT_GRANULARITY)).wait()
    process.stdout.write('complete\n')
  }
  if ((await pythFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    write('    Setting owner...')
    await (await pythFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
  for (const payoffName of PAYOFFS) {
    write(`    Registering payoff provider ${payoffName}...`)
    const payoffProvider = await get(payoffName)
    await (await pythFactory.register(payoffProvider.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles from previous pyth factory
  const previousOracles = await new PythFactory__factory(deployerSigner)
    .attach(previousPythFactory)
    .queryFilter(pythFactory.filters.OracleCreated())
  for (const event of previousOracles) {
    // Create linear oracles
    const address = await pythFactory.callStatic.create(event.args.id, event.args.id, {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    })
    log('    Creating oracle ID:', event.args.id, 'at address:', address)
    await pythFactory.create(event.args.id, event.args.id, { provider: ethers.constants.AddressZero, decimals: 0 })
  }

  // Create power oracles
  log('    Creating cmsqETH Oracle in PythFactory at ID:', cmsqETHOracleID, '...')
  await pythFactory.create(cmsqETHOracleID, '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', {
    provider: (await get('PowerTwo')).address,
    decimals: -5,
  })

  log('    Creating msqBTC Oracle in PythFactory at ID:', msqBTCOracleID, '...')
  await pythFactory.create(msqBTCOracleID, '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', {
    provider: (await get('PowerTwo')).address,
    decimals: -6,
  })

  log('Done deploying Oracles...')

  // Extensions: MultiInvoker_{Arbitrum}, Gauntlet Coordinator
  log('Deploying Extensions...')
  log('  Deploying MultiInvoker Impl...')
  const multiInvokerContract = isArbitrum(getNetworkName()) ? 'MultiInvoker_Arbitrum' : 'MultiInvoker_Optimism'

  const commitBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
  await deploy('MultiInvokerImpl', {
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
