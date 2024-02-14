import { utils } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { forkNetwork, isFork, isMainnet } from '../../common/testutil/network'
import { MetaQuantsFactory__factory, OracleFactory__factory, ProxyAdmin__factory } from '../types/generated'

export const ORACLE_IDS: { [key: string]: { [asset: string]: string } } = {
  arbitrumSepolia: {
    bayc: '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d', // MetaQuants: BAYC
    milady: '0x0000000000000000000000005af0d9827e0c53e4799bb226655a1de152a425a5', // MetaQuants: Milady
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
  const oracleFactoryInterface = OracleFactory__factory.createInterface()
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
  await deploy('KeeperOracleImpl', {
    contract: 'KeeperOracle',
    args: [60],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('MetaQuantsFactoryImpl', {
    contract: 'MetaQuantsFactory',
    args: [
      '0xE744e2422c2497b1bb7e921a903fd457A2bA1F5F',
      (await get('KeeperOracleImpl')).address,
      4,
      12,
      {
        multiplierBase: ethers.utils.parseEther('1'),
        bufferBase: 100_000,
        multiplierCalldata: 0,
        bufferCalldata: 0,
      },
      {
        multiplierBase: ethers.utils.parseEther('1'),
        bufferBase: 100_000,
        multiplierCalldata: 0,
        bufferCalldata: 0,
      },
      100_000,
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Pyth Factory
  const metaQuantsFactoryInterface = MetaQuantsFactory__factory.createInterface()
  await deploy('MetaQuantsFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('MetaQuantsFactoryImpl')).address,
      proxyAdmin.address,
      metaQuantsFactoryInterface.encodeFunctionData('initialize', [
        (await get('OracleFactory')).address,
        (await get('ChainlinkETHUSDFeed')).address,
        (await get('DSU')).address,
      ]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const metaQuantsFactory = new MetaQuantsFactory__factory(deployerSigner).attach(
    (await get('MetaQuantsFactory')).address,
  )

  // Register Pyth Factory
  if (!(await oracleFactory.factories(metaQuantsFactory.address))) {
    process.stdout.write('Registering pyth factory with oracle factory...')
    await (await oracleFactory.register(metaQuantsFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Authorize Oracle Factory
  if (!(await metaQuantsFactory.callers(oracleFactory.address))) {
    process.stdout.write('Authorizing oracle factory to call pyth factory...')
    await (await metaQuantsFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles
  const oracleIDs = isFork() ? ORACLE_IDS[forkNetwork()] : ORACLE_IDS[getNetworkName()]
  if (!oracleIDs) throw new Error('No oracle IDs for network')
  for (const id of Object.values(oracleIDs)) {
    if ((await metaQuantsFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating pyth oracle ${id}...`)
      const address = await metaQuantsFactory.callStatic.create(id, id, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })
      process.stdout.write(`deploying at ${address}...`)
      await (
        await metaQuantsFactory.create(id, id, {
          provider: ethers.constants.AddressZero,
          decimals: 0,
        })
      ).wait()
      process.stdout.write('complete\n')
    }
    if ((await oracleFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating oracle ${id}...`)
      const address = await oracleFactory.callStatic.create(id, metaQuantsFactory.address)
      process.stdout.write(`deploying at ${address}...`)
      await (await oracleFactory.create(id, metaQuantsFactory.address)).wait()
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
  if ((await metaQuantsFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await metaQuantsFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update max claim
  if ((await oracleFactory.maxClaim()).eq(0)) {
    process.stdout.write('Setting max claim amount...')
    await (await oracleFactory.updateMaxClaim(DEFAULT_MAX_CLAIM_AMOUNT)).wait()
    process.stdout.write('complete\n')
  }

  // Update granularity
  if ((await metaQuantsFactory.granularity()).effectiveAfter.eq(0)) {
    process.stdout.write('Setting granularity...')
    await (await metaQuantsFactory.updateGranularity(DEFAULT_GRANULARITY)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['MetaQuantsOracle']
