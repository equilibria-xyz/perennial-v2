import { ethers } from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'

import { IERC20Metadata__factory, IKeeperOracle } from '../../../../types/generated'

import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_RESERVE,
  fundWalletDSU,
  fundWalletUSDC,
  PYTH_ADDRESS,
  USDC_ADDRESS,
} from '../../../helpers/arbitrumHelpers'
import { deployPythOracleFactory } from '../../../helpers/setupHelpers'
import { parse6decimal } from '../../../../../common/testutil/types'
import { advanceToPrice as advanceToPriceImpl, createPythOracle } from '../../../helpers/oracleHelpers'
import { time } from '../../../../../common/testutil'

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

let keeperOracle: IKeeperOracle
let lastPrice: BigNumber = utils.parseEther('2620.237388') // advanceToPrice converts to 6 decimals

const fixture = async (): Promise<InstanceVars> => {
  // get users and token addresses
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  // deploy perennial core factories
  const vars = await deployProtocol(dsu, usdc, constants.AddressZero, DSU_RESERVE, CHAINLINK_ETH_USD_FEED)

  // fund wallets used in the tests
  await fundWalletDSU(user, utils.parseEther('2000000'))
  await fundWalletDSU(userB, utils.parseEther('2000000'))
  await fundWalletDSU(userC, utils.parseEther('2000000'))
  await fundWalletDSU(userD, utils.parseEther('2000000'))
  await fundWalletUSDC(user, parse6decimal('1000'))
  await fundWalletDSU(liquidator, utils.parseEther('2000000'))
  await fundWalletDSU(perennialUser, utils.parseEther('14000000'))

  // configure this deployment with a pyth oracle
  const pythOracleFactory = await deployPythOracleFactory(
    owner,
    vars.oracleFactory,
    PYTH_ADDRESS,
    CHAINLINK_ETH_USD_FEED,
  )
  await vars.oracleFactory.connect(owner).register(pythOracleFactory.address)
  const [keeperOracle_, oracle] = await createPythOracle(
    owner,
    vars.oracleFactory,
    pythOracleFactory,
    PYTH_ETH_USD_PRICE_FEED,
    'ETH-USD',
  )
  keeperOracle = keeperOracle_
  await keeperOracle.register(oracle.address)
  vars.oracle = oracle

  return vars
}

async function getFixture(): Promise<InstanceVars> {
  const vars = loadFixture(fixture)
  return vars
}

async function advanceToPrice(price?: BigNumber): Promise<void> {
  // send oracle fee to an unused user
  const [, , , , , , , , oracleFeeReceiver] = await ethers.getSigners()
  // note that in Manager tests, I would set timestamp to oracle.current() where not otherwise defined
  const current = await time.currentBlockTimestamp()
  const latest = (await keeperOracle.global()).latestVersion
  const next = await keeperOracle.next()
  const timestamp = next.eq(constants.Zero) ? BigNumber.from(current) : next
  // console.log( 'current', current, 'latest', latest.toString(), 'next', next.toString(), 'advancing to price at', timestamp.toString())
  // adjust for payoff and convert 18-decimal price from tests to a 6-decimal price
  // TODO: seems dirty that the test is running the payoff;
  // we should commit a raw price and let the oracle process the payoff
  if (price) lastPrice = price.mul(price).div(utils.parseEther('1')).div(100000).div(1e12)
  await advanceToPriceImpl(keeperOracle, oracleFeeReceiver, timestamp, lastPrice)
}

if (process.env.FORK_NETWORK === 'arbitrum') {
  // TODO: need a chain-agnostic sub-oracle implementation in Vaults
  // RunInvokerTests(getFixture, createInvoker, fundWalletDSU, fundWalletUSDC, advanceToPrice)
  RunOrderTests(getFixture, createInvoker, advanceToPrice, false)
  RunPythOracleTests(getFixture, createInvoker)
}
