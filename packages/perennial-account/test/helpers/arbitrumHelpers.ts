import {
  IKeeperOracle,
  IMarketFactory,
  KeeperOracle__factory,
  OracleFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { createMarket, deployProtocolForOracle } from './setupHelpers'
import { IERC20Metadata, IMarket, IOracleProvider, IOracleProvider__factory } from '../../types/generated'

const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413' // OracleFactory used by MarketFactory
const ORACLE_FACTORY_OWNER = '0xdA381aeD086f544BaC66e73C071E158374cc105B' // TimelockController
const ETH_USD_KEEPER_ORACLE = '0xf9249EC6785221226Cb3f66fa049aA1E5B6a4A57' // KeeperOracle
const ETH_USD_ORACLE = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A' // Oracle with id 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

// deploys protocol using a forked Arbitrum oracle
export async function createMarketFactory(owner: SignerWithAddress): Promise<IMarketFactory> {
  const oracleFactory = OracleFactory__factory.connect(ORACLE_FACTORY, owner)
  return await deployProtocolForOracle(owner, oracleFactory, ORACLE_FACTORY_OWNER)
}

// creates a market using a locally deployed factory pointing to a forked oracle
export async function createMarketForOracle(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  dsu: IERC20Metadata,
): Promise<[IMarket, IOracleProvider, IKeeperOracle]> {
  // oracle used by the market, from which tests may query prices
  const oracle = IOracleProvider__factory.connect(ETH_USD_ORACLE, owner)
  // market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle)
  // tests use this to commit prices and settle the market
  const keeperOracle = await new KeeperOracle__factory(owner).attach(ETH_USD_KEEPER_ORACLE)
  return [market, oracle, keeperOracle]
}
