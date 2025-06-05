import { constants } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FeeCoordinator__factory, ProxyAdmin__factory } from '../types/generated'
import { getMultisigAddress, getAirdropAddress } from '../../common/testutil/constants'
import { ChainMarkets } from '@perennial/sdk'

const SkipIfAlreadyDeployed = false
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const protocolMultisig = getMultisigAddress(getNetworkName())
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementations
  // Deploy Fee Splitter Implementation
  const feeSplitterImpl = await deploy('FeeSplitterImpl', {
    contract: 'FeeSplitter',
    from: deployer,
    args: [(await get('DSU')).address, (await get('USDC')).address, (await get('DSUReserve')).address],
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Fee Coordinator Implementation
  const feeCoordinatorImpl = await deploy('FeeCoordinatorImpl', {
    contract: 'FeeCoordinator',
    from: deployer,
    args: [(await get('MarketFactory')).address, feeSplitterImpl.address],
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Fee Coordinator
  const feeCoordinatorInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('FeeCoordinator', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      feeCoordinatorImpl.address,
      proxyAdmin.address,
      feeCoordinatorInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const feeCoordinator = new FeeCoordinator__factory(deployerSigner).attach((await get('FeeCoordinator')).address)

  const airdropContractAddress = getAirdropAddress(getNetworkName())

  if (airdropContractAddress) {
    console.log('Deploying fee splitters...')
    // deploy fee splitters
    console.log('Deploying PerpFun fee splitter...')
    const perpFunFeeSplitter = await feeCoordinator.callStatic.create(airdropContractAddress)
    await feeCoordinator.create(airdropContractAddress)
    console.log('PerpFun fee splitter address:', perpFunFeeSplitter)

    console.log('Deploying Pro App fee splitter...')
    const proAppFeeSplitter = await feeCoordinator.callStatic.create(airdropContractAddress)
    await feeCoordinator.create(airdropContractAddress)
    console.log('Pro App fee splitter address:', proAppFeeSplitter)

    console.log('Deploying Autopilot fee splitter...')
    const autopilotFeeSplitter = await feeCoordinator.callStatic.create(airdropContractAddress)
    await feeCoordinator.create(airdropContractAddress)
    console.log('Autopilot fee splitter address:', autopilotFeeSplitter)

    console.log('Deploying Liquidator fee splitter...')
    const liquidatorFeeSplitter = await feeCoordinator.callStatic.create(airdropContractAddress)
    await feeCoordinator.create(airdropContractAddress)
    console.log('Liquidator fee splitter address:', liquidatorFeeSplitter)
    console.log('Fee splitters deployed successfully')
  }

  if ((await feeCoordinator.pendingOwner()) === constants.AddressZero && !!protocolMultisig) {
    process.stdout.write('Updating fee coordinator pending owner...')
    await feeCoordinator.updatePendingOwner(protocolMultisig)
    process.stdout.write('complete\n')
  }

  const chainId = await getChainId()
  const markets = ChainMarkets[Number(chainId) as keyof typeof ChainMarkets]
  for (const market of Object.entries(markets)) {
    console.log(`Registering market ${market[1]} with FeeCoordinator...`)
    await feeCoordinator.register(market[1])
    console.log(`Market ${market[1]} registered.`)
  }
}

export default func
func.tags = ['FeeCoordinator']
