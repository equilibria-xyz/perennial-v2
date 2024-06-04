import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export const PAYOFFS = ['PowerHalf', 'PowerTwo']

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

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
