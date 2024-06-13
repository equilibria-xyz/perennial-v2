import { expect } from 'chai'
import { BigNumber, CallOverrides, utils } from 'ethers'
import {
  IKeeperOracle,
  IMarketFactory,
  KeeperOracle__factory,
  OracleFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { createMarket, deployController, deployProtocolForOracle } from './setupHelpers'
import {
  Controller,
  Controller_Arbitrum,
  Controller_Arbitrum__factory,
  IController,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarket,
  IOracleProvider,
  IOracleProvider__factory,
  Verifier__factory,
} from '../../types/generated'
import type { IKept } from '../../contracts/Controller_Arbitrum'
import { impersonate } from '../../../common/testutil'

const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413' // OracleFactory used by MarketFactory
const ORACLE_FACTORY_OWNER = '0xdA381aeD086f544BaC66e73C071E158374cc105B' // TimelockController
const ETH_USD_KEEPER_ORACLE = '0xf9249EC6785221226Cb3f66fa049aA1E5B6a4A57' // KeeperOracle
const ETH_USD_ORACLE = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A' // Oracle with id 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 466k at height 208460709
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

// TODO: using these temporarily until DSU migrates to native USDC
const USDCe_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' // Arbitrum bridged USDC
const USDCe_HOLDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d' // Binance hot wallet has 55mm USDC.e at height 208460709
// const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // Arbitrum native USDC (not USDC.e), a 6-decimal token
// const USDC_HOLDER = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7' // Hyperliquid deposit bridge has 340mm USDC at height 208460709

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

// connects to Arbitrum stablecoins and deploys a controller configured for them
export async function deployAndInitializeController(
  owner: SignerWithAddress,
): Promise<[IERC20Metadata, IERC20Metadata, Controller]> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, owner)
  const controller = await deployController(owner)

  const verifier = await new Verifier__factory(owner).deploy()
  await controller.initialize(verifier.address, usdc.address, dsu.address, DSU_RESERVE)
  return [dsu, usdc, controller]
}

// deploys an instance of the Controller with Arbitrum-specific keeper compensation mechanisms
export async function deployControllerArbitrum(
  owner: SignerWithAddress,
  keepConfig: IKept.KeepConfigStruct,
  overrides?: CallOverrides,
): Promise<Controller_Arbitrum> {
  const controller = await new Controller_Arbitrum__factory(owner).deploy(keepConfig, overrides ?? {})
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
