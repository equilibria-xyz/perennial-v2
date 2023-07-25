import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ProxyAdmin__factory } from '@equilibria/perennial-v2/types/generated'
import { OracleFactory__factory, PythFactory__factory } from '@equilibria/perennial-v2-oracle/types/generated'
import { forkNetwork, isFork, isMainnet } from '../../common/testutil/network'

export const ORACLE_IDS: { [key: string]: { [asset: string]: string } } = {
  mainnet: {
    eth: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
    btc: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
  },
  arbitrumGoerli: {
    eth: '0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6', // ETH
    btc: '0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b', // BTC
  },
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Oracle Implementations
  await deploy('OracleImpl', {
    contract: 'Oracle',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('OracleFactoryImpl', {
    contract: 'OracleFactory',
    args: [(await get('OracleImpl')).address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Oracle Factory
  const oracleFactoryInterface = new ethers.utils.Interface(['function initialize(address)'])
  await deploy('OracleFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('OracleFactoryImpl')).address,
      proxyAdmin.address,
      oracleFactoryInterface.encodeFunctionData('initialize', [(await get('DSU')).address]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // Deploy Pyth Implementations
  await deploy('PythOracleImpl', {
    contract: 'PythOracle',
    args: [(await get('Pyth')).address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('PythFactoryImpl', {
    contract: 'PythFactory',
    args: [
      (await get('PythOracleImpl')).address,
      (await get('ChainlinkETHUSDFeed')).address,
      (await get('DSU')).address,
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Pyth Factory
  const pythFactoryInterface = new ethers.utils.Interface(['function initialize(address)'])
  await deploy('PythFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('PythFactoryImpl')).address,
      proxyAdmin.address,
      pythFactoryInterface.encodeFunctionData('initialize', [(await get('OracleFactory')).address]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const pythFactory = new PythFactory__factory(deployerSigner).attach((await get('PythFactory')).address)

  // Register Pyth Factory
  await (await oracleFactory.register(pythFactory.address)).wait()

  // Authorize Oracle Factory
  await (await pythFactory.authorize(oracleFactory.address)).wait()

  // Create oracles
  const oracleIDs = isFork() ? ORACLE_IDS[forkNetwork()] : ORACLE_IDS[getNetworkName()]
  if (!oracleIDs) throw new Error('No oracle IDs for network')
  for (const id of Object.values(oracleIDs)) {
    if ((await pythFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating pyth oracle ${id}...`)
      await (await pythFactory.create(id)).wait()
      process.stdout.write('complete\n')
    }
    if ((await oracleFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating oracle ${id}...`)
      await (await oracleFactory.create(id, pythFactory.address)).wait()
      process.stdout.write('complete\n')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await oracleFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await oracleFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
  if ((await pythFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await pythFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Oracle']
