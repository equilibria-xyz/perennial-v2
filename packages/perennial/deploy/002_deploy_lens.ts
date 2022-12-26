import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Factory, Factory__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // NETWORK CONSTANTS

  const factory: Factory = new Factory__factory(deployerSigner).attach((await get('Factory_Proxy')).address)
  console.log('using Controller at ' + factory.address)

  // LENS
  await deploy('PerennialLens_V01', {
    contract: 'PerennialLens',
    args: [factory.address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
}

export default func
func.tags = ['Lens_V01']
