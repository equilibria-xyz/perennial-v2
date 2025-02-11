import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { utils, BigNumber, constants } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import {
  ArbGasInfo,
  IERC20Metadata,
  IERC20Metadata__factory,
  Market__factory,
  MarketFactory,
  MarketFactory__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  IMarket,
  KeeperOracle__factory,
  KeeperOracle,
  ChainlinkFactory__factory,
  ChainlinkFactory,
  PowerTwo__factory,
  PowerTwo,
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  GuaranteeStorageLocalLib__factory,
  GuaranteeStorageGlobalLib__factory,
  OrderStorageLocalLib__factory,
  OrderStorageGlobalLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
  GasOracle,
  GasOracle__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'

const { ethers } = HRE

const CHAINLINK_VERIFIER_PROXY_ADDRESS = '0x2ff010DEbC1297f19579B4246cad07bd24F2488A'
const FEE_MANAGER_ADDRESS = '0x226D04b3a60beE1C2d522F63a87340220b8F9D6B'
const WETH_ADDRESS = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'
const CHAINLINK_ETH_USD_PRICE_FEED = '0x00027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b'
const CHAINLINK_BTC_USD_PRICE_FEED = '0x00020ffa644e6c585a5bec0e25ca476b9538198259e22b6240957720dcba0e14'
const DSU_ADDRESS = '0x5FA881826AD000D010977645450292701bc2f56D'
const CHAINLINK_ETH_USD_FEED = '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165'
const RESERVE_ADDRESS = '0x841d7C994aC0Bb17CcD65a021E686e3cFafE2118'

const listify = (...payload: string[]) => {
  return ethers.utils.defaultAbiCoder.encode(['bytes[]'], [payload])
}

const STARTING_TIME = 1702331764

// This report has timestamp 1702331770 (STARTING_TIME + 6)
const REPORT = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef50b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857a000000000000000000000000000000000000000000000000000000006577857a0000000000000000000000000000000000000000000000000000290e1acd7a0c000000000000000000000000000000000000000000000000001816de91456cdc000000000000000000000000000000000000000000000000000000006578d6fa00000000000000000000000000000000000000000000007817808f6c383900000000000000000000000000000000000000000000000000000000000000000002778bd577c983ab561189228dfd0025e625294a22e5d2d0c19daac68c3c4b12905288506779a5f3c84c61c2fad27a68604e06f05aef95d5151007266c3e956d6d00000000000000000000000000000000000000000000000000000000000000027bbc66077ec6e000a9fa723517aac6d04daa75d6c4ca486c402bbd0a4e6937cb6d204bc4dcc921f89a0783f82eeffa617dea87c99d05b666fc0658c3a37002c1',
)

// This report has timestamp 1702331772 (STARTING_TIME + 8)
const OTHER_REPORT = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef513000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857c000000000000000000000000000000000000000000000000000000006577857c00000000000000000000000000000000000000000000000000002911a02d1308000000000000000000000000000000000000000000000000001817c40b5c63a0000000000000000000000000000000000000000000000000000000006578d6fc0000000000000000000000000000000000000000000000780d34cd4db15c40000000000000000000000000000000000000000000000000000000000000000002f1946fb79ca72641ad66fe5b26473bc9e6e6a77fed9c3fb3cdefb6f647b54d3f1d3c611d622975765ee21742bbf111e2d3f3ec06b265d0b6db254e295c633f7a000000000000000000000000000000000000000000000000000000000000000233aaf619efee2f5e6f14378a186060823a8bcae776404f42aba3fd056da417395de590eec77166bcd787c45d6dc1991b305afff0d1948082bc5cf251fb379115',
)

// This report has timestamp 1702331767 (STARTING_TIME + 3)
const REPORT_BARELY_TOO_EARLY = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef501000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857700000000000000000000000000000000000000000000000000000000657785770000000000000000000000000000000000000000000000000000291166a0c38c000000000000000000000000000000000000000000000000001817c40c7c6488000000000000000000000000000000000000000000000000000000006578d6f70000000000000000000000000000000000000000000000780ddd0766c8aaafc00000000000000000000000000000000000000000000000000000000000000002c662d7b5a1b9aadc4fe78b4e0e00504465d2a53dbc6bdb3800ab624e6006621df90e6acb85877d3a0308a471e373e264e640b4939d9902b64ca02b9e8af10bfa000000000000000000000000000000000000000000000000000000000000000259c86d194b0a8a1c4894d7d38965f3d483fb7351606e8d74156da96e138d3f9e42e2d75888448ef1d6b0410d9773bfa107e9ca4dadaa724ab03bce6638f95532',
)

