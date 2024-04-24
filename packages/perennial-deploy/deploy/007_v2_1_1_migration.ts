import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isArbitrum, isMainnet } from '../../common/testutil/network'

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

  // TODO: Execute the settle-markets task

  console.log(`
    Step 0 of migration complete! Next Steps:
  `)
}

export default func
func.tags = ['v2_1_Migration']
