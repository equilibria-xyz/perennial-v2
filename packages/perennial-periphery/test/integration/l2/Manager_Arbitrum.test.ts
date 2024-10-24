import { expect } from 'chai'
import { BigNumber, CallOverrides, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'

import {
  ArbGasInfo,
  IEmptySetReserve__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IManager,
  IMarket,
  IMarketFactory,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../../types/generated'
import { impersonate } from '../../../../common/testutil'

import { parse6decimal } from '../../../../common/testutil/types'
import { transferCollateral } from '../../../../perennial-order/test/helpers/marketHelpers'
import {
  createMarketETH,
  deployProtocol,
  deployPythOracleFactory,
  FixtureVars,
} from '../../../../perennial-order/test/helpers/setupHelpers'
import { RunManagerTests } from './Manager.test'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 4.7mm at height 243648015
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // Arbitrum native USDC, a 6-decimal token

const PYTH_ADDRESS = '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C'

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

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
  const [market, oracle, keeperOracle] = await createMarketETH(
    owner,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    dsu,
  )

  // deploy the order manager
  const verifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)
  const manager = await new Manager_Arbitrum__factory(owner).deploy(
    USDC_ADDRESS,
    dsu.address,
    DSU_RESERVE,
    marketFactory.address,
    verifier.address,
  )

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 1_000_000, // buffer for withdrawing keeper fee from market
    multiplierCalldata: 0,
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1.05'),
    bufferBase: 1_500_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1.05'),
    bufferCalldata: 35_200,
  }
  await manager.initialize(CHAINLINK_ETH_USD_FEED, keepConfig, keepConfigBuffered)

  // TODO: can user setup be handled by the test in such a way that the test calls loadFixture
  // after some nested setup?
  // fund accounts and deposit all into market
  const amount = parse6decimal('100000')
  await setupUser(dsu, marketFactory, market, manager, userA, amount)
  await setupUser(dsu, marketFactory, market, manager, userB, amount)
  await setupUser(dsu, marketFactory, market, manager, userC, amount)
  await setupUser(dsu, marketFactory, market, manager, userD, amount)

  return {
    dsu,
    usdc,
    reserve,
    keeperOracle,
    manager,
    marketFactory,
    market,
    oracle,
    verifier,
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
  // Hardhat fork does not support Arbitrum built-ins; Kept produces "invalid opcode" error without this
  /*const gasInfo = */ await smock.fake<ArbGasInfo>('ArbGasInfo', {
    address: '0x000000000000000000000000000000000000006C',
  })
  // TODO: is this needed/useful?
  // gasInfo.getL1BaseFeeEstimate.returns(0)
}

if (process.env.FORK_NETWORK === 'arbitrum') RunManagerTests('Manager_Arbitrum', getFixture, mockGasInfo)
