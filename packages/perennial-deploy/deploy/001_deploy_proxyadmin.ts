import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { PythFactory__factory } from '@equilibria/perennial-v2-oracle/types/generated'
import { ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Deploy ProxyAdmin
  await deploy('ProxyAdmin', {
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Transfer ownership
  if ((await proxyAdmin.owner()).toLowerCase() !== (await get('TimelockController')).address.toLowerCase()) {
    process.stdout.write('Setting owner to timelock...')
    await proxyAdmin.transferOwnership((await get('TimelockController')).address)
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['ProxyAdmin']
