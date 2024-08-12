import { expect } from 'chai'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import {
  IKeeperOracle,
  IOracleFactory,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle,
  Oracle__factory,
  PythFactory,
  PythFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { createMarket, deployController, deployOracleFactory, deployProtocolForOracle } from './setupHelpers'
import {
  Account__factory,
  AccountVerifier__factory,
  Controller,
  Controller_Arbitrum,
  Controller_Arbitrum__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarket,
  IMarketFactory,
  IOracleProvider,
  RebalanceLib__factory,
  GasOracle__factory,
} from '../../types/generated'
import { IKept } from '../../types/generated/contracts/Controller_Arbitrum'
import { impersonate } from '../../../common/testutil'
import { IVerifier } from '@equilibria/perennial-v2/types/generated'

const PYTH_ADDRESS = '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const PYTH_BTC_USD_PRICE_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 466k at height 208460709
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // Arbitrum native USDC (not USDC.e), a 6-decimal token
const USDC_HOLDER = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7' // Hyperliquid deposit bridge has 414mm USDC at height 233560862

// deploys protocol
export async function createFactories(
  owner: SignerWithAddress,
): Promise<[IOracleFactory, IMarketFactory, PythFactory]> {
  // Deploy the oracle factory, which markets created by the market factory will query
  const oracleFactory = await deployOracleFactory(owner)
  // Deploy the market factory and authorize it with the oracle factory
  const marketFactory = await deployProtocolForOracle(owner, oracleFactory)

  // Deploy a Pyth keeper oracle factory, which we'll need to meddle with prices

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

  return [oracleFactory, marketFactory, pythOracleFactory]
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
    overrides,
  )
  // Create the market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle, undefined, undefined, overrides ?? {})
  await keeperOracle.register(oracle.address)
  await oracle.register(market.address)
  return [market, oracle, keeperOracle]
}

// creates a BTC market using a locally deployed factory and oracle
export async function createMarketBTC(
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
    PYTH_BTC_USD_PRICE_FEED,
    overrides,
  )
  // Create the market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle, undefined, undefined, overrides ?? {})
  await keeperOracle.register(oracle.address)
  await oracle.register(market.address)
  return [market, oracle, keeperOracle]
}

// connects to Arbitrum stablecoins and deploys a controller configured for them
export async function deployAndInitializeController(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
): Promise<[IERC20Metadata, IERC20Metadata, Controller]> {
  const [dsu, usdc] = await getStablecoins(owner)
  const controller = await deployController(owner, usdc.address, dsu.address, DSU_RESERVE)

  const verifier = await new AccountVerifier__factory(owner).deploy()
  await controller.initialize(marketFactory.address, verifier.address)
  return [dsu, usdc, controller]
}

// deploys an instance of the Controller with Arbitrum-specific keeper compensation mechanisms
export async function deployControllerArbitrum(
  owner: SignerWithAddress,
  keepConfig: IKept.KeepConfigStruct,
  nonceManager: IVerifier,
  overrides?: CallOverrides,
): Promise<Controller_Arbitrum> {
  const accountImpl = await new Account__factory(owner).deploy(USDC_ADDRESS, DSU_ADDRESS, DSU_RESERVE)
  accountImpl.initialize(constants.AddressZero)
  const controller = await new Controller_Arbitrum__factory(
    {
      'contracts/libs/RebalanceLib.sol:RebalanceLib': (await new RebalanceLib__factory(owner).deploy()).address,
    },
    owner,
  ).deploy(accountImpl.address, keepConfig, nonceManager.address, overrides ?? {})
  return controller
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

export async function fundWalletUSDC(
  wallet: SignerWithAddress,
  amount: BigNumber,
  overrides?: CallOverrides,
): Promise<undefined> {
  const usdcOwner = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, usdcOwner)

  expect(await usdc.balanceOf(USDC_HOLDER)).to.be.greaterThan(amount)
  await usdc.transfer(wallet.address, amount, overrides ?? {})
}

export async function getStablecoins(owner: SignerWithAddress): Promise<[IERC20Metadata, IERC20Metadata]> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  return [dsu, usdc]
}

export async function returnUSDC(wallet: SignerWithAddress): Promise<undefined> {
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, wallet)
  await usdc.transfer(USDC_HOLDER, await usdc.balanceOf(wallet.address))
}

export async function returnDSU(wallet: SignerWithAddress): Promise<undefined> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, wallet)
  await dsu.transfer(DSU_HOLDER, await dsu.balanceOf(wallet.address))
}

async function createPythOracle(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  pythFeedId: string,
  overrides?: CallOverrides,
): Promise<[KeeperOracle, Oracle]> {
  // Create the keeper oracle, which tests may use to meddle with prices
  const keeperOracle = KeeperOracle__factory.connect(
    await pythOracleFactory.callStatic.create(pythFeedId, pythFeedId, {
      provider: constants.AddressZero,
      decimals: 0,
    }),
    owner,
  )
  await pythOracleFactory.create(
    pythFeedId,
    pythFeedId,
    { provider: constants.AddressZero, decimals: 0 },
    overrides ?? {},
  )

  // Create the oracle, which markets created by the market factory will query
  const oracle = Oracle__factory.connect(
    await oracleFactory.callStatic.create(pythFeedId, pythOracleFactory.address),
    owner,
  )
  await oracleFactory.create(pythFeedId, pythOracleFactory.address, overrides ?? {})
  return [keeperOracle, oracle]
}
