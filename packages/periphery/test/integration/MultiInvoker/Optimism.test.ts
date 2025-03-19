import { deployments, ethers } from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { time } from '../../../../common/testutil'
import { parse6decimal } from '../../../../common/testutil/types'

import { IERC20Metadata__factory, IKeeperOracle, KeeperOracle, PythFactory } from '../../../types/generated'

import { RunInvokerTests } from './Invoke.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'
import { CHAINLINK_ETH_USD_FEED, fundWalletDSU, fundWalletUSDC, mockGasInfo } from '../../helpers/baseHelpers'
import {
  advanceToPrice as advanceToPriceImpl,
  createPythOracle,
  deployPythOracleFactory,
  PYTH_ETH_USD_PRICE_FEED,
} from '../../helpers/oracleHelpers'

const ORACLE_STARTING_TIMESTAMP = BigNumber.from(1728924890)

const INITIAL_ORACLE_VERSION_ETH = {
  timestamp: ORACLE_STARTING_TIMESTAMP,
  price: BigNumber.from('2621322220'),
  valid: true,
}

const INITIAL_ORACLE_VERSION_BTC = {
  timestamp: ORACLE_STARTING_TIMESTAMP,
  price: BigNumber.from('65631250000'),
  valid: true,
}

let pythOracleFactory: PythFactory
let keeperOracle: IKeeperOracle
let lastPrice: BigNumber = utils.parseEther('2620.237388') // advanceToPrice converts to 6 decimals
let vars: InstanceVars

const fixture = async (): Promise<InstanceVars> => {
  // get users and token addresses
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)
  // deploy perennial core factories
  vars = await deployProtocol(
    dsu,
    usdc,
    constants.AddressZero,
    (
      await deployments.get('DSUReserve')
    ).address,
    CHAINLINK_ETH_USD_FEED,
  )

  // fund wallets used in the tests
  await fundWalletDSU(user, utils.parseEther('2000000'))
  await fundWalletDSU(userB, utils.parseEther('2000000'))
  await fundWalletDSU(userC, utils.parseEther('2000000'))
  await fundWalletDSU(userD, utils.parseEther('2000000'))
  await fundWalletUSDC(user, parse6decimal('1000'))
  await fundWalletDSU(liquidator, utils.parseEther('2000000'))
  await fundWalletDSU(perennialUser, utils.parseEther('14000000'))

  // configure this deployment with a pyth oracle
  pythOracleFactory = await deployPythOracleFactory(owner, vars.oracleFactory, CHAINLINK_ETH_USD_FEED)
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

  await mockGasInfo()

  return vars
}

async function advanceToPrice(price?: BigNumber): Promise<void> {
  // send oracle fee to an unused user
  const [, , , , , , , , oracleFeeReceiver] = await ethers.getSigners()
  // note that in Manager tests, I would set timestamp to oracle.current() where not otherwise defined
  const current = await time.currentBlockTimestamp()
  const next = await keeperOracle.next()
  const timestamp = next.eq(constants.Zero) ? BigNumber.from(current) : next
  // mainnet setup mocks the post-payoff price, so here we adjust for payoff and
  // convert 18-decimal price sent from tests to a 6-decimal price committed to keeper oracle
  if (price) lastPrice = price.mul(price).div(utils.parseEther('1')).div(100000).div(1e12)
  await advanceToPriceImpl(keeperOracle, oracleFeeReceiver, timestamp, lastPrice)
}

async function getFixture(): Promise<InstanceVars> {
  return loadFixture(fixture)
}

async function getKeeperOracle(): Promise<[PythFactory, KeeperOracle]> {
  return [pythOracleFactory, keeperOracle]
}

