import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

export const PAYOFFS = ['PowerHalf', 'PowerTwo', 'Inverse']

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  // Deploy and register payoffs
  for (const payoffName of PAYOFFS) {
    await deploy(payoffName, {
      contract: payoffName,
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }
}

export default func
func.tags = ['Payoff']
