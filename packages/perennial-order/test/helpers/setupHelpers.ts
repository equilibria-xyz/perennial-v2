import { CallOverrides, utils } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { IVerifier, MarketFactory, MarketFactory__factory, Verifier__factory } from '@perennial/core/types/generated'
import {
  IKeeperOracle,
  IOracleFactory,
  KeeperOracle__factory,
  OracleFactory,
  PythFactory,
  PythFactory__factory,
} from '@perennial/oracle/types/generated'
import {
  GasOracle__factory,
  IEmptySetReserve,
  IERC20Metadata,
  IERC20Metadata__factory,
  IManager,
  IMarket,
  IMarketFactory,
  IOracleProvider,
  IOrderVerifier,
} from '../../types/generated'

import { createMarket, deployMarketImplementation } from './marketHelpers'
import { createPythOracle, deployOracleFactory } from './oracleHelpers'
import { parse6decimal } from '../../../common/testutil/types'

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

export interface FixtureVars {
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  reserve: IEmptySetReserve
  keeperOracle: IKeeperOracle
  manager: IManager
  marketFactory: IMarketFactory
  market: IMarket
  oracle: IOracleProvider
  verifier: IOrderVerifier
  owner: SignerWithAddress
  userA: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  keeper: SignerWithAddress
  oracleFeeReceiver: SignerWithAddress
}

// creates an ETH market using a locally deployed factory and oracle
export async function createMarketETH(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  marketFactory: IMarketFactory,
  dsu: IERC20Metadata,
  overrides?: CallOverrides,
): Promise<[IMarket, IOracleProvider, IKeeperOracle]> {
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
  return [market, oracle, keeperOracle]
}

// Deploys the market factory and configures default protocol parameters
export async function deployMarketFactory(
  owner: SignerWithAddress,
  pauser: SignerWithAddress,
  oracleFactoryAddress: Address,
  verifierAddress: Address,
  marketImplAddress: Address,
): Promise<MarketFactory> {
  const marketFactory = await new MarketFactory__factory(owner).deploy(
    oracleFactoryAddress,
    verifierAddress,
    marketImplAddress,
  )
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
  })

  return marketFactory
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

// Deploys a market implementation and the MarketFactory for a provided oracle factory
async function deployProtocolForOracle(
  owner: SignerWithAddress,
  oracleFactory: OracleFactory,
  verifier: IVerifier,
): Promise<IMarketFactory> {
  // Deploy protocol contracts
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

export async function deployPythOracleFactory(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythAddress: Address,
  chainlinkFeedAddress: Address,
): Promise<PythFactory> {
  const commitmentGasOracle = await new GasOracle__factory(owner).deploy(
    chainlinkFeedAddress,
    8,
    1_000_000,
    utils.parseEther('1.02'),
    1_000_000,
    0,
    0,
    0,
  )
  const settlementGasOracle = await new GasOracle__factory(owner).deploy(
    chainlinkFeedAddress,
    8,
    200_000,
    utils.parseEther('1.02'),
    500_000,
    0,
    0,
    0,
  )

  // Deploy a Pyth keeper oracle factory, which we'll need to meddle with prices
  const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
  const pythOracleFactory = await new PythFactory__factory(owner).deploy(
    pythAddress,
    commitmentGasOracle.address,
    settlementGasOracle.address,
    keeperOracleImpl.address,
  )
  await pythOracleFactory.initialize(oracleFactory.address)
  await pythOracleFactory.updateParameter(1, 0, 4, 10)
  await oracleFactory.register(pythOracleFactory.address)
  return pythOracleFactory
}
