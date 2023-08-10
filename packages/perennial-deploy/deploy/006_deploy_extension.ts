import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementation
  await deploy('MultiInvokerImpl', {
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

  // Deploy MultiInvoker
  const multiInvokerInterface = new ethers.utils.Interface(['function initialize(address)'])
  await deploy('MultiInvoker', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('MultiInvokerImpl')).address,
      proxyAdmin.address,
      multiInvokerInterface.encodeFunctionData('initialize', [(await get('ChainlinkETHUSDFeed')).address]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // TODO approve markets
}

export default func
func.tags = ['Extension']
