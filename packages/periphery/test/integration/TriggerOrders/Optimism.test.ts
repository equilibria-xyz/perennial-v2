import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'

import {
  IEmptySetReserve__factory,
  IERC20Metadata__factory,
  Manager_Optimism__factory,
  OrderVerifier__factory,
} from '../../../types/generated'
import { createMarketETH, deployController, deployProtocol } from '../../helpers/setupHelpers'
import { RunManagerTests } from './Manager.test'
import { FixtureVars } from './setupTypes'
import { CHAINLINK_ETH_USD_FEED, fundWalletDSU, mockGasInfo } from '../../helpers/baseHelpers'
import { deployPythOracleFactory } from '../../helpers/oracleHelpers'

const { deployments, ethers } = HRE

const fixture = async (): Promise<FixtureVars> => {
  // deploy the protocol and create a market
  const [owner, userA, userB, userC, userD, keeper, oracleFeeReceiver] = await ethers.getSigners()
  const [marketFactory, dsu, oracleFactory] = await deployProtocol(owner)
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)
  const reserve = IEmptySetReserve__factory.connect((await deployments.get('DSU')).address, owner)
  const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory, CHAINLINK_ETH_USD_FEED)
  const marketWithOracle = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory)
  const market = marketWithOracle.market

  // deploy the order manager
  const verifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)
  const controller = await deployController(owner, usdc.address, dsu.address, reserve.address, marketFactory.address)
  const manager = await new Manager_Optimism__factory(owner).deploy(
    usdc.address,
    dsu.address,
    reserve.address,
    marketFactory.address,
    verifier.address,
    await market.margin(),
  )

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 250_000, // buffer for withdrawing keeper fee from margin contract
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 1_500_000, // for price commitment
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

if (process.env.FORK_NETWORK === 'base') RunManagerTests('Manager_Optimism', getFixture, fundWalletDSU)
