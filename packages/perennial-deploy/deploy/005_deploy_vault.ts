import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  VaultFactory__factory,
  ProxyAdmin__factory,
  MarketFactory__factory,
  OracleFactory__factory,
} from '../types/generated'
import { ORACLE_IDS } from './003_deploy_oracle'
import { forkNetwork, isFork, isMainnet, isTestnet } from '../../common/testutil/network'

const MARKETS: { [key: string]: string[][] } = {
  mainnet: [
    [ORACLE_IDS.mainnet.eth, ''], // ETH / None
    [ORACLE_IDS.mainnet.btc, ''], // BTC / None
  ],
  arbitrumGoerli: [
    [ORACLE_IDS.arbitrumGoerli.eth, ''], // ETH / None
    [ORACLE_IDS.arbitrumGoerli.btc, ''], // BTC / None
  ],
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, save, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)
  const deployVaults = isTestnet(getNetworkName())

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
    args: [(await get('MarketFactory')).address, vaultImpl.address],
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

  // Create vault
  if (deployVaults) {
    const markets = isFork() ? MARKETS[forkNetwork()] : MARKETS[getNetworkName()]
    if ((await getOrNull('BlueChipVault')) == null) {
      process.stdout.write('Creating Blue Chip vault...')
      const assetAddress = (await get('DSU')).address
      const oracleAddress0 = await oracleFactory.oracles(markets[0][0])
      const payoffAddress0 = markets[0][1] === '' ? ethers.constants.AddressZero : (await get(markets[0][1])).address
      const initialMarket0 = await marketFactory.markets(oracleAddress0, payoffAddress0)
      const name = 'Blue Chip'

      const vaultAddress = await vaultFactory.callStatic.create(assetAddress, initialMarket0, name)
      const receipt = await (await vaultFactory.create(assetAddress, initialMarket0, name)).wait()
      await save('BlueChipVault', {
        ...(await get('VaultImpl')),
        address: vaultAddress,
        receipt,
      })

      // TODO: configure vault once market parameters are set

      // process.stdout.write('configuring...')
      // const vault = new Vault__factory(deployerSigner).attach(vaultAddress)
      // const oracleAddress1 = await oracleFactory.oracles(MARKETS[1][0])
      // const payoffAddress1 = MARKETS[1][1] === '' ? ethers.constants.AddressZero : (await get(MARKETS[1][1])).address
      // const initialMarket1 = await marketFactory.markets(oracleAddress1, payoffAddress1)
      // await vault.register(initialMarket1)
      // await vault.updateMarket(0, 4, ethers.utils.parseUnits('2', 6))
      // await vault.updateMarket(1, 1, ethers.utils.parseUnits('2', 6))

      process.stdout.write('complete\n')
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
