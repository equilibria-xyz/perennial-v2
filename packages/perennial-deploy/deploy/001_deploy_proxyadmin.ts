import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isMainnet, isTestnet } from '../../common/testutil/network'
import { getMultisigAddress } from '../../common/testutil/constants'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const TIMELOCK_MIN_DELAY = isTestnet(getNetworkName()) ? 60 : 60 // 60s

  if (isMainnet(getNetworkName())) {
    const multisigAddress = getMultisigAddress(getNetworkName())
    await deploy('TimelockController', {
      from: deployer,
      args: [TIMELOCK_MIN_DELAY, [multisigAddress], [ethers.constants.AddressZero], ethers.constants.AddressZero],
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }

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
