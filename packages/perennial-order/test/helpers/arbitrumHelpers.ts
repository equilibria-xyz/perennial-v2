import { expect } from 'chai'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import { IMarket, MarketFactory, MarketFactory__factory } from '@equilibria/perennial-v2/types/generated'
import {
  IKeeperOracle,
  IOracleFactory,
  IOracleProvider,
  KeeperOracle__factory,
  OracleFactory,
  PythFactory,
  PythFactory__factory,
  GasOracle__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { Verifier__factory } from '@equilibria/perennial-v2-verifier/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata, IERC20Metadata__factory, IMarketFactory, IVerifier } from '../../types/generated'
import { impersonate } from '../../../common/testutil'
import { Address } from 'hardhat-deploy/dist/types'
import { parse6decimal } from '../../../common/testutil/types'
import { createPythOracle, deployOracleFactory } from './oracleHelpers'
import { createMarket, deployMarketImplementation } from './marketHelpers'

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 4.7mm at height 243648015
const PYTH_ADDRESS = '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'

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
async function deployMarketFactory(
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
    maxLiquidationFee: parse6decimal('1000'),
    maxCut: parse6decimal('0.50'),
    maxRate: parse6decimal('10.00'),
    minMaintenance: parse6decimal('0.01'),
    minEfficiency: parse6decimal('0.1'),
    referralFee: 0,
    minScale: parse6decimal('0.001'),
  })

  return marketFactory
}

// Deploys OracleFactory and then MarketFactory
export async function deployProtocol(
  owner: SignerWithAddress,
): Promise<[IMarketFactory, IERC20Metadata, IOracleFactory]> {
  // Deploy the oracle factory, which markets created by the market factory will query
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
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
): Promise<PythFactory> {
  const commitmentGasOracle = await new GasOracle__factory(owner).deploy(
    CHAINLINK_ETH_USD_FEED,
    8,
    1_000_000,
    utils.parseEther('1.02'),
    1_000_000,
    0,
    0,
    0,
  )
  const settlementGasOracle = await new GasOracle__factory(owner).deploy(
    CHAINLINK_ETH_USD_FEED,
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
    PYTH_ADDRESS,
    commitmentGasOracle.address,
    settlementGasOracle.address,
    keeperOracleImpl.address,
  )
  await pythOracleFactory.initialize(oracleFactory.address)
  await pythOracleFactory.updateParameter(1, 0, 4, 10)
  await oracleFactory.register(pythOracleFactory.address)
  return pythOracleFactory
}

export async function fundWalletDSU(
  wallet: SignerWithAddress,
  amount: BigNumber,
  overrides?: CallOverrides,
): Promise<undefined> {
  const dsuOwner = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, dsuOwner)

  expect(await dsu.balanceOf(DSU_HOLDER)).to.be.greaterThan(amount)
  await dsu.transfer(wallet.address, amount, overrides ?? {})
}
