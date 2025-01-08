import { HardhatRuntimeEnvironment, Libraries } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { forkNetwork, isArbitrum, isFork, isMainnet } from '../../common/testutil/network'
import { INITIAL_AMOUNT } from './005_deploy_vault'
import { DEFAULT_KEEPER_ORACLE_TIMEOUT, L1_GAS_BUFFERS } from './003_deploy_oracle'
import { MARKET_LIBRARIES } from './004_deploy_market'
import { SIGNERS as CryptexSigners } from './007_deploy_cryptex_oracle'
import {
  Account__factory,
  AccountVerifier__factory,
  Controller_Arbitrum__factory,
  GasOracle__factory,
  KeeperOracle__factory,
  Manager_Arbitrum__factory,
  Market__factory,
  MarketFactory__factory,
  MetaQuantsFactory__factory,
  MultiInvoker__factory,
  OracleFactory__factory,
  OrderVerifier__factory,
  ProxyAdmin__factory,
  PythFactory__factory,
  TransparentUpgradeableProxy__factory,
  VaultFactory__factory,
  Verifier__factory,
} from '../types/generated'
import { PAYOFFS } from './002_deploy_payoff'

const SkipIfAlreadyDeployed = false

type TransparentUpgradeableProxyArgs = Parameters<TransparentUpgradeableProxy__factory['deploy']>
const log = (...args: unknown[]) => console.log('[v2.3 Migration]', ...args)
const write = (str: string) => process.stdout.write(`[v2.3 Migration] ${str}`)

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer

  if (!isArbitrum(getNetworkName())) {
    log('Skipping. This migration is only for Arbitrum and Arbitrum Sepolia')
    return
  }

  if (owner === deployer) log('[WARNING] Testnet detected, timelock will not be set as owner')

  log('Deploying v2.3 migration...')

  await deployVerifier(hre)
  await deployMarketContracts(hre)
  await deployVault(hre)
  await deployOracles(hre)
  await deployExtensions(hre)
  await deployTriggerOrders(hre)
  await deployCollateralAccounts(hre)

  log(`
    Step 0 of v2.3 migration complete! Next Steps: https://github.com/equilibria-xyz/perennial-v2/blob/4e2e17ec46ec55c778d7465d9495b80f5bd06bba/runbooks/MIGRATION_v2.3.md
  `)
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
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Verifier Proxy...')
  const verifierInterface = Verifier__factory.createInterface()
  const verifierProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('VerifierImpl')).address,
    proxyAdmin.address,
    verifierInterface.encodeFunctionData('initialize', [(await get('MarketFactory')).address]),
  ]
  await deploy('Verifier', {
    contract: 'TransparentUpgradeableProxy',
    args: verifierProxyArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Verifier...')
}

async function deployMarketContracts(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()

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
  const marketImplArgs: Parameters<Market__factory['deploy']> = [(await get('Verifier')).address]
  const marketImpl = await deploy('MarketImpl', {
    contract: 'Market',
    from: deployer,
    args: marketImplArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
    libraries: marketLibrariesBuilt,
  })
  log('  Deploying Market Factory Impl...')
  const marketFactoryArgs: Parameters<MarketFactory__factory['deploy']> = [
    (await get('OracleFactory')).address,
    (await get('Verifier')).address,
    marketImpl.address,
  ]
  await deploy('MarketFactoryImpl', {
    contract: 'MarketFactory',
    args: marketFactoryArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Market Contracts...')
}

async function deployVault(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()

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
  const vaultFactoryArgs: Parameters<VaultFactory__factory['deploy']> = [
    (await get('MarketFactory')).address,
    vaultImpl.address,
    INITIAL_AMOUNT,
  ]
  await deploy('VaultFactoryImpl', {
    contract: 'VaultFactory',
    args: vaultFactoryArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Vault...')
}

async function deployOracles(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner = await ethers.getSigner(deployer)
  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)
  const owner = isMainnet(hre.network.name) ? (await get('TimelockController')).address : deployer
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

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

  log('  Deploying KeeperOracle_Migration Impl...')
  await deploy('KeeperOracle_MigrationImpl', {
    contract: 'KeeperOracle_Migration',
    args: keeperOracleArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('  Deploying CommitmentGasOracle...')
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
    contract: 'GasOracle_Arbitrum',
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
    contract: 'GasOracle_Arbitrum',
    args: settlementGasOracleArgs,
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
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

  log('   Deploying PythFactoryMigration Impl...')
  await deploy('PythFactoryMigrationImpl', {
    contract: 'PythFactoryV2_2',
    args: [
      (await get('Pyth')).address,
      (await get('KeeperOracle_MigrationImpl')).address,
      4,
      12,
      {
        multiplierBase: 0, // Unused
        bufferBase: 788_000, // Each Call uses approx 750k gas
        multiplierCalldata: 0,
        bufferCalldata: 31_000,
      },
      {
        multiplierBase: ethers.utils.parseEther('1.05'), // Gas usage tracks full call
        bufferBase: 100_000, // Initial Fee + Transfers
        multiplierCalldata: ethers.utils.parseEther('1.05'), // Gas usage tracks full L1 calldata,
        bufferCalldata: 0,
      },
      4_200,
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy new PythFactoryProxy and setup oracles
  const previousPythFactory = new PythFactory__factory(deployerSigner).attach(
    (await get('PreviousPythFactory')).address,
  )
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
  log('  Setting up PythFactory...')
  if ((await pythFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    write('    Setting owner...')
    await (await pythFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
  for (const payoffName of PAYOFFS) {
    const payoffProvider = await get(payoffName)
    if (await pythFactory.payoffs(payoffProvider.address)) continue
    write(`    Registering payoff provider ${payoffName}...`)
    await (await pythFactory.register(payoffProvider.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles from previous pyth factory
  const previousOracles = await previousPythFactory.queryFilter(pythFactory.filters.OracleCreated())
  for (const event of previousOracles) {
    if ((await pythFactory.oracles(event.args.id)) !== ethers.constants.AddressZero) continue
    const previousUnderlyingId = await previousPythFactory.callStatic.toUnderlyingId(event.args.id)
    const previousPayoff = await previousPythFactory.callStatic.toUnderlyingPayoff(event.args.id)
    const address = await pythFactory.callStatic.create(event.args.id, previousUnderlyingId, {
      provider: previousPayoff.provider,
      decimals: previousPayoff.decimals,
    })
    log('    Creating oracle ID:', event.args.id, 'at address:', address)
    await pythFactory.create(event.args.id, previousUnderlyingId, {
      provider: previousPayoff.provider,
      decimals: previousPayoff.decimals,
    })
    log('    Registering oracle with sub-oracle')
    const oracle = await oracleFactory.oracles(event.args.id)
    const keeperOracleContract = new KeeperOracle__factory(deployerSigner).attach(address)
    await keeperOracleContract.register(oracle)
  }

  // Cryptex keepers for arb sepolia
  if (await getOrNull('CryptexFactory')) {
    const signer = isFork() ? CryptexSigners[forkNetwork()] : CryptexSigners[getNetworkName()]
    log('   Deploying CryptexFactoryMigration Impl...')
    await deploy('CryptexFactoryMigrationImpl', {
      contract: 'MetaQuantsFactoryV2_2',
      args: [
        signer,
        (await get('KeeperOracle_MigrationImpl')).address,
        4,
        12,
        {
          multiplierBase: 0, // Unused
          bufferBase: 788_000, // Each Call uses approx 750k gas
          multiplierCalldata: 0,
          bufferCalldata: 31_000,
        },
        {
          multiplierBase: ethers.utils.parseEther('1.05'), // Gas usage tracks full call
          bufferBase: 100_000, // Initial Fee + Transfers
          multiplierCalldata: ethers.utils.parseEther('1.05'), // Gas usage tracks full L1 calldata,
          bufferCalldata: 0,
        },
        4_200,
      ],
      from: deployer,
      skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
      log: true,
      autoMine: true,
    })

    log('  Deploying CryptexFactory Impl...')
    const cryptexFactoryArgs: Parameters<MetaQuantsFactory__factory['deploy']> = [
      signer,
      (await get('CommitmentGasOracle')).address,
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
    const previousCryptexFactory = new MetaQuantsFactory__factory(deployerSigner).attach(
      (await get('PreviousCryptexFactory')).address,
    )
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
    log('  Setting up CryptexFactory...')
    if ((await cryptexFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
      write('    Setting owner...')
      await (await cryptexFactory.updatePendingOwner(owner)).wait()
      process.stdout.write('complete\n')
    }

    const previousOracles = await previousCryptexFactory.queryFilter(cryptexFactory.filters.OracleCreated())
    for (const event of previousOracles) {
      const previousUnderlyingId = await previousCryptexFactory.callStatic.toUnderlyingId(event.args.id)
      const previousPayoff = await previousCryptexFactory.callStatic.toUnderlyingPayoff(event.args.id)
      const address = await cryptexFactory.callStatic.create(event.args.id, previousUnderlyingId, {
        provider: previousPayoff.provider,
        decimals: previousPayoff.decimals,
      })
      log('    Creating oracle ID:', event.args.id, 'at address:', address)
      await cryptexFactory.create(event.args.id, previousUnderlyingId, {
        provider: previousPayoff.provider,
        decimals: previousPayoff.decimals,
      })

      log('    Registering oracle with sub-oracle')
      const oracle = await oracleFactory.oracles(event.args.id)
      await new KeeperOracle__factory(deployerSigner).attach(address).register(oracle)
    }
  }

  log('Done deploying Oracles...')
}

async function deployExtensions(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  log('Deploying Extensions...')
  log('  Deploying MultiInvoker Impl...')
  const multiInvokerContract = isArbitrum(network.name) ? 'MultiInvoker_Arbitrum' : 'MultiInvoker_Optimism'

  const commitBuffer = isArbitrum(network.name)
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
  const multiInvokerArgs: Parameters<MultiInvoker__factory['deploy']> = [
    (await get('USDC')).address,
    (await get('DSU')).address,
    (await get('MarketFactory')).address,
    (await get('VaultFactory')).address,
    (await getOrNull('DSUBatcher'))?.address ?? ethers.constants.AddressZero,
    (await get('DSUReserve')).address,
    1_500_000, // Full Order Commit uses about 1.5M gas
    commitBuffer,
  ]
  await deploy('MultiInvokerImpl', {
    contract: multiInvokerContract,
    args: multiInvokerArgs,
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
}

async function deployTriggerOrders(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const proxyAdmin = new ProxyAdmin__factory(await ethers.getSigner(deployer)).attach((await get('ProxyAdmin')).address)

  log('Deploying Trigger Orders...')
  log('  Deploying Verifier Impl...')
  const orderVerifierArgs: Parameters<OrderVerifier__factory['deploy']> = [(await get('MarketFactory')).address]
  await deploy('OrderVerifierImpl', {
    contract: 'OrderVerifier',
    from: deployer,
    args: orderVerifierArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Verifier Proxy...')
  const orderVerifierProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('OrderVerifierImpl')).address,
    proxyAdmin.address,
    '0x',
  ]
  await deploy('OrderVerifier', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: orderVerifierProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('  Deploying Manager Impl...')
  const managerArgs: Parameters<Manager_Arbitrum__factory['deploy']> = [
    (await get('USDC')).address,
    (await get('DSU')).address,
    (await get('DSUReserve')).address,
    (await get('MarketFactory')).address,
    (await get('OrderVerifier')).address,
  ]
  await deploy('ManagerImpl', {
    contract: 'Manager_Arbitrum',
    from: deployer,
    args: managerArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Manager Proxy...')
  const managerProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('ManagerImpl')).address,
    proxyAdmin.address,
    Manager_Arbitrum__factory.createInterface().encodeFunctionData('initialize', [
      (await get('ChainlinkETHUSDFeed')).address,
      {
        // Unbuffered Keep Config (relayed messages), requires price commitment
        multiplierBase: ethers.utils.parseEther('1.05'),
        bufferBase: 788_000n, // buffer for withdrawing keeper fee from market
        multiplierCalldata: 0n,
        bufferCalldata: 35_200n,
      },
      {
        // Buffered Keep Config (market transfers, rebalances)
        multiplierBase: ethers.utils.parseEther('1.05'),
        bufferBase: 788_000n, // for price commitment
        multiplierCalldata: ethers.utils.parseEther('1.05'),
        bufferCalldata: 35_200n,
      },
    ]),
  ]
  await deploy('Manager', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: managerProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('Done deploying Trigger Orders...')
}

async function deployCollateralAccounts(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const proxyAdmin = new ProxyAdmin__factory(await ethers.getSigner(deployer)).attach((await get('ProxyAdmin')).address)

  log('Deploying Collateral Accounts...')
  log('  Deploying Account Impl...')
  const accountArgs: Parameters<Account__factory['deploy']> = [
    (await get('USDC')).address,
    (await get('DSU')).address,
    (await get('DSUReserve')).address,
  ]
  await deploy('AccountImpl', {
    contract: 'Account',
    from: deployer,
    args: accountArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Account Verifier Impl...')
  const accountVerifierArgs: Parameters<AccountVerifier__factory['deploy']> = [(await get('MarketFactory')).address]
  await deploy('AccountVerifierImpl', {
    contract: 'AccountVerifier',
    from: deployer,
    args: accountVerifierArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Account Verifier Proxy...')
  const accountVerifierProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('AccountVerifierImpl')).address,
    proxyAdmin.address,
    '0x',
  ]
  await deploy('AccountVerifier', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: accountVerifierProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Controller Impl...')
  const controllerArgs: Parameters<Controller_Arbitrum__factory['deploy']> = [
    (await get('AccountImpl')).address,
    (await get('MarketFactory')).address,
    (await get('Verifier')).address,
  ]
  await deploy('ControllerImpl', {
    contract: 'Controller_Arbitrum',
    from: deployer,
    args: controllerArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Controller Proxy...')
  const controllerProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('ControllerImpl')).address,
    proxyAdmin.address,
    Controller_Arbitrum__factory.createInterface().encodeFunctionData(
      'initialize(address,address,(uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256))',
      [
        (await get('AccountVerifier')).address,
        (await get('ChainlinkETHUSDFeed')).address,
        {
          // Unbuffered Keep Config (relayed messages)
          multiplierBase: ethers.utils.parseEther('1.05'),
          bufferBase: 275_000n, // buffer for handling the keeper fee
          multiplierCalldata: ethers.utils.parseEther('1.05'),
          bufferCalldata: 0n,
        },
        {
          // Buffered Keep Config (market transfers, rebalances)
          multiplierBase: ethers.utils.parseEther('1.08'),
          bufferBase: 788_000n, // for price commitment
          multiplierCalldata: ethers.utils.parseEther('1.08'),
          bufferCalldata: 35_200n,
        },
        {
          // Withdrawal keep config
          multiplierBase: ethers.utils.parseEther('0'), // Unused
          bufferBase: 300_000n,
          multiplierCalldata: ethers.utils.parseEther('1.05'),
          bufferCalldata: 0n,
        },
      ],
    ),
  ]
  await deploy('Controller', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: controllerProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Collateral Accounts...')
}

export default func
func.tags = ['v2_3_Migration']
