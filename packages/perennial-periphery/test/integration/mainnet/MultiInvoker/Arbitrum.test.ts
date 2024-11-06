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
import {
  advanceToPrice as advanceToPriceImpl,
  createPythOracle,
  PYTH_ETH_USD_PRICE_FEED,
} from '../../../helpers/oracleHelpers'
import { time } from '../../../../../common/testutil'
import { KeeperOracle, PythFactory } from '@perennial/v2-oracle/types/generated'

let pythOracleFactory: PythFactory
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
  pythOracleFactory = await deployPythOracleFactory(owner, vars.oracleFactory, PYTH_ADDRESS, CHAINLINK_ETH_USD_FEED)
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

async function getKeeperOracle(): Promise<[PythFactory, KeeperOracle]> {
  return [pythOracleFactory, keeperOracle]
}

async function advanceToPrice(price?: BigNumber): Promise<void> {
  // send oracle fee to an unused user
  const [, , , , , , , , oracleFeeReceiver] = await ethers.getSigners()
  // note that in Manager tests, I would set timestamp to oracle.current() where not otherwise defined
  const current = await time.currentBlockTimestamp()
  const latest = (await keeperOracle.global()).latestVersion
  const next = await keeperOracle.next()
  const timestamp = next.eq(constants.Zero) ? BigNumber.from(current) : next
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
  RunPythOracleTests(getFixture, createInvoker, getKeeperOracle, fundWalletDSU, {
    startingTime: 1723858683, // VAA timestamp minus 5 seconds
    vaaValid:
      '0x504e41550100000003b801000000040d002f4dc63fca5732120cb53136f47b5459672e018c95c1fb6441fbcd2705fad05859cd99824c6818706dc583c1886afb1b9d0e40694123616cf1803e27b8ccdde00102a8dc5a440ca889a0c7ebcb22478379a2fd7520b39ff1ff6ec90d8f359230ade73d7af85bd6a83e767133d56d653c1e81f806be3a12ec60501776b0ffb844144800037e86b7837a223b2f2b8a59e06d6ee919a1996f497e656e2b47eef495a735c2ac52e13596135bd3f5a1a66d8b0c84f0293510b7ee95740c7eddd023bab00cd8f5010428ec0d6291675b2e93163371b7d96edcaa06f4330f532f5320f2eb2278f816ca13cdd4acedc0243fcfb818dce916bea3ed9b8fee98e8021406567c3893727e8a01067ac3e051df62d754bf699b5f958f94d5796ea39272749bc31d484f558b2dc4c8269bad6e9742d69f046129caec1c0e7c97177624214ecda6e66955a0040117b70108922b36c843c074461e7af2c61bb8bda682dbca845d7e1c4b3991da42387802a8029b90564c99a966a2efc1e5dadb69790e31754af675b252d5b0aee2c385dc1d000ac0146223f4a14ccc9886d225e7775175ac0d2aa1d039b598044d7aa70aa4d04f1f19417352b6e2f0dbd9ea6ea38697cd25ac1c52df121b15e73e356e988685a8000b83df9d9cf96330fe80ce5e3927379cd3b04881cacf7e74a7e7a55b1654d83aee12a9bbf8251a98e2298498119c6f18bb0c8d5ee52a9b375c6de3dc42fd344c15010c2d33b5d7bea238749c167b42dc9464bd7d520d92c80f4862f11af32792f55d770f8461a1291b49aead4f9e7a9811a1cf9104072555833a767bf8a8f834990bf1000dd22e1937a6bb88f3ce9029366ff5b51a49224c36198f6fa1728c514faa156de854388c870054cb7aee2c1368a47eac2324cc5272ce50d3866e628ddf8fabd11a000edbaec91df28b19eb3e80361951867249691ac3c18f53e0ef1792f1106f78087a64ada105f7beedbdea5635310d8c5453382062d412b3fb153242eedd61ecdf580110cba00656a0d411f60a62f94216cfbdaf82842ae24cbba033d8cbdfa6875fa3c93fffa44d66d8ca1301043a536949c6e7002968d0e2ab9a8ffd332504cd7ca297001263fe74c229491a302fdaaf2cb193e56faf98e7d78d2656bb202808d74ed8a76b2e05ab80341ebc2c82dc5849957e088568fb78253d9bf40cfbfce71fc1530cdc0166bfff0000000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000046fb5f101415557560000000000097a65b7000027107a865828bf3ed10f14356dd6bb0eac1cf4b50e9701005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003ca2457a2000000000067274c4fffffff80000000066bfff000000000066bffeff0000003c84cb2aa800000000081f90b50b1498e5d3a3b94f82eb1dd34232015a41e0cf28979f8667b996110332793adfafd02d21637b4c5cc8b1c6b09d57b5738cbd1f9aac05b0b186f21428ee64e901b13062cc7dbc07ac45636614e319f94308e9f93bad524e32f9122f42fbd719b0f29b9b54d93ea23a6e61dfe313013dd5d04b01c328fd99f1a17dcb697491c8fab86faecc97ea45e867f78211fb22055cabd2c05db2a0169f5ab929598342002a473236e65e4c4cee85e0d10bc2881c9c44b78b248ff235796c9ec2df3b8781879d96c6e145b820427aec8493c43dd4e3eee455e4e5b8d040d511d36350',
    vaaInvalid:
      '0x504e41550100000002b801000000040d00ab5c0aed0489c7d5d31eda6247896d874d7f47ed69f7d01b3567fc9d9b7eb1ff01a09c90fd2834703ce53ac039381abbf8370f5129136d19181f0348de96db9701020ba8589c4f108eeaa6adf6aae6a3c87e0fb6908637c044402724d34c62974d9b7486aeb7b65db94f500869a18c661bd69bebf1d76c347c1712929064145ee58400038158efbca5e8235db07960ee4fea2b7252630ba7129464c894e90ad7d13604b352654fe8c84dc004dbeb1f1cfc5bdb68670cb7009ab509e167e796ac5ffbfd95010439159a1f75ade924363b7a11a5317dbc0568dd3fc1dc533af3e614de39e6754361b35758e70943cd40b56785531818d7885cb64d2c2831d772d9ce5cbc7aa506000616222e37eaffeb56200e4c61bf72dcf36f0d062c9c5f9284c44315aca3637af0779ee9590ed3f0ba4178430fbd5da6c778001990a1392e3ed6146b9a2da0c390000a02610dd5a114ffa1e59abe840accab50b7fdc3d15369b5a5955fd323462cb0c85f03c5bbb9f840f909e2a9469a2ff92526ccaa13674095825f3f2ae32f1395b1000bec2ef0ef1bbc4c74a0e4450eccfe2e55aad7cddff5e95ac0ba7ccbb39d1f6a8d3b0b4f72abe3cfa8b9ea1c912638212e5fb9592de5c84043082fce8f2cab3d26000c7f89f8dbecfcc971777cb99a3bfd3491a0ac5609006d5ac41583504cd95ecf0e4877478443c215dc37a1c47e7026fa279333ce0db6d4e05757c6527b6116dd3a000d874b27a2bf8a6d3587c1532c0ce5ddc6d4a851aaf4ac506249afe886183148cf0ec16d4813f1b829c9986e66035ec25d77e04aa8971b96fa8ed275c3ad290910000e0c13de0c6b70023eec852d8de758918a899b4f67646521c6b3ab242808225cde6c9aa6fcefafdfed8e108756ed658070bae1898f3db4f89fad291d77f560ce15010ff2508f5461da25d2d2855f4952f1739aa89a901a1e544ed1e3565d93bb51831a55d469019cbfb11c5d9b8ed9152e4062a68dc1016e99e42f942153cbfad654b30110555484fccf71c1a425fc302d00d2b70702c9a1cc5fb4067276e83fb0c115745a7f3e951776cd2419820217c7de143e62785b639016103ee5fb97d3e3f972943d0112659491cbd292db6fc532ed1844e34ab98f30363ac5e1ff7cc9e8e1b6fa7121a3359feb1dd5f94cb66439b783d1b631e98af941522ac0aa5566126e6180c37b690166bff9f800000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000046fa99901415557560000000000097a595f0000271038c7055c548fcde90866a904c9746fe4f4e6b2ad01005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003c9c51ba330000000009fe0b10fffffff80000000066bff9f80000000066bff9f70000003c7a9f5c70000000000827e3f60b6a0d29eef98201a8258ff303e58313d40fc0b5d68b6558a43e1eb06ab700e07efd81b1b0bc79c8a5e556c49d671366c7e24a0bbf9f857b50fbfcb94d196450b331913d5bce594b576d8161ead4fc1c9f1e964c79e29eba8110d4b6ffcd4b5619f7b2b7f37ea93573a621589e527a3befe1dbcf5e0f9d5628b79ae3b110a0ce65faff7f66878b33be3d5f9b5a74c7c50aa7e7240c86f64a058882e868b569bb6a9cbdcb3c071ea3f9d6d8d39ef6b87d01a0327e852469116ca5878f6f441fc09cef6a38a48d4c284eb903217cb5a3173fe276f1e27f151a8d83184071',
  })
}
