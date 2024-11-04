import { ethers } from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { parse6decimal } from '../../../../../common/testutil/types'

import { ChainlinkContext } from '@perennial/core/test/integration/helpers/chainlinkHelpers'
import { OracleVersionStruct } from '@perennial/oracle/types/generated/contracts/Oracle'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@perennial/oracle/util/constants'

import {
  GasOracle__factory,
  IERC20Metadata__factory,
  IOracle__factory,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle__factory,
  OracleFactory,
  PythFactory,
  PythFactory__factory,
} from '../../../../types/generated'
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
  PYTH_ADDRESS,
  USDC_ADDRESS,
} from '../../../helpers/mainnetHelpers'
import { PYTH_ETH_USD_PRICE_FEED } from '../../../helpers/oracleHelpers'

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
let vars: InstanceVars

const fixture = async (): Promise<InstanceVars> => {
  // get users and token addresses
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  // deploy perennial core factories
  vars = await deployProtocol(dsu, usdc, DSU_BATCHER, DSU_RESERVE, CHAINLINK_ETH_USD_FEED)

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

async function getKeeperOracle(): Promise<[PythFactory, KeeperOracle]> {
  if (!vars.oracleFactory || !vars.owner) throw new Error('Fixture not yet created')

  const commitmentGasOracle = await new GasOracle__factory(vars.owner).deploy(
    CHAINLINK_ETH_USD_FEED,
    8,
    1_000_000,
    utils.parseEther('1.02'),
    1_000_000,
    0,
    0,
    0,
  )
  const settlementGasOracle = await new GasOracle__factory(vars.owner).deploy(
    CHAINLINK_ETH_USD_FEED,
    8,
    200_000,
    utils.parseEther('1.02'),
    500_000,
    0,
    0,
    0,
  )
  const keeperOracleImpl = await new KeeperOracle__factory(vars.owner).deploy(60)
  const pythOracleFactory = await new PythFactory__factory(vars.owner).deploy(
    PYTH_ADDRESS,
    commitmentGasOracle.address,
    settlementGasOracle.address,
    keeperOracleImpl.address,
  )

  await pythOracleFactory.initialize(vars.oracleFactory.address)
  // TODO: move this into Pyth.test module
  await pythOracleFactory.updateParameter(1, 0, 4, 10)
  await vars.oracleFactory.register(pythOracleFactory.address)

  const keeperOracle = KeeperOracle__factory.connect(
    await pythOracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    }),
    vars.owner,
  )
  await pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
    provider: ethers.constants.AddressZero,
    decimals: 0,
  })

  vars.oracle = Oracle__factory.connect(
    await vars.oracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD'),
    vars.owner,
  )
  await vars.oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD')
  return [pythOracleFactory, keeperOracle]
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
  RunOrderTests(getFixture, createInvoker, advanceToPrice, true)
  RunPythOracleTests(getFixture, createInvoker, getKeeperOracle, fundWalletDSU)
}
