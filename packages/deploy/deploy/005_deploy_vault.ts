import { BigNumber, constants } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  VaultFactory__factory,
  ProxyAdmin__factory,
  MarketFactory__factory,
  OracleFactory__factory,
  IERC20__factory,
  Vault__factory,
} from '../types/generated'
import { ORACLE_IDS } from './003_deploy_oracle'
import { forkNetwork, isFork, isMainnet, isTestnet } from '../../common/testutil/network'
import { getLabsMultisig } from '../../common/testutil/constants'

const VAULTS: { [key: string]: { [key: string]: string[][] } } = {
  arbitrum: {
    AsterVault: [
      [ORACLE_IDS.arbitrum.eth, ''], // ETH / None
      [ORACLE_IDS.arbitrum.btc, ''], // BTC / None
    ],
    BegoniaVault: [
      [ORACLE_IDS.arbitrum.sol, ''], // SOL / None
      [ORACLE_IDS.arbitrum.matic, ''], // MATIC / None
    ],
  },
  arbitrumGoerli: {
    AsterVault: [
      [ORACLE_IDS.arbitrumGoerli.eth, ''], // ETH / None
      [ORACLE_IDS.arbitrumGoerli.btc, ''], // BTC / None
    ],
    BegoniaVault: [
      [ORACLE_IDS.arbitrumGoerli.sol, ''], // SOL / None
      [ORACLE_IDS.arbitrumGoerli.matic, ''], // MATIC / None
    ],
  },
  arbitrumSepolia: {
    AsterVault: [[ORACLE_IDS.arbitrumSepolia.eth, '']], // ETH / None
    BegoniaVault: [[ORACLE_IDS.arbitrumSepolia.eth, '']], // ETH / None
  },
  base: {
    AsterVault: [
      [ORACLE_IDS.base.eth, ''], // ETH / None
      [ORACLE_IDS.base.btc, ''], // BTC / None
    ],
  },
}

export const INITIAL_AMOUNT = BigNumber.from('5000000') // 5 DSU

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, save, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const labsMultisig = getLabsMultisig(getNetworkName())
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)
  const deployVaults = false

  const dsu = IERC20__factory.connect((await get('DSU')).address, deployerSigner)
  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementations
  const vaultImpl = await deploy('VaultImpl', {
    contract: 'Vault',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('VaultFactoryImpl', {
    contract: 'VaultFactory',
    args: [(await get('MarketFactory')).address, vaultImpl.address, INITIAL_AMOUNT],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Factory
  const vaultFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('VaultFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('VaultFactoryImpl')).address,
      proxyAdmin.address,
      vaultFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const vaultFactory = new VaultFactory__factory(deployerSigner).attach((await get('VaultFactory')).address)
  const marketFactory = new MarketFactory__factory(deployerSigner).attach((await get('MarketFactory')).address)
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  if ((await vaultFactory.pauser()) === constants.AddressZero && !!labsMultisig) {
    process.stdout.write('Updating protocol pauser...')
    await vaultFactory.updatePauser(labsMultisig)
    process.stdout.write('complete\n')
  }

  // Create vault
  // TODO: in order to deploy vaults we need to commit new oracle versions first
  if (deployVaults) {
    const vaults = isFork() ? VAULTS[forkNetwork()] : VAULTS[getNetworkName()]
    if ((await getOrNull('AsterVault')) == null && vaults.AsterVault) {
      const markets = vaults.AsterVault
      console.log('Creating Aster vault...')
      process.stdout.write('Setting initial amount approval...')
      await (await dsu.approve(vaultFactory.address, INITIAL_AMOUNT.mul(2).mul(1e12))).wait()
      process.stdout.write('done.\n')
      const oracleAddress0 = await oracleFactory.oracles(markets[0][0])
      const payoffAddress0 = markets[0][1] === '' ? ethers.constants.AddressZero : (await get(markets[0][1])).address
      const initialMarket0 = await marketFactory.markets(oracleAddress0, payoffAddress0)
      const name = 'Aster'

      const vaultAddress = await vaultFactory.callStatic.create(dsu.address, initialMarket0, name)
      const receipt = await (await vaultFactory.create(dsu.address, initialMarket0, name)).wait()
      await save('AsterVault', {
        ...(await get('VaultImpl')),
        address: vaultAddress,
        receipt,
      })

      // TODO: configure vault once market parameters are set
      // cap: $5M

      process.stdout.write('configuring...')
      const vault = new Vault__factory(deployerSigner).attach(vaultAddress)
      const oracleAddress1 = await oracleFactory.oracles(markets[1][0])
      const payoffAddress1 = markets[1][1] === '' ? ethers.constants.AddressZero : (await get(markets[1][1])).address
      const initialMarket1 = await marketFactory.markets(oracleAddress1, payoffAddress1)
      await vault.register(initialMarket1)
      await vault.updateMarket(0, ethers.utils.parseUnits('0.5', 6), ethers.utils.parseUnits('1', 6))
      await vault.updateMarket(1, ethers.utils.parseUnits('0.5', 6), ethers.utils.parseUnits('1', 6))

      console.log('Aster Vault created')
    }

    if ((await getOrNull('BegoniaVault')) == null && vaults.BegoniaVault) {
      const markets = vaults.BegoniaVault
      console.log('Creating Begonia Vault...')
      process.stdout.write('Setting initial amount approval...')
      await (await dsu.approve(vaultFactory.address, INITIAL_AMOUNT.mul(2).mul(1e12))).wait()
      process.stdout.write('done.\n')
      const oracleAddress0 = await oracleFactory.oracles(markets[0][0])
      const payoffAddress0 = markets[0][1] === '' ? ethers.constants.AddressZero : (await get(markets[0][1])).address
      const initialMarket0 = await marketFactory.markets(oracleAddress0, payoffAddress0)
      const name = 'Begonia'

      const vaultAddress = await vaultFactory.callStatic.create(dsu.address, initialMarket0, name)
      const receipt = await (await vaultFactory.create(dsu.address, initialMarket0, name)).wait()
      await save('BegoniaVault', {
        ...(await get('VaultImpl')),
        address: vaultAddress,
        receipt,
      })

      // TODO: configure vault once market parameters are set
      // cap: $2M

      // process.stdout.write('configuring...')
      const vault = new Vault__factory(deployerSigner).attach(vaultAddress)
      const oracleAddress1 = await oracleFactory.oracles(markets[1][0])
      const payoffAddress1 = markets[1][1] === '' ? ethers.constants.AddressZero : (await get(markets[1][1])).address
      const initialMarket1 = await marketFactory.markets(oracleAddress1, payoffAddress1)
      await vault.register(initialMarket1)
      await vault.updateMarket(0, ethers.utils.parseUnits('0.5', 6), ethers.utils.parseUnits('1', 6))
      await vault.updateMarket(1, ethers.utils.parseUnits('0.5', 6), ethers.utils.parseUnits('1', 6))

      console.log('Begonia Vault created')
    }
  }

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await vaultFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await vaultFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Vault']
