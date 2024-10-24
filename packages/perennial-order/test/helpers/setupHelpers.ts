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

import { createMarket, deployMarketImplementation } from '../../../perennial-periphery/test/helpers/marketHelpers'
import { createPythOracle, deployOracleFactory } from '../../../perennial-periphery/test/helpers/oracleHelpers'
import { parse6decimal } from '../../../common/testutil/types'

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

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