// This report has timestamp 1702331768 (STARTING_TIME + 4)
const REPORT_BARELY_NOT_TOO_EARLY = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef505000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b00000000000000000000000000000000000000000000000000000000657785780000000000000000000000000000000000000000000000000000000065778578000000000000000000000000000000000000000000000000000029116617d090000000000000000000000000000000000000000000000000001817c40b5c63a0000000000000000000000000000000000000000000000000000000006578d6f80000000000000000000000000000000000000000000000780dde97be00e34ee00000000000000000000000000000000000000000000000000000000000000002304ccc65d8a47be413a8f6442656a74eb5773dff9465eb7759532ec7c4a08f602a9df811c491b1c57d15baa90541e54be8f8a2be226e844fe6a943a9f3d07f0c00000000000000000000000000000000000000000000000000000000000000021b1ee4567f4ed83142df4c6526af80e54160ff5dc2097ff56542c084538f1fdc1b5e03795b14ea93f797e2d735c88ae57ebde3852e57b203e33033fb1ae13bf2',
)

// This report has timestamp 1702331774 (STARTING_TIME + 10)
const REPORT_BARELY_NOT_TOO_LATE = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef602000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857e000000000000000000000000000000000000000000000000000000006577857e00000000000000000000000000000000000000000000000000002913ab6d55f000000000000000000000000000000000000000000000000000181a478084831c000000000000000000000000000000000000000000000000000000006578d6fe000000000000000000000000000000000000000000000078073b8b050e57072000000000000000000000000000000000000000000000000000000000000000028c68627adbb1caa5ee2596b6fb56799baf4c85b02aa2544034ba2953a4e14ec4b9a367f0415de9806630c210ee3d110878efe0c62f1d75d3688c31c1825c5df50000000000000000000000000000000000000000000000000000000000000002442fe6ce68b24a7bbe60cdc642ba7c89c1b5c48c3abcd71f174cbf71375d6d574d2c796703d02802c3b812325a09acddf1985eaa37f3611b7e4a42414f44282f',
)

// This report has timestamp 1702331775 (STARTING_TIME + 11)
const REPORT_BARELY_TOO_LATE = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef605000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857f000000000000000000000000000000000000000000000000000000006577857f0000000000000000000000000000000000000000000000000000291361b0f08400000000000000000000000000000000000000000000000000181a478084831c000000000000000000000000000000000000000000000000000000006578d6ff00000000000000000000000000000000000000000000007808130229ab6bc000000000000000000000000000000000000000000000000000000000000000000248472c13b66cf6ed8951663781e1f0b4ba153dc17ca831cbba86a287e53c95c3e1fadefc9504ea44234c61e20f7b6a6c1badeae3b1986415f7e088ebf8cd056f000000000000000000000000000000000000000000000000000000000000000267f0700c3e7a68543b22b40a5fce3661eea8a7ad489026e83ace86ce50bd1fd669f1f3af1505499c9b4b906b40c0398747cae5e8e93872e62423c608d9999175',
)

// This report has timestamp 1702331829 (STARTING_TIME + 65)
const REPORT_AFTER_EXPIRATION = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053efe03000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b00000000000000000000000000000000000000000000000000000000657785b500000000000000000000000000000000000000000000000000000000657785b50000000000000000000000000000000000000000000000000000291715b6dd7000000000000000000000000000000000000000000000000000181beb9175a354000000000000000000000000000000000000000000000000000000006578d735000000000000000000000000000000000000000000000077fd41ab0af101000000000000000000000000000000000000000000000000000000000000000000020242f3eab889b1587f4822886c75b40e8e1624359740df27a6754a936d1bf1311a1b6b9e00b141cdc34779b6a15679d56f1517ac695cc3a84ec661e3afbcd81700000000000000000000000000000000000000000000000000000000000000022c92120d64be2434a34b0a36bdd380f151348e0140a08cc95a513d82941f98c16cef0438d6705290735f6574eaad6746efe23b1cb03e5f8deb186b6b6cc25b86',
)

