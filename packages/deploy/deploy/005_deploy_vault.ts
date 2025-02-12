import { BigNumber, constants } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { VaultFactory__factory, ProxyAdmin__factory } from '../types/generated'
import { isMainnet } from '../../common/testutil/network'
import { getLabsMultisig } from '../../common/testutil/constants'

export const INITIAL_AMOUNT = BigNumber.from('5000000') // 5 DSU

const SkipIfAlreadyDeployed = false
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const labsMultisig = getLabsMultisig(getNetworkName())
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementations
  const vaultImpl = await deploy('MakerVaultImpl', {
    contract: 'MakerVault',
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const solverVaultImpl = await deploy('SolverVaultImpl', {
    contract: 'SolverVault',
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
  await deploy('SolverVaultFactoryImpl', {
    contract: 'VaultFactory',
    args: [(await get('MarketFactory')).address, solverVaultImpl.address, INITIAL_AMOUNT],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  // Deploy Factory
  const vaultFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('VaultFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('VaultFactoryImpl')).address,
      proxyAdmin.address,
      vaultFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const vaultFactory = new VaultFactory__factory(deployerSigner).attach((await get('VaultFactory')).address)

  if ((await vaultFactory.pauser()) === constants.AddressZero && !!labsMultisig) {
    process.stdout.write('Updating protocol pauser...')
    await vaultFactory.updatePauser(labsMultisig)
    process.stdout.write('complete\n')
  }

  const solverVaultFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('SolverVaultFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('SolverVaultFactoryImpl')).address,
      proxyAdmin.address,
      solverVaultFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const solverVaultFactory = new VaultFactory__factory(deployerSigner).attach((await get('SolverVaultFactory')).address)

  if ((await solverVaultFactory.pauser()) === constants.AddressZero && !!labsMultisig) {
    process.stdout.write('Updating protocol pauser...')
    await solverVaultFactory.updatePauser(labsMultisig)
    process.stdout.write('complete\n')
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await vaultFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await vaultFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
  if ((await solverVaultFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await solverVaultFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Vault']
