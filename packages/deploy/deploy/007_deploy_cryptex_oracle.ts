import { BigNumber, utils } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { forkNetwork, isArbitrum, isFork, isMainnet } from '../../common/testutil/network'
import {
  OracleFactory__factory,
  ProxyAdmin__factory,
  MetaQuantsFactory__factory,
  IKeeperFactory,
} from '../types/generated'

interface OracleDefinition {
  oracleId: string
  underlyingId: string
  payoffProviderName: string
  payoffDecimals: BigNumber
}

// used by this script to configure oracles
const ORACLES: { [key: string]: { [asset: string]: OracleDefinition } } = {
  arbitrum: {
    meem: {
      oracleId: '0xa217ab749c14596d69a6206c34bda27188dcfaf9d38dfcd9b76a0b348e78be44',
      underlyingId: '0xa217ab749c14596d69a6206c34bda27188dcfaf9d38dfcd9b76a0b348e78be44',
      payoffProviderName: '',
      payoffDecimals: BigNumber.from(0),
    },
  },
}

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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // creates a PayoffDefinition struct by looking up the name from deployments
  async function getPayoff(name: string, decimals: BigNumber): Promise<IKeeperFactory.PayoffDefinitionStruct> {
    if (name) return { provider: (await get(name)).address, decimals: decimals }
    else return { provider: ethers.constants.AddressZero, decimals: 0 }
  }

  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // Deploy Cryptex Implementations
  const cryptexFactoryContract = isArbitrum(getNetworkName())
    ? 'MetaQuantsFactory_Arbitrum'
    : 'MetaQuantsFactory_Optimism'

  const commitBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata
    : L1_GAS_BUFFERS.base.commitCalldata
  const incrementalBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitIncrement
  const signer = isFork() ? SIGNERS[forkNetwork()] : SIGNERS[getNetworkName()]
  if (!signer) throw new Error('No signer for network')

  console.log(`Deploying Cryptex Implementation with signer ${signer}`)
  // Deploy Cryptex Implementation
  await deploy('CryptexFactoryImpl', {
    contract: cryptexFactoryContract,
    args: [
      signer,
      (await get('KeeperOracleImpl')).address,
      4,
      12,
      {
        multiplierBase: 0, // Unused
        bufferBase: 788_000, // Each Call uses approx 750k gas
        multiplierCalldata: 0,
        bufferCalldata: commitBuffer,
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
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Cryptex Factory
  const cryptexFactoryInterface = MetaQuantsFactory__factory.createInterface()
  await deploy('CryptexFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('CryptexFactoryImpl')).address,
      proxyAdmin.address,
      cryptexFactoryInterface.encodeFunctionData('initialize', [
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
  const cryptexFactory = new MetaQuantsFactory__factory(deployerSigner).attach((await get('CryptexFactory')).address)

  // Authorize Oracle Factory
  if (!(await cryptexFactory.callers(oracleFactory.address))) {
    process.stdout.write('Authorizing oracle factory to call cryptex factory...')
    await (await cryptexFactory.authorize(oracleFactory.address)).wait()
    process.stdout.write('complete\n')
  }

  // Create oracles
  const oracles = isFork() ? ORACLES[forkNetwork()] : ORACLES[getNetworkName()]
  if (!oracles) throw new Error('No oracle IDs for network')
  for (const oracle of Object.values(oracles)) {
    if ((await cryptexFactory.oracles(oracle.oracleId)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating cryptex oracle ${oracle.oracleId}...`)
      const payoff: IKeeperFactory.PayoffDefinitionStruct = await getPayoff(
        oracle.payoffProviderName,
        oracle.payoffDecimals,
      )
      const address = await cryptexFactory.callStatic.create(oracle.oracleId, oracle.underlyingId, payoff)
      process.stdout.write(`deploying at ${address}...`)
      await (await cryptexFactory.create(oracle.oracleId, oracle.underlyingId, payoff)).wait()
      process.stdout.write('complete\n')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await cryptexFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await cryptexFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }

  // Update granularity
  if ((await cryptexFactory.granularity()).effectiveAfter.eq(0)) {
    process.stdout.write('Setting granularity...')
    await (await cryptexFactory.updateGranularity(DEFAULT_GRANULARITY)).wait()
    process.stdout.write('complete\n')
  }

  console.log(`Done deploying Factory at ${await cryptexFactory.address}. Next steps:`)
  console.log('1. Accept ownership of the cryptex factory')
  console.log('2. Register the cryptex factory with the oracle factory')
  console.log('3. Create the cryptex oracles in the oracle factory')
}

export default func
func.tags = ['CryptexOracle']
