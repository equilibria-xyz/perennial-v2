import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import {
  IERC20__factory,
  MarketFactory__factory,
  MultiInvoker__factory,
  ProxyAdmin__factory,
  VaultFactory__factory,
} from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, utils } from 'ethers'
import { isArbitrum } from '../../common/testutil/network'
import { L1_GAS_BUFFERS } from './003_deploy_oracle'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementation
  const multiInvokerContract = isArbitrum(getNetworkName()) ? 'MultiInvoker_Arbitrum' : 'MultiInvoker_Optimism'

  const commitBuffer = isArbitrum(getNetworkName())
    ? L1_GAS_BUFFERS.arbitrum.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
    : L1_GAS_BUFFERS.base.commitCalldata + L1_GAS_BUFFERS.arbitrum.commitIncrement
  await deploy('MultiInvokerImpl', {
    contract: multiInvokerContract,
    args: [
      (await get('USDC')).address,
      (await get('DSU')).address,
      (await get('MarketFactory')).address,
      (await get('VaultFactory')).address,
      (await getOrNull('DSUBatcher'))?.address ?? ethers.constants.AddressZero,
      (await get('DSUReserve')).address,
      1_500_000, // Full Order Commit uses about 1.5M gas
      commitBuffer,
    ],
    from: deployer,
    skipIfAlreadyDeployed: false,
    log: true,
    autoMine: true,
  })

  // Deploy MultiInvoker
  const multiInvokerInterface = MultiInvoker__factory.createInterface()
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

  // Approve Markets and Vaults
  const multiInvoker = MultiInvoker__factory.connect((await get('MultiInvoker')).address, deployerSigner)
  const DSU = IERC20__factory.connect((await get('DSU')).address, deployerSigner)
  const marketFactory = new MarketFactory__factory(deployerSigner).attach((await get('MarketFactory')).address)
  const vaultFactory = new VaultFactory__factory(deployerSigner).attach((await get('VaultFactory')).address)
  const markets = await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered())
  const vaults = await vaultFactory.queryFilter(vaultFactory.filters.InstanceRegistered())
  const approvalTargets = [...markets, ...vaults].map(e => e.args.instance)
  const approvalActions_ = await Promise.all(
    approvalTargets.map(async target => {
      const allowance = await DSU.callStatic.allowance(multiInvoker.address, target)
      if (allowance === constants.MaxUint256) return null
      return {
        action: 8,
        args: utils.defaultAbiCoder.encode(['address'], [target]),
      }
    }),
  )
  const approvalActions = approvalActions_.filter(e => e !== null) as { action: number; args: string }[]
  if (approvalActions.length > 0) {
    process.stdout.write('Approving targets...')
    await (await multiInvoker['invoke((uint8,bytes)[])'](approvalActions)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Extension']