// This report has timestamp 1702331929 (STARTING_TIME + 165)
const REPORT_WAY_AFTER_EXPIRATION = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053f0d0f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577861900000000000000000000000000000000000000000000000000000000657786190000000000000000000000000000000000000000000000000000291cb5b809ac00000000000000000000000000000000000000000000000000181fbf77726244000000000000000000000000000000000000000000000000000000006578d799000000000000000000000000000000000000000000000077ecd6e493280d47c000000000000000000000000000000000000000000000000000000000000000025716e3db33167d10c7552eb163e276113e1a73a9084cf13a4364028050bf37d774efd331eb09a50e0854a7c584b4572402e018802a1bf9dfcbeec0a4aaf68c5d000000000000000000000000000000000000000000000000000000000000000233c50092914ef7968b7a484ee4b737305949b0e3e39780009dcb54f88664e2440ef1151e7a3ac86db71c3df57ddd0617cb80212f0d60bab50050be2b1e1a4a15',
)

// This is a batch report with timestamp 1704333203 containing an ETH and BTC report.
const REPORT_BATCH = listify(
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd0000000000000000000000000000000000000000000000000000000009c40f08000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b0000000000000000000000000000000000000000000000000000000065960f930000000000000000000000000000000000000000000000000000000065960f930000000000000000000000000000000000000000000000000000292604ff2e10000000000000000000000000000000000000000000000000001950c035f9324c0000000000000000000000000000000000000000000000000000000065976113000000000000000000000000000000000000000000000077d1b4f4cc3c842d200000000000000000000000000000000000000000000000000000000000000002e532297b045dabb82a84764e76fb18a59891ad213026e5cacef03b10a952f3b6bd11b687d7cfa9a66798d5efe4b759892f00198a70727735337706c4bd16657300000000000000000000000000000000000000000000000000000000000000021edb9edb5ff34595d4ea17051b7e5f4d52d5ac64cc1f3bcbb38232c1cb1b004a43c4f06c7ac086e8e42b7e543b04f013d0e197b27abdd1561ad492889ae61416',
  '0x0006bfeb89d539d1b9f9aa08040bb140463cbb99008b59b87575be894350746800000000000000000000000000000000000000000000000000000000098dfb04000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000020ffa644e6c585a5bec0e25ca476b9538198259e22b6240957720dcba0e140000000000000000000000000000000000000000000000000000000065960f930000000000000000000000000000000000000000000000000000000065960f9300000000000000000000000000000000000000000000000000002926163e15b00000000000000000000000000000000000000000000000000019507e7bb2b82c000000000000000000000000000000000000000000000000000000006597611300000000000000000000000000000000000000000000090c64f9c720a166330000000000000000000000000000000000000000000000000000000000000000023692669bd3adc490c2c5e33856d4704b024935267f40b921eaa8090e33ff3b892155766960ce36c579f923223a3b9014c238ac9deffe319d717d975cd4d1f39600000000000000000000000000000000000000000000000000000000000000025586185c2fb0460cfefab602b667ec43ceadcf521d5b91408ddc21edcc85d4a12995154c1afb96a4b2d9b67e001e7a96c5fefb2f1798d00b0e759c594a0cea26',
)
const BATCH_STARTING_TIME = 1704333203 - 6

const getFee = (data: string) => {
  let fee = BigNumber.from(0)
  const payloads = ethers.utils.defaultAbiCoder.decode(['bytes[]'], data)[0]
  for (const payload of payloads) {
    const report = ethers.utils.defaultAbiCoder.decode(
      ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
      payload,
    )[1]
    fee = fee.add(
      ethers.utils.defaultAbiCoder.decode(
        ['bytes32', 'uint32', 'uint32', 'uint192', 'uint192', 'uint32', 'uint192'],
        report,
      )[3],
    )
  }
  return fee
}

const getPrices = (data: string) => {
  const payloads = ethers.utils.defaultAbiCoder.decode(['bytes[]'], data)[0]
  const prices: BigNumber[] = []
  for (const payload of payloads) {
    const report = ethers.utils.defaultAbiCoder.decode(
      ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
      payload,
    )[1]
    const price = ethers.utils.defaultAbiCoder.decode(
      ['bytes32', 'uint32', 'uint32', 'uint192', 'uint192', 'uint32', 'uint192'],
      report,
    )[6]
    prices.push(BigNumber.from(price).div(1e12))
  }
  return prices
}

