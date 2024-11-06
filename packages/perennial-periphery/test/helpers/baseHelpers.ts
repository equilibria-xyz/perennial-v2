import { expect } from 'chai'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IOracleFactory, PythFactory } from '@perennial/v2-oracle/types/generated'
import { createFactories, deployController } from './setupHelpers'
import {
  Account__factory,
  AccountVerifier__factory,
  AggregatorV3Interface,
  Controller,
  Controller_Optimism,
  Controller_Optimism__factory,
  IEmptySetReserve,
  IEmptySetReserve__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarketFactory,
} from '../../types/generated'
import { impersonate } from '../../../common/testutil'

export const PYTH_ADDRESS = '0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a'
export const CHAINLINK_ETH_USD_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'

export const DSU_ADDRESS = '0x7b4Adf64B0d60fF97D672E473420203D52562A84' // Digital Standard Unit, an 18-decimal token
export const DSU_RESERVE = '0x5FA881826AD000D010977645450292701bc2f56D'

export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC, a 6-decimal token, used by DSU reserve above
export const USDC_HOLDER = '0xF977814e90dA44bFA03b6295A0616a897441aceC' // EOA has 302mm USDC at height 21067741

// deploys protocol
export async function createFactoriesForChain(
  owner: SignerWithAddress,
): Promise<[IOracleFactory, IMarketFactory, PythFactory, AggregatorV3Interface]> {
  return createFactories(owner, PYTH_ADDRESS, CHAINLINK_ETH_USD_FEED)
}

// connects to Base stablecoins and deploys a non-incentivized controller configured for them
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

// deploys an instance of the Controller with keeper compensation mechanisms for OP stack chains
export async function deployControllerOptimism(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  overrides?: CallOverrides,
): Promise<Controller_Optimism> {
  const accountImpl = await new Account__factory(owner).deploy(USDC_ADDRESS, DSU_ADDRESS, DSU_RESERVE)
  accountImpl.initialize(constants.AddressZero)
  const controller = await new Controller_Optimism__factory(owner).deploy(
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
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, wallet)
  const reserve = IEmptySetReserve__factory.connect(DSU_RESERVE, wallet)
  const balanceBefore = await dsu.balanceOf(wallet.address)

  // fund wallet with USDC and then mint using reserve
  await fundWalletUSDC(wallet, amount.div(1e12), overrides)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, wallet)
  await usdc.connect(wallet).approve(reserve.address, amount.div(1e12))
  await reserve.mint(amount)

  expect((await dsu.balanceOf(wallet.address)).sub(balanceBefore)).to.equal(amount)
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

export function getDSUReserve(owner: SignerWithAddress): IEmptySetReserve {
  return IEmptySetReserve__factory.connect(DSU_RESERVE, owner)
}

export async function getStablecoins(owner: SignerWithAddress): Promise<[IERC20Metadata, IERC20Metadata]> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  return [dsu, usdc]
}
