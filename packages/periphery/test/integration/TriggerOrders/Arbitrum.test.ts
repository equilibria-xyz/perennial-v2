import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'

import {
  IEmptySetReserve__factory,
  IERC20Metadata__factory,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../../types/generated'
import { deployPythOracleFactory } from '../../helpers/oracleHelpers'
import { createMarketETH, deployController, deployProtocol } from '../../helpers/setupHelpers'
import { RunManagerTests } from './Manager.test'
import { FixtureVars } from './setupTypes'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_RESERVE,
  fundWalletDSU,
  mockGasInfo,
  PYTH_ADDRESS,
  USDC_ADDRESS,
} from '../../helpers/arbitrumHelpers'

const { ethers } = HRE

const fixture = async (): Promise<FixtureVars> => {
  // deploy the protocol and create a market
  const [owner, userA, userB, userC, userD, keeper, oracleFeeReceiver] = await ethers.getSigners()
  const [marketFactory, dsu, oracleFactory] = await deployProtocol(owner, DSU_ADDRESS)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  const reserve = IEmptySetReserve__factory.connect(DSU_RESERVE, owner)
  const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory, PYTH_ADDRESS, CHAINLINK_ETH_USD_FEED)
  const marketWithOracle = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory)
  const market = marketWithOracle.market

  // deploy the order manager
  const verifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)
  const controller = await deployController(owner, usdc.address, dsu.address, reserve.address, marketFactory.address)
  const manager = await new Manager_Arbitrum__factory(owner).deploy(
    USDC_ADDRESS,
    dsu.address,
    DSU_RESERVE,
    marketFactory.address,
    verifier.address,
    await market.margin(),
  )

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 99_300_000, // buffer for withdrawing keeper fee from margin contract
    multiplierCalldata: 0,
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1.05'),
    bufferBase: 1_275_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1.05'),
    bufferCalldata: 35_200,
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

if (process.env.FORK_NETWORK === 'arbitrum') RunManagerTests('Manager_Arbitrum', getFixture, fundWalletDSU)
