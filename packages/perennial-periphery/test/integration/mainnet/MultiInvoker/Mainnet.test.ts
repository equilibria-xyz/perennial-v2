import { ethers } from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { parse6decimal } from '../../../../../common/testutil/types'

import { ChainlinkContext } from '@perennial/core/test/integration/helpers/chainlinkHelpers'
import { OracleVersionStruct } from '@perennial/oracle/types/generated/contracts/Oracle'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@perennial/oracle/util/constants'

import { IERC20Metadata__factory, IOracle__factory, IOracleProvider } from '../../../../types/generated'
import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars, resetBtcSubOracle, resetEthSubOracle } from './setupHelpers'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_BATCHER,
  DSU_RESERVE,
  fundWalletDSU,
  fundWalletUSDC,
  USDC_ADDRESS,
} from '../../../helpers/mainnetHelpers'
import { FakeContract } from '@defi-wonderland/smock'

const ORACLE_STARTING_TIMESTAMP = BigNumber.from(1646456563)

const INITIAL_ORACLE_VERSION_ETH: OracleVersionStruct = {
  timestamp: ORACLE_STARTING_TIMESTAMP,
  price: BigNumber.from('2620237388'),
  valid: true,
}

const INITIAL_ORACLE_VERSION_BTC = {
  timestamp: ORACLE_STARTING_TIMESTAMP,
  price: BigNumber.from('38838362695'),
  valid: true,
}

let chainlink: ChainlinkContext

const fixture = async (): Promise<InstanceVars> => {
  // get users and token addresses
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  // deploy perennial core factories
  const vars = await deployProtocol(dsu, usdc, DSU_BATCHER, DSU_RESERVE, CHAINLINK_ETH_USD_FEED)

  // fund wallets used in the tests
  await fundWalletDSU(user, utils.parseEther('2000000'))
  await fundWalletDSU(userB, utils.parseEther('2000000'))
  await fundWalletDSU(userC, utils.parseEther('2000000'))
  await fundWalletDSU(userD, utils.parseEther('2000000'))
  await fundWalletUSDC(user, parse6decimal('1000'))
  await fundWalletDSU(liquidator, utils.parseEther('2000000'))
  await fundWalletDSU(perennialUser, parse6decimal('14000000'))

  // configure this deployment with a chainlink oracle
  chainlink = await new ChainlinkContext(
    CHAINLINK_CUSTOM_CURRENCIES.ETH,
    CHAINLINK_CUSTOM_CURRENCIES.USD,
    { provider: vars.payoff, decimals: -5 },
    1,
  ).init(BigNumber.from(0), BigNumber.from(0))
  await vars.oracleFactory.connect(owner).register(chainlink.oracleFactory.address)
  vars.oracle = IOracle__factory.connect(
    await vars.oracleFactory.connect(owner).callStatic.create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD'),
    owner,
  )
  await vars.oracleFactory.connect(owner).create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD')

  return vars
}

async function getFixture(): Promise<InstanceVars> {
  return loadFixture(fixture)
}

async function advanceToPrice(price?: BigNumber): Promise<void> {
  if (price) await chainlink.nextWithPriceModification(() => price)
  else await chainlink.next()
}

/*async function resetSubOracles(ethSubOracle: FakeContract<IOracleProvider>, btcSubOracle: FakeContract<IOracleProvider>): Promise<void> {
  resetEthSubOracle(ethSubOracle, INITIAL_ORACLE_VERSION_ETH)
  resetBtcSubOracle(btcSubOracle, INITIAL_ORACLE_VERSION_BTC)
}*/

if (process.env.FORK_NETWORK === undefined) {
  RunInvokerTests(
    getFixture,
    createInvoker,
    fundWalletDSU,
    fundWalletUSDC,
    advanceToPrice,
    INITIAL_ORACLE_VERSION_ETH,
    INITIAL_ORACLE_VERSION_BTC,
  )
  RunOrderTests(getFixture, createInvoker, advanceToPrice)
  RunPythOracleTests(getFixture, createInvoker)
}
