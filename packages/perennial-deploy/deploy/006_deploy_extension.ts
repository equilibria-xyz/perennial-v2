import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // Deploy Implementations
  await deploy('MultiInvoker', {
    contract: 'MultiInvoker',
    args: [
      (await get('USDC')).address,
      (await get('DSU')).address,
      (await get('MarketFactory')).address,
      (await get('VaultFactory')).address,
      (await getOrNull('DSUBatcher'))?.address ?? ethers.constants.AddressZero,
      (await get('DSUReserve')).address,
      ethers.utils.parseUnits('1.75', 6),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
}

export default func
func.tags = ['Extension']
