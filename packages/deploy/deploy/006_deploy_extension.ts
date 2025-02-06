import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import {
  Account__factory,
  AccountVerifier__factory,
  Controller_Arbitrum__factory,
  IERC20__factory,
  Manager__factory,
  Manager_Arbitrum__factory,
  MarketFactory__factory,
  MultiInvoker__factory,
  OrderVerifier__factory,
  ProxyAdmin__factory,
  VaultFactory__factory,
} from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, utils } from 'ethers'
import { isArbitrum } from '../../common/testutil/network'
import { L1_GAS_BUFFERS } from './003_deploy_oracle'
import { TransparentUpgradeableProxyArgs } from './999_v2.3_migration'

const SkipIfAlreadyDeployed = true
const log = (...args: unknown[]) => console.log('[Extension]', ...args)
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
  const multiInvokerArgs: Parameters<MultiInvoker__factory['deploy']> = [
    (await get('USDC')).address,
    (await get('DSU')).address,
    (await get('MarketFactory')).address,
    (await get('VaultFactory')).address,
    (await getOrNull('DSUBatcher'))?.address ?? ethers.constants.AddressZero,
    (await get('DSUReserve')).address,
    1_500_000, // Full Order Commit uses about 1.5M gas
    commitBuffer,
  ]
  await deploy('MultiInvokerImpl', {
    contract: multiInvokerContract,
    args: multiInvokerArgs,
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
  return

  await deployTriggerOrders(hre)
  await deployCollateralAccounts(hre)
}

async function deployTriggerOrders(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const proxyAdmin = new ProxyAdmin__factory(await ethers.getSigner(deployer)).attach((await get('ProxyAdmin')).address)

  log('Deploying Trigger Orders...')
  log('  Deploying Verifier Impl...')
  const orderVerifierArgs: Parameters<OrderVerifier__factory['deploy']> = [(await get('MarketFactory')).address]
  await deploy('OrderVerifierImpl', {
    contract: 'OrderVerifier',
    from: deployer,
    args: orderVerifierArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Verifier Proxy...')
  const orderVerifierProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('OrderVerifierImpl')).address,
    proxyAdmin.address,
    '0x',
  ]
  await deploy('OrderVerifier', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: orderVerifierProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('  Deploying Manager Impl...')
  // TODO: Add Optimism once impl is ready
  const managerContract = isArbitrum(getNetworkName()) ? 'Manager_Arbitrum' : 'Manager_Optimism'
  const managerArgs: Parameters<Manager_Arbitrum__factory['deploy']> = [
    (await get('USDC')).address,
    (await get('DSU')).address,
    (await get('DSUReserve')).address,
    (await get('MarketFactory')).address,
    (await get('OrderVerifier')).address,
  ]
  await deploy('ManagerImpl', {
    contract: managerContract,
    from: deployer,
    args: managerArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Manager Proxy...')
  const managerProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('ManagerImpl')).address,
    proxyAdmin.address,
    Manager__factory.createInterface().encodeFunctionData('initialize', [
      (await get('ChainlinkETHUSDFeed')).address,
      {
        // Unbuffered Keep Config (relayed messages), requires price commitment
        multiplierBase: ethers.utils.parseEther('1.05'),
        bufferBase: 788_000n, // buffer for withdrawing keeper fee from market
        multiplierCalldata: 0n,
        bufferCalldata: 35_200n,
      },
      {
        // Buffered Keep Config (market transfers, rebalances)
        multiplierBase: ethers.utils.parseEther('1.05'),
        bufferBase: 788_000n, // for price commitment
        multiplierCalldata: ethers.utils.parseEther('1.05'),
        bufferCalldata: 35_200n,
      },
    ]),
  ]
  await deploy('Manager', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: managerProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })

  log('Done deploying Trigger Orders...')
}

async function deployCollateralAccounts(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const proxyAdmin = new ProxyAdmin__factory(await ethers.getSigner(deployer)).attach((await get('ProxyAdmin')).address)

  log('Deploying Collateral Accounts...')
  log('  Deploying Account Impl...')
  const accountArgs: Parameters<Account__factory['deploy']> = [
    (await get('USDC')).address,
    (await get('DSU')).address,
    (await get('DSUReserve')).address,
  ]
  await deploy('AccountImpl', {
    contract: 'Account',
    from: deployer,
    args: accountArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Account Verifier Impl...')
  const accountVerifierArgs: Parameters<AccountVerifier__factory['deploy']> = [(await get('MarketFactory')).address]
  await deploy('AccountVerifierImpl', {
    contract: 'AccountVerifier',
    from: deployer,
    args: accountVerifierArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Account Verifier Proxy...')
  const accountVerifierProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('AccountVerifierImpl')).address,
    proxyAdmin.address,
    '0x',
  ]
  await deploy('AccountVerifier', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: accountVerifierProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Controller Impl...')
  // TODO: Add Optimism once impl is ready
  const controllerContract = isArbitrum(getNetworkName()) ? 'Controller_Arbitrum' : 'Controller_Optimism'
  const controllerArgs: Parameters<Controller_Arbitrum__factory['deploy']> = [
    (await get('AccountImpl')).address,
    (await get('MarketFactory')).address,
    (await get('Verifier')).address,
  ]
  await deploy('ControllerImpl', {
    contract: controllerContract,
    from: deployer,
    args: controllerArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('  Deploying Controller Proxy...')
  const controllerProxyArgs: TransparentUpgradeableProxyArgs = [
    (await get('ControllerImpl')).address,
    proxyAdmin.address,
    Controller_Arbitrum__factory.createInterface().encodeFunctionData(
      'initialize(address,address,(uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256))',
      [
        (await get('AccountVerifier')).address,
        (await get('ChainlinkETHUSDFeed')).address,
        {
          // Unbuffered Keep Config (relayed messages)
          multiplierBase: ethers.utils.parseEther('1.05'),
          bufferBase: 275_000n, // buffer for handling the keeper fee
          multiplierCalldata: ethers.utils.parseEther('1.05'),
          bufferCalldata: 0n,
        },
        {
          // Buffered Keep Config (market transfers, rebalances)
          multiplierBase: ethers.utils.parseEther('1.08'),
          bufferBase: 788_000n, // for price commitment
          multiplierCalldata: ethers.utils.parseEther('1.08'),
          bufferCalldata: 35_200n,
        },
        {
          // Withdrawal keep config
          multiplierBase: ethers.utils.parseEther('0'), // Unused
          bufferBase: 300_000n,
          multiplierCalldata: ethers.utils.parseEther('1.05'),
          bufferCalldata: 0n,
        },
      ],
    ),
  ]
  await deploy('Controller', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer,
    args: controllerProxyArgs,
    skipIfAlreadyDeployed: SkipIfAlreadyDeployed,
    log: true,
    autoMine: true,
  })
  log('Done deploying Collateral Accounts...')
}

export default func
func.tags = ['Extension']
