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
import { transferCollateral } from '../../helpers/marketHelpers'
import { createMarketETH, deployProtocol, deployPythOracleFactory } from '../../helpers/setupHelpers'
import { RunManagerTests } from './Manager.test'
import { FixtureVars } from './setupTypes'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_HOLDER,
  DSU_RESERVE,
  PYTH_ADDRESS,
  USDC_ADDRESS,
} from '../../helpers/arbitrumHelpers'

const { ethers } = HRE

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
  const marketWithOracle = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)
  const market = marketWithOracle.market

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
    bufferBase: 950_000, // buffer for withdrawing keeper fee from market
    multiplierCalldata: 0,
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1.05'),
    bufferBase: 1_875_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1.05'),
    bufferCalldata: 35_200,
  }
  await manager.initialize(CHAINLINK_ETH_USD_FEED, keepConfig, keepConfigBuffered)

  // fund accounts and deposit all into market
  const amount = parse6decimal('100000')
  await setupUser(dsu, marketFactory, market, manager, userA, amount)
  await setupUser(dsu, marketFactory, market, manager, userB, amount)
  await setupUser(dsu, marketFactory, market, manager, userC, amount)
  await setupUser(dsu, marketFactory, market, manager, userD, amount)

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
  const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
    address: '0x000000000000000000000000000000000000006C',
  })
  gasInfo.getL1BaseFeeEstimate.returns(1)
}

if (process.env.FORK_NETWORK === 'arbitrum') RunManagerTests('Manager_Arbitrum', getFixture)
