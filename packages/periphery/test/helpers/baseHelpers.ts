import { expect } from 'chai'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'
import { deployments } from 'hardhat'

import { impersonate } from '../../../common/testutil'
import { createFactories, deployController } from './setupHelpers'
import { IOracleFactory, PythFactory } from '@perennial/v2-oracle/types/generated'
import {
  Account__factory,
  AccountVerifier__factory,
  AggregatorV3Interface,
  Controller,
  Controller_Optimism,
  Controller_Optimism__factory,
  IEmptySetReserve__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMarketFactory,
  OptGasInfo,
} from '../../types/generated'

export const CHAINLINK_ETH_USD_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'
export const USDC_HOLDER = '0xF977814e90dA44bFA03b6295A0616a897441aceC' // EOA has 302mm USDC at height 21067741

// deploys protocol
export async function createFactoriesForChain(
  owner: SignerWithAddress,
): Promise<[IOracleFactory, IMarketFactory, PythFactory, AggregatorV3Interface]> {
  return createFactories(owner, CHAINLINK_ETH_USD_FEED)
}

// connects to Base stablecoins and deploys a non-incentivized controller configured for them
export async function deployAndInitializeController(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
): Promise<[IERC20Metadata, IERC20Metadata, Controller]> {
  const [dsu, usdc] = await getStablecoins(owner)
  const controller = await deployController(
    owner,
    usdc.address,
    dsu.address,
    (
      await deployments.get('DSUReserve')
    ).address,
    marketFactory.address,
  )

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
  const accountImpl = await new Account__factory(owner).deploy(
    (
      await deployments.get('USDC')
    ).address,
    (
      await deployments.get('DSU')
    ).address,
    (
      await deployments.get('DSUReserve')
    ).address,
  )
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
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, wallet)
  const reserve = IEmptySetReserve__factory.connect((await deployments.get('DSUReserve')).address, wallet)
  const balanceBefore = await dsu.balanceOf(wallet.address)

  // fund wallet with USDC and then mint using reserve
  await fundWalletUSDC(wallet, amount.div(1e12), overrides ?? {})
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, wallet)
  await usdc.connect(wallet).approve(reserve.address, amount.div(1e12), overrides ?? {})
  await reserve.mint(amount, overrides ?? {})

  expect((await dsu.balanceOf(wallet.address)).sub(balanceBefore)).to.equal(amount)
}

export async function fundWalletUSDC(
  wallet: SignerWithAddress,
  amount: BigNumber,
  overrides?: CallOverrides,
): Promise<undefined> {
  const usdcOwner = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, usdcOwner)

  expect(await usdc.balanceOf(USDC_HOLDER)).to.be.greaterThan(amount)
  await usdc.transfer(wallet.address, amount, overrides ?? {})
}

export async function getStablecoins(owner: SignerWithAddress): Promise<[IERC20Metadata, IERC20Metadata]> {
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)
  return [dsu, usdc]
}

export async function mockGasInfo() {
  const gasInfo = await smock.fake<OptGasInfo>('OptGasInfo', {
    address: '0x420000000000000000000000000000000000000F',
  })
  // using Base TX 0xe402eda84661d8f9756f157d9ad60c8dcbb0cdef202e346b2b2f36fd02b12f4a as example
  gasInfo.getL1GasUsed.returns(19715) // transaction-dependent; example is price committment
  gasInfo.l1BaseFee.returns(12846693375) // mainnet block 21446268 base fee
  gasInfo.baseFeeScalar.returns(2269) // hardcoded - https://basescan.org/address/0x420000000000000000000000000000000000000F#readProxyContract#F3
  gasInfo.decimals.returns(6)
}
