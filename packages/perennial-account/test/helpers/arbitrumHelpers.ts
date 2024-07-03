import { expect } from 'chai'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import {
  IKeeperOracle,
  IMarketFactory,
  IOracleFactory,
  IOracle__factory,
  IPayoffProvider__factory,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle,
  OracleFactory__factory,
  Oracle__factory,
  PowerTwo__factory,
  PythFactory,
  PythFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { createMarket, deployController, deployOracleFactory, deployProtocolForOracle } from './setupHelpers'
import {
  Controller,
  Controller_Arbitrum,
  Controller_Arbitrum__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarket,
  IOracleProvider,
  IOracleProvider__factory,
  RebalanceLib__factory,
  Verifier__factory,
} from '../../types/generated'
import type { IKept } from '../../contracts/Controller_Arbitrum'
import { impersonate } from '../../../common/testutil'
import { ChainlinkContext } from '@equilibria/perennial-v2/test/integration/helpers/chainlinkHelpers'

// const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413' // OracleFactory used by MarketFactory
// const ORACLE_FACTORY_OWNER = '0xdA381aeD086f544BaC66e73C071E158374cc105B' // TimelockController
// const ETH_USD_KEEPER_ORACLE = '0xf9249EC6785221226Cb3f66fa049aA1E5B6a4A57' // KeeperOracle
// const ETH_USD_ORACLE = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A' // Oracle with id 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
// const BTC_USD_KEEPER_ORACLE = '0xCd98f0FfbE50e334Dd6b84584483617557Ddc012' // KeeperOracle
// const BTC_USD_ORACLE = '0x8D87D552596767D43390464Affc964D9816A30D9' // Oracle with id 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
// export const CHAINLINK_CUSTOM_CURRENCIES = {
//   ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
//   BTC: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
//   USD: '0x0000000000000000000000000000000000000348',
// }
const PYTH_ADDRESS = '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const PYTH_BTC_USD_PRICE_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 466k at height 208460709
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

// TODO: using these temporarily until DSU migrates to native USDC
const USDCe_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' // Arbitrum bridged USDC
const USDCe_HOLDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d' // Binance hot wallet has 55mm USDC.e at height 208460709
// const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // Arbitrum native USDC (not USDC.e), a 6-decimal token
// const USDC_HOLDER = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7' // Hyperliquid deposit bridge has 340mm USDC at height 208460709

// deploys protocol
export async function createFactories(
  owner: SignerWithAddress,
): Promise<[IOracleFactory, IMarketFactory, PythFactory]> {
  // Deploy the oracle factory, which markets created by the market factory will query
  const oracleFactory = await deployOracleFactory(owner, DSU_ADDRESS)
  // Deploy the market factory and authorize it with the oracle factory
  const marketFactory = await deployProtocolForOracle(owner, oracleFactory, owner.address)

  // Deploy a Pyth keeper oracle factory, which we'll need to meddle with prices
  const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
  const pythOracleFactory = await new PythFactory__factory(owner).deploy(
    PYTH_ADDRESS,
    keeperOracleImpl.address,
    4,
    10,
    {
      multiplierBase: 0,
      bufferBase: 1_000_000,
      multiplierCalldata: 0,
      bufferCalldata: 500_000,
    },
    {
      multiplierBase: utils.parseEther('1.02'),
      bufferBase: 2_000_000,
      multiplierCalldata: utils.parseEther('1.03'),
      bufferCalldata: 1_500_000,
    },
    5_000,
  )
  await pythOracleFactory.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, DSU_ADDRESS)
  await oracleFactory.register(pythOracleFactory.address)
  await pythOracleFactory.authorize(oracleFactory.address)

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
  )
  // Create the market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle, undefined, undefined, overrides ?? {})
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
  )
  // Create the market in which user or collateral account may interact
  const market = await createMarket(owner, marketFactory, dsu, oracle, undefined, undefined, overrides ?? {})
  return [market, oracle, keeperOracle]
}

// connects to Arbitrum stablecoins and deploys a controller configured for them
export async function deployAndInitializeController(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
): Promise<[IERC20Metadata, IERC20Metadata, Controller]> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, owner)
  const controller = await deployController(owner)

  const verifier = await new Verifier__factory(owner).deploy()
  await controller.initialize(marketFactory.address, verifier.address, usdc.address, dsu.address, DSU_RESERVE)
  return [dsu, usdc, controller]
}

// deploys an instance of the Controller with Arbitrum-specific keeper compensation mechanisms
export async function deployControllerArbitrum(
  owner: SignerWithAddress,
  keepConfig: IKept.KeepConfigStruct,
  overrides?: CallOverrides,
): Promise<Controller_Arbitrum> {
  const controller = await new Controller_Arbitrum__factory(
    {
      'contracts/libs/RebalanceLib.sol:RebalanceLib': (await new RebalanceLib__factory(owner).deploy()).address,
    },
    owner,
  ).deploy(keepConfig, overrides ?? {})
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
  const usdcOwner = await impersonate.impersonateWithBalance(USDCe_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, usdcOwner)

  expect(await usdc.balanceOf(USDCe_HOLDER)).to.be.greaterThan(amount)
  await usdc.transfer(wallet.address, amount, overrides ?? {})
}

export async function returnUSDC(wallet: SignerWithAddress): Promise<undefined> {
  const usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, wallet)
  await usdc.transfer(USDCe_HOLDER, await usdc.balanceOf(wallet.address))
}

export async function returnDSU(wallet: SignerWithAddress): Promise<undefined> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, wallet)
  await dsu.transfer(DSU_HOLDER, await dsu.balanceOf(wallet.address))
}

// TODO: support overrides to creation calls below
async function createPythOracle(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  pythFeedId: string,
): Promise<[KeeperOracle, Oracle]> {
  // Create the keeper oracle, which tests may use to meddle with prices
  const keeperOracle = KeeperOracle__factory.connect(
    await pythOracleFactory.callStatic.create(pythFeedId, pythFeedId, {
      provider: constants.AddressZero,
      decimals: 0,
    }),
    owner,
  )
  await pythOracleFactory.create(pythFeedId, pythFeedId, {
    provider: constants.AddressZero,
    decimals: 0,
  })
  // Create the oracle, which markets created by the market factory will query
  const oracle = Oracle__factory.connect(
    await oracleFactory.callStatic.create(pythFeedId, pythOracleFactory.address),
    owner,
  )
  await oracleFactory.create(pythFeedId, pythOracleFactory.address)
  return [keeperOracle, oracle]
}
