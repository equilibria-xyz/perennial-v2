import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isArbitrum, isMainnet } from '../../common/testutil/network'
import { DEFAULT_KEEPER_ORACLE_TIMEOUT, L1_GAS_BUFFERS } from './003_deploy_oracle'
import { INITIAL_AMOUNT } from './005_deploy_vault'

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

  console.log('Deploying v2.1.1 migration...')

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

  // Deploy new Vault impl
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

  // Deploy New KeeperOracle impl
  await deploy('KeeperOracleImpl', {
    contract: 'KeeperOracle',
    args: [DEFAULT_KEEPER_ORACLE_TIMEOUT],
    from: deployer,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  const commitBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata
    : L1_GAS_BUFFERS.base.commitCalldata
  const incrementalBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitIncrement

  // Deploy new PythFactory impl - pulled from 003_deploy_oracle.ts
  const pythFactoryContract = isArbitrum(getNetworkName()) ? 'PythFactory_Arbitrum' : 'PythFactory_Optimism'
  await deploy('PythFactoryImpl', {
    contract: pythFactoryContract,
    args: [
      (await get('Pyth')).address,
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
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  console.log(`
    Step 0 of v2.1.1 migration complete! Next Steps:
      1. Upgrade the MarketFactory to new Impl
      2. Upgrade the VaultFactory to new Impl
      3. Upgrade the PythFactory to new Impl
  `)
}

export default func
func.tags = ['v2_1_1_Migration']