const testOracles = [
  {
    name: 'KeeperOracle',
    Oracle: KeeperOracle__factory,
    gasMock: async () => {
      const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
        address: '0x000000000000000000000000000000000000006C',
      })
      gasInfo.getL1BaseFeeEstimate.returns(0)
    },
  },
]

export async function fundWallet(dsu: IERC20Metadata, wallet: SignerWithAddress): Promise<void> {
  const dsuMinter = await impersonateWithBalance(RESERVE_ADDRESS, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await dsuMinter.sendTransaction({
    to: dsu.address,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [utils.parseEther('200000')]),
  })
  await dsu.connect(dsuMinter).transfer(wallet.address, utils.parseEther('200000'))
}

testOracles.forEach(testOracle => {
  describe(testOracle.name, () => {
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let commitmentGasOracle: GasOracle
    let settlementGasOracle: GasOracle
    let oracle: Oracle
    let oracleBtc: Oracle
    let keeperOracle: KeeperOracle
    let keeperOracleBtc: KeeperOracle
    let chainlinkOracleFactory: ChainlinkFactory
    let oracleFactory: OracleFactory
    let marketFactory: MarketFactory
    let market: IMarket
    let marketBtc: IMarket
    let dsu: IERC20Metadata
    let powerTwoPayoff: PowerTwo

    const fixture = async () => {
      await time.reset()
      ;[owner, user] = await ethers.getSigners()

      dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
      await fundWallet(dsu, user)

      powerTwoPayoff = await new PowerTwo__factory(owner).deploy()

      const oracleImpl = await new Oracle__factory(owner).deploy()
      oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
      await oracleFactory.initialize()
      await oracleFactory.connect(owner).updateParameter({
        maxGranularity: 10000,
        maxSettlementFee: parse6decimal('1000'),
        maxOracleFee: parse6decimal('0.5'),
      })

      commitmentGasOracle = await new GasOracle__factory(owner).deploy(
        CHAINLINK_ETH_USD_FEED,
        8,
        1_000_000,
        ethers.utils.parseEther('1.02'),
        1_000_000,
        0,
        0,
        0,
      )
      settlementGasOracle = await new GasOracle__factory(owner).deploy(
        CHAINLINK_ETH_USD_FEED,
        8,
        200_000,
        ethers.utils.parseEther('1.02'),
        500_000,
        0,
        0,
        0,
      )

      const keeperOracleImpl = await new testOracle.Oracle(owner).deploy(60)
      chainlinkOracleFactory = await new ChainlinkFactory__factory(owner).deploy(
        CHAINLINK_VERIFIER_PROXY_ADDRESS,
        FEE_MANAGER_ADDRESS,
        WETH_ADDRESS,
        commitmentGasOracle.address,
        settlementGasOracle.address,
        keeperOracleImpl.address,
      )
      await chainlinkOracleFactory.initialize(oracleFactory.address)
      await oracleFactory.register(chainlinkOracleFactory.address)
      await chainlinkOracleFactory.register(powerTwoPayoff.address)

      keeperOracle = testOracle.Oracle.connect(
        await chainlinkOracleFactory.callStatic.create(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED, {
          provider: ethers.constants.AddressZero,
          decimals: 0,
        }),
        owner,
      )
      await chainlinkOracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })
      keeperOracleBtc = testOracle.Oracle.connect(
        await chainlinkOracleFactory.callStatic.create(CHAINLINK_BTC_USD_PRICE_FEED, CHAINLINK_BTC_USD_PRICE_FEED, {
          provider: ethers.constants.AddressZero,
          decimals: 0,
        }),
        owner,
      )
      await chainlinkOracleFactory.create(CHAINLINK_BTC_USD_PRICE_FEED, CHAINLINK_BTC_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })

      oracle = Oracle__factory.connect(
        await oracleFactory.callStatic.create(CHAINLINK_ETH_USD_PRICE_FEED, chainlinkOracleFactory.address, 'ETH-USD'),
        owner,
      )
      await oracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED, chainlinkOracleFactory.address, 'ETH-USD')
      oracleBtc = Oracle__factory.connect(
        await oracleFactory.callStatic.create(CHAINLINK_BTC_USD_PRICE_FEED, chainlinkOracleFactory.address, 'BTC-USD'),
        owner,
      )
      await oracleFactory.create(CHAINLINK_BTC_USD_PRICE_FEED, chainlinkOracleFactory.address, 'BTC-USD')

      const verifierImpl = await new VersionStorageLib__factory(owner).deploy()

      const marketImpl = await new Market__factory(
        {
          '@perennial/v2-core/contracts/libs/CheckpointLib.sol:CheckpointLib': (
            await new CheckpointLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/libs/InvariantLib.sol:InvariantLib': (
            await new InvariantLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/libs/VersionLib.sol:VersionLib': (
            await new VersionLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Global.sol:GlobalStorageLib': (
            await new GlobalStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
            await new MarketParameterStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Position.sol:PositionStorageGlobalLib': (
            await new PositionStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Position.sol:PositionStorageLocalLib': (
            await new PositionStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
            await new RiskParameterStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Version.sol:VersionStorageLib': (
            await new VersionStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': (
            await new GuaranteeStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': (
            await new GuaranteeStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Order.sol:OrderStorageLocalLib': (
            await new OrderStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Order.sol:OrderStorageGlobalLib': (
            await new OrderStorageGlobalLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy(verifierImpl.address)
      marketFactory = await new MarketFactory__factory(owner).deploy(
        oracleFactory.address,
        verifierImpl.address,
        marketImpl.address,
      )
      await marketFactory.initialize()
      await marketFactory.updateParameter({
        maxFee: parse6decimal('0.01'),
        maxLiquidationFee: parse6decimal('5'),
        maxCut: parse6decimal('0.50'),
        maxRate: parse6decimal('10.00'),
        minMaintenance: parse6decimal('0.01'),
        minEfficiency: parse6decimal('0.1'),
        referralFee: 0,
        minScale: parse6decimal('0.001'),
        maxStaleAfter: 7200,
      })

      const riskParameter = {
        margin: parse6decimal('0.3'),
        maintenance: parse6decimal('0.3'),
        takerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('1000'),
        },
        makerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('1000'),
        },
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('5'),
        utilizationCurve: {
          minRate: 0,
          maxRate: parse6decimal('5.00'),
          targetRate: parse6decimal('0.80'),
          targetUtilization: parse6decimal('0.80'),
        },
        pController: {
          k: parse6decimal('40000'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
        minMargin: parse6decimal('5'),
        minMaintenance: parse6decimal('5'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }
      const marketParameter = {
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        oracleFee: 0,
        riskFee: 0,
        makerFee: 0,
        takerFee: 0,
        maxPendingGlobal: 8,
        maxPendingLocal: 8,
        maxPriceDeviation: parse6decimal('0.1'),
        closed: false,
        settle: false,
      }
      market = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracle.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracle.address,
      })
      await market.updateParameter(marketParameter)
      await market.updateRiskParameter(riskParameter)
      marketBtc = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracleBtc.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracleBtc.address,
      })
      await marketBtc.updateParameter(marketParameter)
      await marketBtc.updateRiskParameter(riskParameter)

      await keeperOracle.register(oracle.address)
      await oracle.register(market.address)
      await keeperOracleBtc.register(oracleBtc.address)
      await oracleBtc.register(marketBtc.address)

      const dsuMinter = await impersonateWithBalance(RESERVE_ADDRESS, utils.parseEther('10'))
      const mintAbi = ['function mint(uint256 amount) external']
      const dsuMinterContract = new ethers.Contract(DSU_ADDRESS, mintAbi, dsuMinter)
      await dsuMinterContract.mint(utils.parseEther('100000'))
      await dsu.connect(dsuMinter).transfer(oracleFactory.address, utils.parseEther('100000'))

      await dsu.connect(user).approve(market.address, constants.MaxUint256)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
      await time.increaseTo(STARTING_TIME - 2)
      await testOracle.gasMock()

      // set the oracle parameters at STARTING_TIME - 1
      await time.includeAt(async () => {
        await chainlinkOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)
        await chainlinkOracleFactory.commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME - 1, REPORT, {
          value: getFee(REPORT),
        })
      }, STARTING_TIME - 1)

      // run tests at STARTING_TIME
    })

    describe('Factory', async () => {
      context('#initialize', async () => {
        it('reverts if already initialized', async () => {
          const chainlinkOracleFactory2 = await new ChainlinkFactory__factory(owner).deploy(
            CHAINLINK_VERIFIER_PROXY_ADDRESS,
            FEE_MANAGER_ADDRESS,
            WETH_ADDRESS,
            commitmentGasOracle.address,
            settlementGasOracle.address,
            await chainlinkOracleFactory.implementation(),
          )
          await chainlinkOracleFactory2.initialize(oracleFactory.address)
          await expect(chainlinkOracleFactory2.initialize(oracleFactory.address))
            .to.be.revertedWithCustomError(chainlinkOracleFactory2, 'InitializableAlreadyInitializedError')
            .withArgs(1)
        })
      })

      context('#create', async () => {
        it('cant recreate price id', async () => {
          await expect(
            chainlinkOracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED, {
              provider: powerTwoPayoff.address,
              decimals: -3,
            }),
          ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'KeeperFactoryAlreadyCreatedError')
        })

        it('reverts when not owner', async () => {
          await expect(
            chainlinkOracleFactory.connect(user).create(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED, {
              provider: powerTwoPayoff.address,
              decimals: -3,
            }),
          ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'OwnableNotOwnerError')
        })
      })
    })

    describe('#commit', async () => {
      it('commits successfully and incentivizes the keeper', async () => {
        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('10'),
                false,
              ),
          STARTING_TIME,
        )
        expect(await keeperOracle.localCallbacks(STARTING_TIME)).to.deep.eq([user.address])

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
            value: getFee(REPORT),
            maxFeePerGas: 100000000,
          }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrices(REPORT)[0], true])

        const reward = utils.parseEther('0.547375')
        expect(await dsu.balanceOf(user.address)).to.be.equal(
          utils.parseEther('200000').sub(utils.parseEther('10')).add(reward),
        )

        expect((await market.position()).timestamp).to.equal(STARTING_TIME)
      })

      it('rejects invalid update data', async () => {
        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('10'),
                false,
              ),
          STARTING_TIME,
        )
        expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, '0x', {
            value: 1,
          }),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
      })

      it('can update multiple from batched update', async () => {
        await time.includeAt(
          async () =>
            await chainlinkOracleFactory.commit(
              [CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_BTC_USD_PRICE_FEED],
              BATCH_STARTING_TIME - 1,
              REPORT_BATCH,
              { value: getFee(REPORT_BATCH) },
            ),
          BATCH_STARTING_TIME - 1,
        )

        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('10'),
                false,
              ),
          BATCH_STARTING_TIME,
        )

        await chainlinkOracleFactory
          .connect(user)
          .commit([CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_BTC_USD_PRICE_FEED], BATCH_STARTING_TIME, REPORT_BATCH, {
            value: getFee(REPORT_BATCH),
          })

        const [ethPrice, btcPrice] = getPrices(REPORT_BATCH)

        expect((await keeperOracle.latest()).timestamp).to.equal(BATCH_STARTING_TIME)
        expect((await keeperOracle.latest()).valid).to.equal(true)
        const [latestIndexEth] = await keeperOracle.status()
        expect(latestIndexEth.valid).to.be.true
        expect(latestIndexEth.price).to.equal(ethPrice)

        expect((await keeperOracleBtc.latest()).timestamp).to.equal(BATCH_STARTING_TIME)
        expect((await keeperOracleBtc.latest()).valid).to.equal(true)
        const [latestIndexBtc] = await keeperOracleBtc.status()
        expect(latestIndexBtc.valid).to.be.true
        expect(latestIndexBtc.price).to.equal(btcPrice)

        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)

        // Even though there are two updates, only one was requested so we
        // should only receive half of the fee.
        const reward = utils.parseEther('0.100972')
        expect(await dsu.balanceOf(user.address)).to.be.within(
          utils.parseEther('200000').sub(utils.parseEther('10')).add(1),
          utils.parseEther('200000').sub(utils.parseEther('10')).add(utils.parseEther('1')),
        )
      })
    })
  })
})
