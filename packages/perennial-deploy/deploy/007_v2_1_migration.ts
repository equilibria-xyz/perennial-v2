import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import { OracleFactory__factory, ProxyAdmin__factory, PythFactory__factory } from '../types/generated'
import { INITIAL_AMOUNT } from './005_deploy_vault'
import { DEFAULT_GRANULARITY } from './003_deploy_oracle'

const SkipIfAlreadyDeployed = false

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  if (!isArbitrum(getNetworkName()) || !isMainnet(getNetworkName())) {
    console.log('Skipping. This migration is only for Arbitrum Mainnet')
    return
  }

  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  console.log('Deploying v2.1 migration...')

  // Deploy Oracle Implementations
  console.log('Deploying new Oracle and OracleFactory Impls')
  await deploy('OracleImpl', {
    contract: 'Oracle',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  await deploy('OracleFactoryImpl', {
    contract: 'OracleFactory',
    args: [(await get('OracleImpl')).address],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // Deploy Pyth Implementations
  console.log('Deploying new PythFactory')
  const pythFactoryContract = isArbitrum(getNetworkName()) ? 'PythFactory_Arbitrum' : 'PythFactory_Optimism'
  await deploy('KeeperOracleImpl', {
    contract: 'KeeperOracle',
    args: [60],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  await deploy('PythFactoryImpl', {
    contract: pythFactoryContract,
    args: [
      (await get('Pyth')).address,
      (await get('KeeperOracleImpl')).address,
      4,
      12,
      {
        multiplierBase: 0, // Unused
        bufferBase: 900_000, // Each Call uses approx 750k gas
        multiplierCalldata: 0,
        bufferCalldata: 36_000, // Each update costs 31k L1 gas
      },
      {
        multiplierBase: ethers.utils.parseEther('1.15'), // Gas usage tracks full call
        bufferBase: 100_000, // Initial Fee + Transfers
        multiplierCalldata: ethers.utils.parseEther('1.15'), // Gas usage tracks full L1 calldata,
        bufferCalldata: 0,
      },
      4_600, // Each subsequent pyth commitment adds about 4k L1 gas
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Pyth Factory
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
  const pythFactory = new PythFactory__factory(deployerSigner).attach((await get('PythFactory')).address)

  // Authorize Oracle Factory
  if (!(await pythFactory.callers(oracleFactory.address))) {
    process.stdout.write('Authorizing oracle factory to call pyth factory...')
    await (await pythFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles
  const oracleIDs = [
    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52',
    '0x09f7c1d7dfbb7df2b8fe3d3d87ee94a2259d212da4f30c1f0540d066dfa44723',
    '0x2f2d17abbc1e781bd87b4a5d52c8b2856886f5c482fa3593cebf6795040ab0b6',
    '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
    '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
    '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8',
    '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
  ] // (await oracleFactory.queryFilter(oracleFactory.filters.OracleCreated())).map(e => e.args.id)
  if (!oracleIDs) throw new Error('No oracle IDs for network')
  for (const id of Object.values(oracleIDs)) {
    if ((await pythFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Associating pyth oracle id ${id}...`)
      await (await pythFactory.associate(id, id)).wait()
      process.stdout.write(`Creating pyth oracle ${id}...`)
      const address = await pythFactory.callStatic.create(id)
      process.stdout.write(`deploying at ${address}...`)
      await (await pythFactory.create(id)).wait()
      process.stdout.write('complete\n')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  if ((await pythFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await pythFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update granularity
  if ((await pythFactory.granularity()).effectiveAfter.eq(0)) {
    process.stdout.write('Setting granularity...')
    await (await pythFactory.updateGranularity(DEFAULT_GRANULARITY)).wait()
    process.stdout.write('complete\n')
  }

  // Deploy Market Implementations
  console.log('Deploying new Market and MarketFactory Impls')
  const marketParamaterStorage = await deploy('MarketParameterStorageLib', {
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const riskParamaterStorage = await deploy('RiskParameterStorageLib', {
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const marketImpl = await deploy('MarketImpl', {
    contract: 'Market',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
    libraries: {
      MarketParameterStorageLib: marketParamaterStorage.address,
      RiskParameterStorageLib: riskParamaterStorage.address,
    },
  })
  await deploy('MarketFactoryImpl', {
    contract: 'MarketFactory',
    args: [(await get('OracleFactory')).address, (await get('PayoffFactory')).address, marketImpl.address],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Vault Implementations
  console.log('Deploying new Vault and VaultFactory Impls')
  const vaultImpl = await deploy('VaultImpl', {
    contract: 'Vault',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  await deploy('VaultFactoryImpl', {
    contract: 'VaultFactory',
    args: [(await get('MarketFactory')).address, vaultImpl.address, INITIAL_AMOUNT],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy MultiInvoker Implementation
  console.log('Deploying new MultiInvoker Impl')
  const multiInvokerContract = isArbitrum(getNetworkName()) ? 'MultiInvoker_Arbitrum' : 'MultiInvoker'
  const multiInvokerContractName = isArbitrum(getNetworkName()) ? 'MultiInvokerImpl_Arbitrum' : 'MultiInvokerImpl'
  await deploy(multiInvokerContractName, {
    contract: multiInvokerContract,
    args: [
      (await get('USDC')).address,
      (await get('DSU')).address,
      (await get('MarketFactory')).address,
      (await get('VaultFactory')).address,
      (await getOrNull('DSUBatcher'))?.address ?? ethers.constants.AddressZero,
      (await get('DSUReserve')).address,
      1_800_000, // Full Order Commit uses about 1.5M gas
      36_000, // Single commitment uses 31k calldata gas
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  console.log(`
    Step 0 of migration complete! Next Steps:
    1. Register new PythFactory with OracleFactory
    2. Update Market virtualSkew values with new staticSkew values
    3. Atomically
      a. Settle all markets
      b. 'proxyAdmihn.upgrade' MarketFactory, VaultFactory, MultiInvoker contracts
      c. 'proxyAdmin.upgradeAndCall' OracleFactory(initialize)
      d. 'oracleFactory.update(oracleID, pythFactory)' for each each oracleID
      e. Accept PythFactory ownership from Timelock
  `)
}

export default func
func.tags = ['v2_1_Migration']