if (process.env.FORK_NETWORK === 'base') {
  RunInvokerTests(
    getFixture,
    createInvoker,
    fundWalletDSU,
    fundWalletUSDC,
    advanceToPrice,
    INITIAL_ORACLE_VERSION_ETH,
    INITIAL_ORACLE_VERSION_BTC,
  )
  RunPythOracleTests(getFixture, createInvoker, getKeeperOracle, fundWalletDSU, {
    startingTime: 1728924994, // block time at oracle creation 1728924890, VAA for 1728925000
    vaaValid:
      '0x504e41550100000003b801000000040d00b7af440c62789bc5ae21bfba35ec919b1ecafdf32ed5e0aa6c5b51a9e009a3d641d759da58b8f72cbcb5ae8c21144bf5520380bdad672f445c80602fe110e5cc0002c3ceb1a270f133f5bf3d22c61d3416eddbbd00e61451a6f645db526739177d7963e10129f56d869e8d766e34321b98dfcd9d7b362db899e3c6afabd48b0c2215000461ed9229ccada1cacd2cdf2bb9eda70d6c53188aa5eccf1be41d0949106365de00370f15d194ae7b9f41795f44781b980bc67c9e0e8e9588f1b07fecc0e16700010622aaf062e5f9c1e5d7ec7805bd48f51f751d2a8b36c80fee48280eb079a8495e03bccd50f8e4e6516c42bf2a3ff696b3d6902a0b2009fd9db589c0fa05c1b102000ab7c677696a9d81b60bfa20a761c9c2f83888f6561b6cbaead695de3ca412699a7b79bbdd8f03829c3afdc6f19584811cf82163100953a0fd57e569d7f49a2e9b000b0a332f5963ee91b485b432cdcc9d4f1a03a9a1c31bd3cbf6edd6bebaeb79945f106198862fde7d7abeaa93bc343e4a1a9ce8764487a6fe5065e152402a97fb07000cec5de9803aecb6fe861d5150cd58af2bec9ee5de2dd7dc58be84c751ea86006d079b326ce48c88a093ee559f64e15bf6cad6d5a014184818bc45fb64ffbd296d000d356e6ffa16f825684da5c325b43d4bfb23c756d35f22fa104984f5b4c781079906e45d8ea171c628d42d6e0dae560dfd9bed7643724462648d4f8e1ebfdd52f7010e2789a665311149c1217c06c7a6fb2122efaedd5d14337da253f36661e450a93d432b553e591084969186b9b9ffded202ab57c2c0047045034ea2d89131c7a501000fa39aba1ace6519331a0d45046216890965834fa380e3ae380f40b1447a21cd1f2b06f15c0188c7d4c4fb6565dd670f52ad57aed6ce4e21de07b034e9c0762bd3001008c990c275f800bdbb30de332a542627e22114ca0cda6c67794e6546fc09a7886cca01e67f3b4ef7c597e5b5d57de426e249690ed831d6c62f41031d16778298011144b703ac76ed98482be4523a5e6dccd23967280d63246d144574756a5a873c8638ac55ce588df083adfb634f3760aac171c4a3699495bb85f4135b1054c02841011241d8f449dab3ccea27ee486849237c51e84d088b5b3fdeda8f5232ae4bfe38b118d0b0c94c1e684123c3f0723c042f10655a8486a0f6a030907ec6cf52d8c7bb01670d4d4800000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71000000000529c71a014155575600000000000a35f56c0000271089f5c5e3f40f23427dffa611a0d74dd87862a60001005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003cf5d64ca0000000000761f678fffffff800000000670d4d4800000000670d4d470000003d07c2f7d800000000085b87d70aa34d1145d15dbacf774221c73fe46c9975ae2355937e90e1323c58beaf0162b371ad3c0d475a888c287bbf60e18dce85971a6935a194997790bb2596ef5d2da16a15b2ef7aa3ed99a0367166199c49defd474d68ce588638ba11e5cdf86c588dbc82a76c0325e8e5d30b6c753b27826a3ef2c6dcb5052ffb5c9c3d9a173261e127c88201e0b64af48067020afbaf9822deb33875b9cf214bb9ded8ee80473a482dfa6cbcaa6fb3f2b446c9a84e0c7bc440e78a56bc409bcdbdb6fb28d00343d15d162a2f377a3e1e',
    vaaInvalid:
      '0x505e41550100000003b801000000040d00b7af440c62789bc5ae21bfba35ec919b1ecafdf32ed5e0aa6c5b51a9e009a3d641d759da58b8f72cbcb5ae8c21144bf5520380bdad672f445c80602fe110e5cc0002c3ceb1a270f133f5bf3d22c61d3416eddbbd00e61451a6f645db526739177d7963e10129f56d869e8d766e34321b98dfcd9d7b362db899e3c6afabd48b0c2215000461ed9229ccada1cacd2cdf2bb9eda70d6c53188aa5eccf1be41d0949106365de00370f15d194ae7b9f41795f44781b980bc67c9e0e8e9588f1b07fecc0e16700010622aaf062e5f9c1e5d7ec7805bd48f51f751d2a8b36c80fee48280eb079a8495e03bccd50f8e4e6516c42bf2a3ff696b3d6902a0b2009fd9db589c0fa05c1b102000ab7c677696a9d81b60bfa20a761c9c2f83888f6561b6cbaead695de3ca412699a7b79bbdd8f03829c3afdc6f19584811cf82163100953a0fd57e569d7f49a2e9b000b0a332f5963ee91b485b432cdcc9d4f1a03a9a1c31bd3cbf6edd6bebaeb79945f106198862fde7d7abeaa93bc343e4a1a9ce8764487a6fe5065e152402a97fb07000cec5de9803aecb6fe861d5150cd58af2bec9ee5de2dd7dc58be84c751ea86006d079b326ce48c88a093ee559f64e15bf6cad6d5a014184818bc45fb64ffbd296d000d356e6ffa16f825684da5c325b43d4bfb23c756d35f22fa104984f5b4c781079906e45d8ea171c628d42d6e0dae560dfd9bed7643724462648d4f8e1ebfdd52f7010e2789a665311149c1217c06c7a6fb2122efaedd5d14337da253f36661e450a93d432b553e591084969186b9b9ffded202ab57c2c0047045034ea2d89131c7a501000fa39aba1ace6519331a0d45046216890965834fa380e3ae380f40b1447a21cd1f2b06f15c0188c7d4c4fb6565dd670f52ad57aed6ce4e21de07b034e9c0762bd3001008c990c275f800bdbb30de332a542627e22114ca0cda6c67794e6546fc09a7886cca01e67f3b4ef7c597e5b5d57de426e249690ed831d6c62f41031d16778298011144b703ac76ed98482be4523a5e6dccd23967280d63246d144574756a5a873c8638ac55ce588df083adfb634f3760aac171c4a3699495bb85f4135b1054c02841011241d8f449dab3ccea27ee486849237c51e84d088b5b3fdeda8f5232ae4bfe38b118d0b0c94c1e684123c3f0723c042f10655a8486a0f6a030907ec6cf52d8c7bb01670d4d4800000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71000000000529c71a014155575600000000000a35f56c0000271089f5c5e3f40f23427dffa611a0d74dd87862a60001005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003cf5d64ca0000000000761f678fffffff800000000670d4d4800000000670d4d470000003d07c2f7d800000000085b87d70aa34d1145d15dbacf774221c73fe46c9975ae2355937e90e1323c58beaf0162b371ad3c0d475a888c287bbf60e18dce85971a6935a194997790bb2596ef5d2da16a15b2ef7aa3ed99a0367166199c49defd474d68ce588638ba11e5cdf86c588dbc82a76c0325e8e5d30b6c753b27826a3ef2c6dcb5052ffb5c9c3d9a173261e127c88201e0b64af48067020afbaf9822deb33875b9cf214bb9ded8ee80473a482dfa6cbcaa6fb3f2b446c9a84e0c7bc440e78a56bc409bcdbdb6fb28d00343d15d162a2f377a3e1e',
  })
}
