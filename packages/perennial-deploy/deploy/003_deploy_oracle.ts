import { utils } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { forkNetwork, isArbitrum, isFork, isMainnet } from '../../common/testutil/network'
import { OracleFactory__factory, ProxyAdmin__factory, PythFactory__factory } from '../types/generated'

export const ORACLE_IDS: { [key: string]: { [asset: string]: string } } = {
  arbitrum: {
    eth: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // Pyth: ETH
    btc: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // Pyth: BTC
    sol: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', // Pyth: SOL
    matic: '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52', // Pyth: MATIC
  },
  arbitrumGoerli: {
    eth: '0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6', // Pyth: ETH
    btc: '0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b', // Pyth: BTC
    sol: '0xfe650f0367d4a7ef9815a593ea15d36593f0643aaaf0149bb04be67ab851decd', // Pyth: SOL
    matic: '0xd2c2c1f2bba8e0964f9589e060c2ee97f5e19057267ac3284caef3bd50bd2cb5', // Pyth: MATIC
  },
}

const DEFAULT_MAX_CLAIM_AMOUNT = utils.parseUnits('25', 6)
const DEFAULT_GRANULARITY = 10

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
  const pythOracleContract = isArbitrum(getNetworkName()) ? 'PythOracle_Arbitrum' : 'PythOracle_Optimism'
  await deploy('PythOracleImpl', {
    contract: pythOracleContract,
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
  if (!(await oracleFactory.factories(pythFactory.address))) {
    process.stdout.write('Registering pyth factory with oracle factory...')
    await (await oracleFactory.register(pythFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Authorize Oracle Factory
  if (!(await pythFactory.callers(oracleFactory.address))) {
    process.stdout.write('Authorizing oracle factory to call pyth factory...')
    await (await pythFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles
  const oracleIDs = isFork() ? ORACLE_IDS[forkNetwork()] : ORACLE_IDS[getNetworkName()]
  if (!oracleIDs) throw new Error('No oracle IDs for network')
  for (const id of Object.values(oracleIDs)) {
    if ((await pythFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating pyth oracle ${id}...`)
      const address = await pythFactory.callStatic.create(id)
      process.stdout.write(`deploying at ${address}...`)
      await (await pythFactory.create(id)).wait()
      process.stdout.write('complete\n')
    }
    if ((await oracleFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating oracle ${id}...`)
      const address = await oracleFactory.callStatic.create(id, pythFactory.address)
      process.stdout.write(`deploying at ${address}...`)
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

  // Update max claim
  if ((await oracleFactory.maxClaim()).eq(0)) {
    process.stdout.write('Setting max claim amount...')
    await (await oracleFactory.updateMaxClaim(DEFAULT_MAX_CLAIM_AMOUNT)).wait()
    process.stdout.write('complete\n')
  }

  // Update granularity
  if ((await pythFactory.granularity()).effectiveAfter.eq(0)) {
    process.stdout.write('Setting granularity...')
    await (await pythFactory.updateGranularity(DEFAULT_GRANULARITY)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Oracle']
