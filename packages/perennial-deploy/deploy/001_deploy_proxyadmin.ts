import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isMainnet } from '../../common/testutil/network'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Deploy ProxyAdmin
  await deploy('ProxyAdmin', {
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Transfer ownership
  if ((await proxyAdmin.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await proxyAdmin.transferOwnership(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['ProxyAdmin']
