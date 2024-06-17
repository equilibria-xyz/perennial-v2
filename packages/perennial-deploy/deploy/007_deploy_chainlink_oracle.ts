import { BigNumber } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { forkNetwork, isArbitrum, isFork, isMainnet } from '../../common/testutil/network'
import {
  OracleFactory__factory,
  ProxyAdmin__factory,
  ChainlinkFactory__factory,
  IKeeperFactory,
} from '../types/generated'
import { PAYOFFS } from './002_deploy_payoff'

interface OracleDefinition {
  oracleId: string
  underlyingId: string
  payoffProviderName: string
  payoffDecimals: BigNumber
}

// used by this script to configure oracles
const CHAINLINK_ORACLES: { [key: string]: { [asset: string]: OracleDefinition } } = {
  arbitrum: {
    // TODO: determine current payoff providers for each market
  },
  arbitrumSepolia: {
    btc: {
      oracleId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
      underlyingId: '0x00020ffa644e6c585a5bec0e25ca476b9538198259e22b6240957720dcba0e14',
      payoffProviderName: '',
      payoffDecimals: BigNumber.from(0),
    },
  },
  base: {
    // TODO: determine current payoff providers for each market
  },
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // creates a PayoffDefinition struct by looking up the name from deployments
  async function getPayoff(name: string, decimals: BigNumber): Promise<IKeeperFactory.PayoffDefinitionStruct> {
    if (name) return { provider: (await get(name)).address, decimals: decimals }
    else return { provider: ethers.constants.AddressZero, decimals: 0 }
  }

  // Deploy Chainlink Factory
  const chainlinkFactoryContract = isArbitrum(getNetworkName())
    ? 'ChainlinkFactory_Arbitrum'
    : 'ChainlinkFactory_Optimism'
  const chainlinkCommitBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata
    : L1_GAS_BUFFERS.base.commitCalldata
  const chainlinkIncrementalBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitIncrement
  await deploy('ChainlinkFactoryImpl', {
    contract: chainlinkFactoryContract,
    args: [
      (await get('ChainlinkVerifierProxy')).address,
      (await get('ChainlinkFeeManager')).address,
      (await get('WETH')).address,
      (await get('KeeperOracleImpl')).address,
      4,
      12,
      {
        multiplierBase: 0, // Unused
        bufferBase: 788_000, // Each Call uses approx 750k gas
        multiplierCalldata: 0,
        bufferCalldata: chainlinkCommitBuffer,
      },
      {
        multiplierBase: ethers.utils.parseEther('1.05'), // Gas usage tracks full call
        bufferBase: 100_000, // Initial Fee + Transfers
        multiplierCalldata: ethers.utils.parseEther('1.05'), // Gas usage tracks full L1 calldata,
        bufferCalldata: 0,
      },
      chainlinkIncrementalBuffer,
    ],
    from: deployer,
    skipIfAlreadyDeployed: false,
    log: true,
    autoMine: true,
  })
  return

  // Deploy Chainlink Factory
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

  // Register Chainlink Factory
  if (!(await oracleFactory.factories(chainlinkFactory.address))) {
    process.stdout.write('Registering chainlink factory with oracle factory...')
    await (await oracleFactory.register(chainlinkFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Authorize Oracle Factory
  if (!(await chainlinkFactory.callers(oracleFactory.address))) {
    process.stdout.write('Authorizing oracle factory to call chainlink factory...')
    await (await chainlinkFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Register payoff providers
  for (const payoffName of PAYOFFS) {
    process.stdout.write(`Registering payoff provider ${payoffName}...`)
    const payoffProvider = await get(payoffName)
    await (await chainlinkFactory.register(payoffProvider.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles
  const oracles = isFork() ? CHAINLINK_ORACLES[forkNetwork()] : CHAINLINK_ORACLES[getNetworkName()]
  if (!oracles) throw new Error('No oracle IDs for network')
  for (const oracle of Object.values(oracles)) {
    if (
      (await chainlinkFactory.oracles(oracle.oracleId)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()
    ) {
      process.stdout.write(`Creating chainlink oracle ${oracle.oracleId}...`)
      const payoff: IKeeperFactory.PayoffDefinitionStruct = await getPayoff(
        oracle.payoffProviderName,
        oracle.payoffDecimals,
      )
      const address = await chainlinkFactory.callStatic.create(oracle.oracleId, oracle.underlyingId, payoff)
      process.stdout.write(`deploying at ${address}...`)
      await (await chainlinkFactory.create(oracle.oracleId, oracle.underlyingId, payoff)).wait()
      process.stdout.write('complete\n')
    }
    if ((await oracleFactory.oracles(oracle.oracleId)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating oracle ${oracle.oracleId}...`)
      const address = await oracleFactory.callStatic.create(oracle.oracleId, chainlinkFactory.address)
      process.stdout.write(`deploying at ${address}...`)
      await (await oracleFactory.create(oracle.oracleId, chainlinkFactory.address)).wait()
      process.stdout.write('complete\n')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
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
