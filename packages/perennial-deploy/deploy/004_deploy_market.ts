import { utils, constants } from 'ethers'
import { HardhatRuntimeEnvironment, Libraries } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  MarketFactory__factory,
  Market__factory,
  OracleFactory__factory,
  ProxyAdmin__factory,
} from '../types/generated'
import { forkNetwork, isFork, isMainnet } from '../../common/testutil/network'
import { ORACLE_IDS } from './003_deploy_oracle'
import { getLabsMultisig } from '../../common/testutil/constants'
import { DEFAULT_MARKET_PARAMETER, DEFAULT_PROTOCOL_PARAMETER, DEFAULT_RISK_PARAMETERS } from '../util/constants'

// enumerates libraries required for deployment of Market implementation contract
export const MARKET_LIBRARIES: Array<{
  name: string // as named in linkReferences of ABI
  contract: string | undefined // only needed to disambiguate name clashes
}> = [
  {
    name: 'CheckpointLib',
    contract: '@perennial/v2-core/contracts/libs/CheckpointLib.sol:CheckpointLib',
  },
  { name: 'InvariantLib', contract: undefined },
  { name: 'VersionLib', contract: undefined },
  {
    name: 'CheckpointStorageLib',
    contract: '@perennial/v2-core/contracts/types/Checkpoint.sol:CheckpointStorageLib',
  },
  { name: 'GlobalStorageLib', contract: undefined },
  { name: 'MarketParameterStorageLib', contract: undefined },
  { name: 'PositionStorageGlobalLib', contract: undefined },
  { name: 'PositionStorageLocalLib', contract: undefined },
  { name: 'RiskParameterStorageLib', contract: undefined },
  { name: 'VersionStorageLib', contract: undefined },
  { name: 'MagicValueLib', contract: undefined },
]

const MARKETS: { [key: string]: string[][] } = {
  arbitrum: [
    [ORACLE_IDS.arbitrum.eth, ''], // ETH / None
    [ORACLE_IDS.arbitrum.btc, ''], // BTC / None
    [ORACLE_IDS.arbitrum.sol, ''], // SOL / None
    [ORACLE_IDS.arbitrum.matic, ''], // MATIC / None
  ],
  arbitrumGoerli: [
    [ORACLE_IDS.arbitrumGoerli.eth, ''], // ETH / None
    [ORACLE_IDS.arbitrumGoerli.btc, ''], // BTC / None
    [ORACLE_IDS.arbitrumGoerli.sol, ''], // SOL / None
    [ORACLE_IDS.arbitrumGoerli.matic, ''], // MATIC / None
  ],
  arbitrumSepolia: [[ORACLE_IDS.arbitrumSepolia.eth, '']], // ETH / None
  base: [
    [ORACLE_IDS.base.eth, ''], // ETH / None
    [ORACLE_IDS.base.btc, ''], // BTC / None
  ],
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const labsMultisig = getLabsMultisig(getNetworkName())
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)
  const deployMarkets = true

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Libraries
  const marketLibrariesBuilt: Libraries = {}
  for (const library of MARKET_LIBRARIES) {
    marketLibrariesBuilt[library.name] = (
      await deploy(library.name, {
        contract: library.contract,
        from: deployer,
        skipIfAlreadyDeployed: true,
        log: true,
        autoMine: true,
      })
    ).address
  }

  // Deploy Implementations
  const marketImpl = await deploy('MarketImpl', {
    contract: 'Market',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
    libraries: marketLibrariesBuilt,
  })
  await deploy('MarketFactoryImpl', {
    contract: 'MarketFactory',
    args: [(await get('OracleFactory')).address, marketImpl.address],
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

  if ((await marketFactory.parameter()).maxFee.eq(0)) {
    process.stdout.write('Updating protocol parameter...')
    await marketFactory.updateParameter(DEFAULT_PROTOCOL_PARAMETER)
    process.stdout.write('complete\n')
  }

  if ((await marketFactory.pauser()) === constants.AddressZero && !!labsMultisig) {
    process.stdout.write('Updating protocol pauser...')
    await marketFactory.updatePauser(labsMultisig)
    process.stdout.write('complete\n')
  }

  // Create markets
  if (deployMarkets) {
    const markets = isFork() ? MARKETS[forkNetwork()] : MARKETS[getNetworkName()]
    console.log('Deploying Markets...')
    for (const marketDefinition of Object.values(markets)) {
      const oracleAddress = await oracleFactory.oracles(marketDefinition[0])

      if ((await marketFactory.markets(oracleAddress)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
        process.stdout.write(`Creating market with oracle ${marketDefinition[0]} and payoff ${marketDefinition[1]}...`)
        const marketAddress = await marketFactory.callStatic.create({
          token: (await get('DSU')).address,
          oracle: oracleAddress,
        })
        process.stdout.write(`deploying at ${marketAddress}...`)
        await (
          await marketFactory.create({
            token: (await get('DSU')).address,
            oracle: oracleAddress,
          })
        ).wait()

        const market = Market__factory.connect(await marketFactory.markets(oracleAddress), deployerSigner)

        await market.updateParameter(constants.AddressZero, constants.AddressZero, DEFAULT_MARKET_PARAMETER)
        await market.updateRiskParameter(DEFAULT_RISK_PARAMETERS)

        process.stdout.write('complete\n')
      }
    }
  }

  // Authorize markets
  if (!(await oracleFactory.callers(marketFactory.address))) {
    process.stdout.write('Authorizing market factory to call oracle factory...')
    await (await oracleFactory.authorize(marketFactory.address)).wait()
    process.stdout.write('complete\n')
  }

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
