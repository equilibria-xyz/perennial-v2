import { constants } from 'ethers'
import { HardhatRuntimeEnvironment, Libraries } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Market__factory, MarketFactory__factory, ProxyAdmin__factory, Verifier__factory } from '../types/generated'
import { isMainnet } from '../../common/testutil/network'
import { getLabsMultisig } from '../../common/testutil/constants'
import { DEFAULT_PROTOCOL_PARAMETER } from '../util/constants'

// enumerates libraries required for deployment of Market implementation contract
export const MARKET_LIBRARIES: Array<{
  name: string // as named in linkReferences of ABI
  contract: string | undefined // only needed to disambiguate name clashes
}> = [
  {
    name: 'CheckpointLib',
    contract: '@perennial/v2-core/contracts/libs/CheckpointLib.sol:CheckpointLib',
  },
  { name: 'InvariantLib', contract: undefined },
  { name: 'VersionLib', contract: undefined },
  {
    name: 'CheckpointStorageLib',
    contract: '@perennial/v2-core/contracts/types/Checkpoint.sol:CheckpointStorageLib',
  },
  { name: 'GlobalStorageLib', contract: undefined },
  { name: 'MarketParameterStorageLib', contract: undefined },
  { name: 'PositionStorageGlobalLib', contract: undefined },
  { name: 'PositionStorageLocalLib', contract: undefined },
  { name: 'RiskParameterStorageLib', contract: undefined },
  { name: 'VersionStorageLib', contract: undefined },
  { name: 'MagicValueLib', contract: undefined },
  { name: 'GuaranteeStorageGlobalLib', contract: undefined },
  { name: 'GuaranteeStorageLocalLib', contract: undefined },
  { name: 'OrderStorageLocalLib', contract: undefined },
  { name: 'OrderStorageGlobalLib', contract: undefined },
]

const SkipIfAlreadyDeployed = false
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const labsMultisig = getLabsMultisig(getNetworkName())
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Libraries
  for (const library of MARKET_LIBRARIES) {
    await deploy(library.name, {
      contract: library.contract,
      from: deployer,
      skipIfAlreadyDeployed: false, // Always deploy libraries
      log: true,
      autoMine: true,
    })
  }

  const marketLibrariesBuilt: Libraries = {}
  for (const library of MARKET_LIBRARIES) {
    marketLibrariesBuilt[library.name] = (await get(library.name)).address
  }

  // Deploy Implementations
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

  // Deploy Factory
  const marketFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('MarketFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('MarketFactoryImpl')).address,
      proxyAdmin.address,
      marketFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const marketFactory = new MarketFactory__factory(deployerSigner).attach((await get('MarketFactory')).address)

  // Initialize the verifier with the market factory address
  console.log('Initializing verifier...')
  const verifier = new Verifier__factory(deployerSigner).attach((await get('Verifier')).address)
  if ((await verifier.marketFactory()).toLowerCase() !== (await get('MarketFactory')).address.toLowerCase()) {
    await verifier.initialize((await get('MarketFactory')).address)
  }

  if ((await marketFactory.parameter()).maxFee.eq(0)) {
    process.stdout.write('Updating protocol parameter...')
    await marketFactory.updateParameter(DEFAULT_PROTOCOL_PARAMETER)
    process.stdout.write('complete\n')
  }

  if ((await marketFactory.pauser()) === constants.AddressZero && !!labsMultisig) {
    process.stdout.write('Updating protocol pauser...')
    await marketFactory.updatePauser(labsMultisig)
    process.stdout.write('complete\n')
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await marketFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await marketFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Market']
