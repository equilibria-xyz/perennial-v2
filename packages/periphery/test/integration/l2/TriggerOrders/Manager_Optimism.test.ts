import { expect } from 'chai'
import { BigNumber, CallOverrides, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'

import {
  IEmptySetReserve__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IManager,
  IMarket,
  IMarketFactory,
  Manager_Optimism__factory,
  OptGasInfo,
  OrderVerifier__factory,
} from '../../../../types/generated'
import { impersonate } from '../../../../../common/testutil'
import { transferCollateral } from '../../../helpers/marketHelpers'
import {
  createMarketETH,
  deployController,
  deployProtocol,
  deployPythOracleFactory,
} from '../../../helpers/setupHelpers'
import { RunManagerTests } from './Manager.test'
import { FixtureVars } from './setupTypes'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_RESERVE,
  PYTH_ADDRESS,
  USDC_ADDRESS,
  USDC_HOLDER,
} from '../../../helpers/baseHelpers'

const { ethers } = HRE

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

async function fundWalletUSDC(
  wallet: SignerWithAddress,
  amount: BigNumber,
  overrides?: CallOverrides,
): Promise<undefined> {
  const usdcOwner = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, usdcOwner)

  expect(await usdc.balanceOf(USDC_HOLDER)).to.be.greaterThan(amount)
  await usdc.transfer(wallet.address, amount, overrides ?? {})
}

// prepares an account for use with the market and manager
async function setupUser(
  dsu: IERC20Metadata,
  marketFactory: IMarketFactory,
  market: IMarket,
  manager: IManager,
  user: SignerWithAddress,
  amount: BigNumber,
) {
  // funds, approves, and deposits DSU into the market
  await fundWalletDSU(user, amount.mul(1e12))
  await dsu.connect(user).approve(market.address, amount.mul(1e12))
  await transferCollateral(user, market, amount)

  // allows manager to interact with markets on the user's behalf
  await marketFactory.connect(user).updateOperator(manager.address, true)
}

const fixture = async (): Promise<FixtureVars> => {
  // deploy the protocol and create a market
  const [owner, userA, userB, userC, userD, keeper, oracleFeeReceiver] = await ethers.getSigners()
  const [marketFactory, dsu, oracleFactory] = await deployProtocol(owner, DSU_ADDRESS)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  const reserve = IEmptySetReserve__factory.connect(DSU_RESERVE, owner)
  const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory, PYTH_ADDRESS, CHAINLINK_ETH_USD_FEED)
  const marketWithOracle = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)
  const market = marketWithOracle.market

  // deploy the order manager
  const verifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)
  const controller = await deployController(owner, usdc.address, dsu.address, reserve.address, marketFactory.address)
  const manager = await new Manager_Optimism__factory(owner).deploy(
    USDC_ADDRESS,
    dsu.address,
    DSU_RESERVE,
    marketFactory.address,
    verifier.address,
    controller.address,
  )

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 250_000, // buffer for withdrawing keeper fee from market
    multiplierCalldata: 0,
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 650_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  await manager.initialize(CHAINLINK_ETH_USD_FEED, keepConfig, keepConfigBuffered)

  await mockGasInfo()

  return {
    dsu,
    usdc,
    reserve,
    keeperOracle: marketWithOracle.keeperOracle,
    manager,
    marketFactory,
    market,
    oracle: marketWithOracle.oracle,
    verifier,
    controller,
    owner,
    userA,
    userB,
    userC,
    userD,
    keeper,
    oracleFeeReceiver,
  }
}

async function getFixture(): Promise<FixtureVars> {
  const vars = loadFixture(fixture)
  return vars
}

async function mockGasInfo() {
  const gasInfo = await smock.fake<OptGasInfo>('OptGasInfo', {
    address: '0x420000000000000000000000000000000000000F',
  })
  gasInfo.getL1GasUsed.returns(1600)
  gasInfo.l1BaseFee.returns(18476655731)
  gasInfo.baseFeeScalar.returns(2768304)
  gasInfo.decimals.returns(6)
}

if (process.env.FORK_NETWORK === 'base') RunManagerTests('Manager_Optimism', getFixture, fundWalletDSU)
