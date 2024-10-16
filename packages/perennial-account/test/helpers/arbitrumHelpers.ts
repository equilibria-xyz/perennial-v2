import { expect } from 'chai'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IOracleFactory, PythFactory } from '@equilibria/perennial-v2-oracle/types/generated'
import { createFactories, deployController } from './setupHelpers'
import {
  Account__factory,
  AccountVerifier__factory,
  Controller,
  Controller_Arbitrum,
  Controller_Arbitrum__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarketFactory,
} from '../../types/generated'
import { impersonate } from '../../../common/testutil'

const PYTH_ADDRESS = '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C'
const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 466k at height 208460709
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // Arbitrum native USDC (not USDC.e), a 6-decimal token
const USDC_HOLDER = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7' // Hyperliquid deposit bridge has 414mm USDC at height 233560862

// deploys protocol
export async function createFactoriesForChain(
  owner: SignerWithAddress,
): Promise<[IOracleFactory, IMarketFactory, PythFactory]> {
  return createFactories(owner, PYTH_ADDRESS, CHAINLINK_ETH_USD_FEED)
}

// connects to Arbitrum stablecoins and deploys a controller configured for them
export async function deployAndInitializeController(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
): Promise<[IERC20Metadata, IERC20Metadata, Controller]> {
  const [dsu, usdc] = await getStablecoins(owner)
  const controller = await deployController(owner, usdc.address, dsu.address, DSU_RESERVE, marketFactory.address)

  const verifier = await new AccountVerifier__factory(owner).deploy(marketFactory.address)
  await controller.initialize(verifier.address)
  return [dsu, usdc, controller]
}

// deploys an instance of the Controller with Arbitrum-specific keeper compensation mechanisms
export async function deployControllerArbitrum(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  overrides?: CallOverrides,
): Promise<Controller_Arbitrum> {
  const accountImpl = await new Account__factory(owner).deploy(USDC_ADDRESS, DSU_ADDRESS, DSU_RESERVE)
  accountImpl.initialize(constants.AddressZero)
  const controller = await new Controller_Arbitrum__factory(owner).deploy(
    accountImpl.address,
    marketFactory.address,
    await marketFactory.verifier(),
    overrides ?? {},
  )
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
