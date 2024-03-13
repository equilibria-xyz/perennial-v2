import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { forkNetwork, isFork, isMainnet } from '../../common/testutil/network'
import { ChainlinkFactory__factory, OracleFactory__factory, ProxyAdmin__factory } from '../types/generated'

export const ORACLE_IDS: { [key: string]: { [asset: string]: string } } = {
  arbitrumSepolia: {
    btc: '0x00020ffa644e6c585a5bec0e25ca476b9538198259e22b6240957720dcba0e14', // Chainlink: BTC
    eth: '0x00027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b', // Chainlink: ETH
  },
}

const DEFAULT_GRANULARITY = 10

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)
  await deploy('ChainlinkFactoryImpl', {
    contract: 'ChainlinkFactory',
    args: [
      '0x2ff010debc1297f19579b4246cad07bd24f2488a',
      '0x226d04b3a60bee1c2d522f63a87340220b8f9d6b',
      '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
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
  const chainlinkFactoryInterface = ChainlinkFactory__factory.createInterface()
  await deploy('ChainlinkFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('ChainlinkFactoryImpl')).address,
      proxyAdmin.address,
      chainlinkFactoryInterface.encodeFunctionData('initialize', [
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
  const chainlinkFactory = new ChainlinkFactory__factory(deployerSigner).attach((await get('ChainlinkFactory')).address)

  // Register Pyth Factory
  if (!(await oracleFactory.factories(chainlinkFactory.address))) {
    process.stdout.write('Registering pyth factory with oracle factory...')
    await (await oracleFactory.register(chainlinkFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Authorize Oracle Factory
  if (!(await chainlinkFactory.callers(oracleFactory.address))) {
    process.stdout.write('Authorizing oracle factory to call pyth factory...')
    await (await chainlinkFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles
  const oracleIDs = isFork() ? ORACLE_IDS[forkNetwork()] : ORACLE_IDS[getNetworkName()]
  if (!oracleIDs) throw new Error('No oracle IDs for network')
  for (const id of Object.values(oracleIDs)) {
    if ((await chainlinkFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating pyth oracle ${id}...`)
      const address = await chainlinkFactory.callStatic.create(id, id, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })
      process.stdout.write(`deploying at ${address}...`)
      await (
        await chainlinkFactory.create(id, id, {
          provider: ethers.constants.AddressZero,
          decimals: 0,
        })
      ).wait()
      process.stdout.write('complete\n')
    }
    if ((await oracleFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating oracle ${id}...`)
      const address = await oracleFactory.callStatic.create(id, chainlinkFactory.address)
      process.stdout.write(`deploying at ${address}...`)
      await (await oracleFactory.create(id, chainlinkFactory.address)).wait()
      process.stdout.write('complete\n')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  if ((await chainlinkFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await chainlinkFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update granularity
  if ((await chainlinkFactory.granularity()).effectiveAfter.eq(0)) {
    process.stdout.write('Setting granularity...')
    await (await chainlinkFactory.updateGranularity(DEFAULT_GRANULARITY)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['ChainlinkOracle']
