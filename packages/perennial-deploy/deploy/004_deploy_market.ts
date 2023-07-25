import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MarketFactory__factory, OracleFactory__factory, ProxyAdmin__factory } from '../types/generated'
import { forkNetwork, isFork, isMainnet, isTestnet } from '../../common/testutil/network'
import { ORACLE_IDS } from './003_deploy_oracle'

const MARKETS: { [key: string]: string[][] } = {
  mainnet: [
    [ORACLE_IDS.mainnet.eth, ''], // ETH / None
    [ORACLE_IDS.mainnet.btc, ''], // BTC / None
    [ORACLE_IDS.mainnet.eth, 'MilliPowerTwo'], // ETH / MilliPowerTwo
  ],
  arbitrumGoerli: [
    [ORACLE_IDS.arbitrumGoerli.eth, ''], // ETH / None
    [ORACLE_IDS.arbitrumGoerli.btc, ''], // BTC / None
    [ORACLE_IDS.arbitrumGoerli.eth, 'MilliPowerTwo'], // ETH / MilliPowerTwo
  ],
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)
  const deployMarkets = isTestnet(getNetworkName())

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementations
  const marketImpl = await deploy('MarketImpl', {
    contract: 'Market',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('MarketFactoryImpl', {
    contract: 'MarketFactory',
    args: [(await get('OracleFactory')).address, (await get('PayoffFactory')).address, marketImpl.address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Factory
  const marketFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('MarketFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('MarketFactoryImpl')).address,
      proxyAdmin.address,
      marketFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const marketFactory = new MarketFactory__factory(deployerSigner).attach((await get('MarketFactory')).address)
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // Create markets
  if (deployMarkets) {
    const markets = isFork() ? MARKETS[forkNetwork()] : MARKETS[getNetworkName()]
    console.log('Deploying Markets...')
    for (const marketDefinition of Object.values(markets)) {
      const oracleAddress = await oracleFactory.oracles(marketDefinition[0])
      const payoffAddress =
        marketDefinition[1] === '' ? ethers.constants.AddressZero : (await get(marketDefinition[1])).address

      if (
        (await marketFactory.markets(oracleAddress, payoffAddress)).toLowerCase() ===
        ethers.constants.AddressZero.toLowerCase()
      ) {
        process.stdout.write(`Creating market with oracle ${marketDefinition[0]} and payoff ${marketDefinition[1]}...`)
        await (
          await marketFactory.create({
            token: (await get('DSU')).address,
            oracle: oracleAddress,
            payoff: payoffAddress,
          })
        ).wait()

        // TODO: setup market and risk parameter

        process.stdout.write('complete\n')
      }
    }
  }

  // Authorize markets
  await (await oracleFactory.authorize(marketFactory.address)).wait()

  // If mainnet, use timelock as owner
  const owner = isMainnet(getNetworkName()) ? (await get('TimelockController')).address : deployer
  if (owner === deployer) console.log('[WARNING] Testnet detected, timelock will not be set as owner')

  // Transfer pending ownership
  if ((await marketFactory.owner()).toLowerCase() !== owner.toLowerCase()) {
    process.stdout.write('Setting owner...')
    await (await marketFactory.updatePendingOwner(owner)).wait()
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Market']
