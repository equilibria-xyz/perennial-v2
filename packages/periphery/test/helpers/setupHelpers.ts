import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Address } from 'hardhat-deploy/dist/types'
import { CallOverrides, constants } from 'ethers'
import { parse6decimal } from '../../../common/testutil/types'

import {
  Account__factory,
  AggregatorV3Interface,
  Controller,
  Controller__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
} from '../../types/generated'
import {
  IMarket,
  IMarketFactory,
  IOracleProvider,
  IVerifier,
  MarketFactory,
  MarketFactory__factory,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  Verifier__factory,
} from '@perennial/v2-core/types/generated'

import {
  IKeeperOracle,
  IOracleFactory,
  PythFactory,
  AggregatorV3Interface__factory,
} from '@perennial/v2-oracle/types/generated'
import { createMarket, deployMarketImplementation } from './marketHelpers'
import {
  createPythOracle,
  deployOracleFactory,
  deployPythOracleFactory,
  PYTH_BTC_USD_PRICE_FEED,
  PYTH_ETH_USD_PRICE_FEED,
} from './oracleHelpers'

export interface MarketWithOracle {
  market: IMarket
  oracle: IOracleProvider
  keeperOracle: IKeeperOracle
}

// deploys market and oracle factories
export async function createFactories(
  owner: SignerWithAddress,
  pythAddress: Address,
  chainLinkFeedAddress: Address,
): Promise<[IOracleFactory, IMarketFactory, PythFactory, AggregatorV3Interface]> {
  // Deploy the oracle factory, which markets created by the market factory will query
  const oracleFactory = await deployOracleFactory(owner)
  // Deploy the market factory and authorize it with the oracle factory
  const marketFactory = await deployProtocolForOracle(owner, oracleFactory)
  // Connect the Chainlink ETH feed used for keeper compensation
  const chainlinkKeptFeed = AggregatorV3Interface__factory.connect(chainLinkFeedAddress, owner)
  // Deploy a Pyth keeper oracle factory, which we'll need to meddle with prices
  const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory, pythAddress, chainlinkKeptFeed.address)

  return [oracleFactory, marketFactory, pythOracleFactory, chainlinkKeptFeed]
}

// creates an ETH market using a locally deployed factory and oracle
export async function createMarketETH(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  marketFactory: IMarketFactory,
  dsu: IERC20Metadata,
  overrides?: CallOverrides,
): Promise<MarketWithOracle> {
  // Create oracles needed to support the market
  const [keeperOracle, oracle] = await createPythOracle(
    owner,
    oracleFactory,
    pythOracleFactory,
    PYTH_ETH_USD_PRICE_FEED,
    'ETH-USD',
    overrides,
  )
  // Create the market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle, undefined, undefined, overrides ?? {})
  await keeperOracle.register(oracle.address)
  await oracle.register(market.address)
  return { market, oracle, keeperOracle }
}

// creates a BTC market using a locally deployed factory and oracle
export async function createMarketBTC(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  marketFactory: IMarketFactory,
  dsu: IERC20Metadata,
  overrides?: CallOverrides,
): Promise<MarketWithOracle> {
  // Create oracles needed to support the market
  const [keeperOracle, oracle] = await createPythOracle(
    owner,
    oracleFactory,
    pythOracleFactory,
    PYTH_BTC_USD_PRICE_FEED,
    'BTC-USD',
    overrides,
  )
  // Create the market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle, undefined, undefined, overrides ?? {})
  await keeperOracle.register(oracle.address)
  await oracle.register(market.address)
  return { market, oracle, keeperOracle }
}

// Deploys an unincentivized collateral account controller for unit testing
export async function deployController(
  owner: SignerWithAddress,
  usdcAddress: Address,
  dsuAddress: Address,
  reserveAddress: Address,
  marketFactoryAddress: Address,
): Promise<Controller> {
  const accountImpl = await new Account__factory(owner).deploy(usdcAddress, dsuAddress, reserveAddress)
  accountImpl.initialize(constants.AddressZero)
  return await new Controller__factory(owner).deploy(accountImpl.address, marketFactoryAddress)
}

// Deploys OracleFactory and then MarketFactory
export async function deployProtocol(
  owner: SignerWithAddress,
  dsuAddress: Address,
): Promise<[IMarketFactory, IERC20Metadata, IOracleFactory]> {
  // Deploy the oracle factory, which markets created by the market factory will query
  const dsu = IERC20Metadata__factory.connect(dsuAddress, owner)
  const oracleFactory = await deployOracleFactory(owner)

  // Deploy the market factory and authorize it with the oracle factory
  const marketVerifier = await new Verifier__factory(owner).deploy()
  const marketFactory = await deployProtocolForOracle(owner, oracleFactory, marketVerifier)
  return [marketFactory, dsu, oracleFactory]
}

// Deploys the protocol using a provided oracle
export async function deployProtocolForOracle(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  verifier: IVerifier | undefined = undefined,
): Promise<IMarketFactory> {
  // Deploy protocol contracts
  if (!verifier) verifier = await new Verifier__factory(owner).deploy()
  const marketImpl = await deployMarketImplementation(owner, verifier.address)
  const marketFactory = await deployMarketFactory(
    owner,
    owner,
    oracleFactory.address,
    verifier.address,
    marketImpl.address,
  )
  return marketFactory
}

// Deploys the market factory and configures default protocol parameters
async function deployMarketFactory(
  owner: SignerWithAddress,
  pauser: SignerWithAddress,
  oracleFactoryAddress: Address,
  verifierAddress: Address,
  marketImplAddress: Address,
): Promise<MarketFactory> {
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()
  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactoryAddress,
    verifierAddress,
    marketImplAddress,
  )
  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const marketFactory = new MarketFactory__factory(owner).attach(factoryProxy.address)
  await marketFactory.connect(owner).initialize()

  // Set protocol parameters
  await marketFactory.updatePauser(pauser.address)
  await marketFactory.updateParameter({
    maxFee: parse6decimal('0.01'),
    maxLiquidationFee: parse6decimal('20'),
    maxCut: parse6decimal('0.50'),
    maxRate: parse6decimal('10.00'),
    minMaintenance: parse6decimal('0.01'),
    minEfficiency: parse6decimal('0.1'),
    referralFee: 0,
    minScale: parse6decimal('0.001'),
    maxStaleAfter: 7200,
    minMinMaintenance: 0,
  })

  return marketFactory
}
