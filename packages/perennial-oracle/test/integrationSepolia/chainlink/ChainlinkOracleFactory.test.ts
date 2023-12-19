import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { utils } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { currentBlockTimestamp, increase } from '../../../../common/testutil/time'
import {
  ArbGasInfo,
  IERC20Metadata,
  IERC20Metadata__factory,
  IFactory,
  Market__factory,
  MarketFactory,
  MarketFactory__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PayoffFactory,
  PayoffFactory__factory,
  IMarket,
  MarketParameterStorageLib__factory,
  RiskParameterStorageLib__factory,
  KeeperOracle__factory,
  KeeperOracle,
  ChainlinkFactory__factory,
  ChainlinkFactory,
  MilliPowerTwo__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'
import { IInstance } from '../../../types/generated/@equilibria/root/attribute/interfaces'

const { ethers } = HRE

const CHAINLINK_VERIFIER_PROXY_ADDRESS = '0x2ff010DEbC1297f19579B4246cad07bd24F2488A'
const FEE_MANAGER_ADDRESS = '0x226D04b3a60beE1C2d522F63a87340220b8F9D6B'
const WETH_ADDRESS = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'
const CHAINLINK_ETH_USD_PRICE_FEED = '0x00027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b'
const DSU_ADDRESS = '0x5FA881826AD000D010977645450292701bc2f56D'
const USDC_ADDRESS = '0x16b38364bA6f55B6E150cC7f52D22E89643f3535'
const CHAINLINK_ETH_USD_FEED = '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165'
const RESERVE_ADDRESS = '0x841d7C994aC0Bb17CcD65a021E686e3cFafE2118'

const STARTING_TIME = 1702331764

// This report has timestamp 1702331770 (STARTING_TIME + 6)
const REPORT =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef50b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857a000000000000000000000000000000000000000000000000000000006577857a0000000000000000000000000000000000000000000000000000290e1acd7a0c000000000000000000000000000000000000000000000000001816de91456cdc000000000000000000000000000000000000000000000000000000006578d6fa00000000000000000000000000000000000000000000007817808f6c383900000000000000000000000000000000000000000000000000000000000000000002778bd577c983ab561189228dfd0025e625294a22e5d2d0c19daac68c3c4b12905288506779a5f3c84c61c2fad27a68604e06f05aef95d5151007266c3e956d6d00000000000000000000000000000000000000000000000000000000000000027bbc66077ec6e000a9fa723517aac6d04daa75d6c4ca486c402bbd0a4e6937cb6d204bc4dcc921f89a0783f82eeffa617dea87c99d05b666fc0658c3a37002c1'

// This report has timestamp 1702331772 (STARTING_TIME + 8)
const OTHER_REPORT =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef513000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857c000000000000000000000000000000000000000000000000000000006577857c00000000000000000000000000000000000000000000000000002911a02d1308000000000000000000000000000000000000000000000000001817c40b5c63a0000000000000000000000000000000000000000000000000000000006578d6fc0000000000000000000000000000000000000000000000780d34cd4db15c40000000000000000000000000000000000000000000000000000000000000000002f1946fb79ca72641ad66fe5b26473bc9e6e6a77fed9c3fb3cdefb6f647b54d3f1d3c611d622975765ee21742bbf111e2d3f3ec06b265d0b6db254e295c633f7a000000000000000000000000000000000000000000000000000000000000000233aaf619efee2f5e6f14378a186060823a8bcae776404f42aba3fd056da417395de590eec77166bcd787c45d6dc1991b305afff0d1948082bc5cf251fb379115'

// This report has timestamp 1702331767 (STARTING_TIME + 3)
const REPORT_BARELY_TOO_EARLY =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef501000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857700000000000000000000000000000000000000000000000000000000657785770000000000000000000000000000000000000000000000000000291166a0c38c000000000000000000000000000000000000000000000000001817c40c7c6488000000000000000000000000000000000000000000000000000000006578d6f70000000000000000000000000000000000000000000000780ddd0766c8aaafc00000000000000000000000000000000000000000000000000000000000000002c662d7b5a1b9aadc4fe78b4e0e00504465d2a53dbc6bdb3800ab624e6006621df90e6acb85877d3a0308a471e373e264e640b4939d9902b64ca02b9e8af10bfa000000000000000000000000000000000000000000000000000000000000000259c86d194b0a8a1c4894d7d38965f3d483fb7351606e8d74156da96e138d3f9e42e2d75888448ef1d6b0410d9773bfa107e9ca4dadaa724ab03bce6638f95532'

// This report has timestamp 1702331768 (STARTING_TIME + 4)
const REPORT_BARELY_NOT_TOO_EARLY =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef505000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b00000000000000000000000000000000000000000000000000000000657785780000000000000000000000000000000000000000000000000000000065778578000000000000000000000000000000000000000000000000000029116617d090000000000000000000000000000000000000000000000000001817c40b5c63a0000000000000000000000000000000000000000000000000000000006578d6f80000000000000000000000000000000000000000000000780dde97be00e34ee00000000000000000000000000000000000000000000000000000000000000002304ccc65d8a47be413a8f6442656a74eb5773dff9465eb7759532ec7c4a08f602a9df811c491b1c57d15baa90541e54be8f8a2be226e844fe6a943a9f3d07f0c00000000000000000000000000000000000000000000000000000000000000021b1ee4567f4ed83142df4c6526af80e54160ff5dc2097ff56542c084538f1fdc1b5e03795b14ea93f797e2d735c88ae57ebde3852e57b203e33033fb1ae13bf2'

// This report has timestamp 1702331774 (STARTING_TIME + 10)
const REPORT_BARELY_NOT_TOO_LATE =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef602000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857e000000000000000000000000000000000000000000000000000000006577857e00000000000000000000000000000000000000000000000000002913ab6d55f000000000000000000000000000000000000000000000000000181a478084831c000000000000000000000000000000000000000000000000000000006578d6fe000000000000000000000000000000000000000000000078073b8b050e57072000000000000000000000000000000000000000000000000000000000000000028c68627adbb1caa5ee2596b6fb56799baf4c85b02aa2544034ba2953a4e14ec4b9a367f0415de9806630c210ee3d110878efe0c62f1d75d3688c31c1825c5df50000000000000000000000000000000000000000000000000000000000000002442fe6ce68b24a7bbe60cdc642ba7c89c1b5c48c3abcd71f174cbf71375d6d574d2c796703d02802c3b812325a09acddf1985eaa37f3611b7e4a42414f44282f'

// This report has timestamp 1702331775 (STARTING_TIME + 11)
const REPORT_BARELY_TOO_LATE =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053ef605000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577857f000000000000000000000000000000000000000000000000000000006577857f0000000000000000000000000000000000000000000000000000291361b0f08400000000000000000000000000000000000000000000000000181a478084831c000000000000000000000000000000000000000000000000000000006578d6ff00000000000000000000000000000000000000000000007808130229ab6bc000000000000000000000000000000000000000000000000000000000000000000248472c13b66cf6ed8951663781e1f0b4ba153dc17ca831cbba86a287e53c95c3e1fadefc9504ea44234c61e20f7b6a6c1badeae3b1986415f7e088ebf8cd056f000000000000000000000000000000000000000000000000000000000000000267f0700c3e7a68543b22b40a5fce3661eea8a7ad489026e83ace86ce50bd1fd669f1f3af1505499c9b4b906b40c0398747cae5e8e93872e62423c608d9999175'

// This report has timestamp 1702331829 (STARTING_TIME + 65)
const REPORT_AFTER_EXPIRATION =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053efe03000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b00000000000000000000000000000000000000000000000000000000657785b500000000000000000000000000000000000000000000000000000000657785b50000000000000000000000000000000000000000000000000000291715b6dd7000000000000000000000000000000000000000000000000000181beb9175a354000000000000000000000000000000000000000000000000000000006578d735000000000000000000000000000000000000000000000077fd41ab0af101000000000000000000000000000000000000000000000000000000000000000000020242f3eab889b1587f4822886c75b40e8e1624359740df27a6754a936d1bf1311a1b6b9e00b141cdc34779b6a15679d56f1517ac695cc3a84ec661e3afbcd81700000000000000000000000000000000000000000000000000000000000000022c92120d64be2434a34b0a36bdd380f151348e0140a08cc95a513d82941f98c16cef0438d6705290735f6574eaad6746efe23b1cb03e5f8deb186b6b6cc25b86'

// This report has timestamp 1702331929 (STARTING_TIME + 165)
const REPORT_WAY_AFTER_EXPIRATION =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd00000000000000000000000000000000000000000000000000000000053f0d0f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b000000000000000000000000000000000000000000000000000000006577861900000000000000000000000000000000000000000000000000000000657786190000000000000000000000000000000000000000000000000000291cb5b809ac00000000000000000000000000000000000000000000000000181fbf77726244000000000000000000000000000000000000000000000000000000006578d799000000000000000000000000000000000000000000000077ecd6e493280d47c000000000000000000000000000000000000000000000000000000000000000025716e3db33167d10c7552eb163e276113e1a73a9084cf13a4364028050bf37d774efd331eb09a50e0854a7c584b4572402e018802a1bf9dfcbeec0a4aaf68c5d000000000000000000000000000000000000000000000000000000000000000233c50092914ef7968b7a484ee4b737305949b0e3e39780009dcb54f88664e2440ef1151e7a3ac86db71c3df57ddd0617cb80212f0d60bab50050be2b1e1a4a15'

const getFee = (payload: string) => {
  const report = ethers.utils.defaultAbiCoder.decode(
    ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
    payload,
  )[1]
  return ethers.utils.defaultAbiCoder.decode(
    ['bytes32', 'uint32', 'uint32', 'uint192', 'uint192', 'uint32', 'uint192'],
    report,
  )[3]
}

const getPrice = (payload: string) => {
  const report = ethers.utils.defaultAbiCoder.decode(
    ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
    payload,
  )[1]
  const price = ethers.utils.defaultAbiCoder.decode(
    ['bytes32', 'uint32', 'uint32', 'uint192', 'uint192', 'uint32', 'uint192'],
    report,
  )[6]
  return ethers.BigNumber.from(price).div(1e12)
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

testOracles.forEach(testOracle => {
  describe(testOracle.name, () => {
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let oracle: Oracle
    let keeperOracle: KeeperOracle
    let chainlinkOracleFactory: ChainlinkFactory
    let payoffFactory: PayoffFactory
    let oracleFactory: OracleFactory
    let marketFactory: MarketFactory
    let market: IMarket
    let dsu: IERC20Metadata
    let oracleSigner: SignerWithAddress
    let factorySigner: SignerWithAddress

    const setup = async () => {
      ;[owner, user] = await ethers.getSigners()

      dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)

      payoffFactory = await new PayoffFactory__factory(owner).deploy()
      await payoffFactory.initialize()
      const milliPowerTwoPayoff = await new MilliPowerTwo__factory(owner).deploy()
      await payoffFactory.register(milliPowerTwoPayoff.address)

      const oracleImpl = await new Oracle__factory(owner).deploy()
      oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
      await oracleFactory.initialize(DSU_ADDRESS, USDC_ADDRESS, RESERVE_ADDRESS)
      await oracleFactory.updateMaxClaim(parse6decimal('100'))

      const keeperOracleImpl = await new testOracle.Oracle(owner).deploy(60)
      chainlinkOracleFactory = await new ChainlinkFactory__factory(owner).deploy(
        CHAINLINK_VERIFIER_PROXY_ADDRESS,
        FEE_MANAGER_ADDRESS,
        WETH_ADDRESS,
        keeperOracleImpl.address,
        4,
        10,
        {
          multiplierBase: 0,
          bufferBase: 1_000_000,
          multiplierCalldata: 0,
          bufferCalldata: 500_000,
        },
        {
          multiplierBase: ethers.utils.parseEther('1.02'),
          bufferBase: 2_000_000,
          multiplierCalldata: ethers.utils.parseEther('1.03'),
          bufferCalldata: 1_500_000,
        },
        5_000,
      )
      await chainlinkOracleFactory.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, dsu.address)
      await oracleFactory.register(chainlinkOracleFactory.address)
      await chainlinkOracleFactory.authorize(oracleFactory.address)
      await chainlinkOracleFactory.associate(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED) // ETH -> ETH

      keeperOracle = testOracle.Oracle.connect(
        await chainlinkOracleFactory.callStatic.create(CHAINLINK_ETH_USD_PRICE_FEED),
        owner,
      )
      await chainlinkOracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED)

      oracle = Oracle__factory.connect(
        await oracleFactory.callStatic.create(CHAINLINK_ETH_USD_PRICE_FEED, chainlinkOracleFactory.address),
        owner,
      )
      await oracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED, chainlinkOracleFactory.address)

      const marketImpl = await new Market__factory(owner).deploy()
      marketFactory = await new MarketFactory__factory(owner).deploy(
        oracleFactory.address,
        payoffFactory.address,
        marketImpl.address,
      )
      await marketFactory.initialize()
      await marketFactory.updateParameter({
        protocolFee: parse6decimal('0.50'),
        maxFee: parse6decimal('0.01'),
        maxFeeAbsolute: parse6decimal('1000'),
        maxCut: parse6decimal('0.50'),
        maxRate: parse6decimal('10.00'),
        minMaintenance: parse6decimal('0.01'),
        minEfficiency: parse6decimal('0.1'),
      })

      const riskParameter = {
        margin: parse6decimal('0.3'),
        maintenance: parse6decimal('0.3'),
        takerFee: 0,
        takerSkewFee: 0,
        takerImpactFee: 0,
        makerFee: 0,
        makerImpactFee: 0,
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('1000'),
        utilizationCurve: {
          minRate: 0,
          maxRate: parse6decimal('5.00'),
          targetRate: parse6decimal('0.80'),
          targetUtilization: parse6decimal('0.80'),
        },
        pController: {
          k: parse6decimal('40000'),
          max: parse6decimal('1.20'),
        },
        minMargin: parse6decimal('500'),
        minMaintenance: parse6decimal('500'),
        skewScale: 0,
        staleAfter: 7200,
        makerReceiveOnly: false,
      }
      const marketParameter = {
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        oracleFee: 0,
        riskFee: 0,
        positionFee: 0,
        maxPendingGlobal: 8,
        maxPendingLocal: 8,
        settlementFee: 0,
        makerCloseAlways: false,
        takerCloseAlways: false,
        closed: false,
      }
      market = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracle.address,
          payoff: ethers.constants.AddressZero,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracle.address,
        payoff: milliPowerTwoPayoff.address,
      })
      await market.updateParameter(ethers.constants.AddressZero, ethers.constants.AddressZero, marketParameter)
      await market.updateRiskParameter(riskParameter)

      oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
      factorySigner = await impersonateWithBalance(chainlinkOracleFactory.address, utils.parseEther('10'))

      const dsuMinter = await impersonateWithBalance(RESERVE_ADDRESS, utils.parseEther('10'))
      const mintAbi = ['function mint(uint256 amount) external']
      const dsuMinterContract = new ethers.Contract(DSU_ADDRESS, mintAbi, dsuMinter)
      await dsuMinterContract.mint(utils.parseEther('100000'))
      await dsu.connect(dsuMinter).transfer(oracleFactory.address, utils.parseEther('100000'))

      await testOracle.gasMock()
    }

    beforeEach(async () => {
      await time.reset()
      await setup()

      await time.increaseTo(STARTING_TIME - 1)
      // block.timestamp of the next call will be STARTING_TIME
    })

    describe('Factory', async () => {
      context('#initialize', async () => {
        it('reverts if already initialized', async () => {
          const chainlinkOracleFactory2 = await new ChainlinkFactory__factory(owner).deploy(
            CHAINLINK_VERIFIER_PROXY_ADDRESS,
            FEE_MANAGER_ADDRESS,
            WETH_ADDRESS,
            await chainlinkOracleFactory.implementation(),
            4,
            10,
            {
              multiplierBase: 0,
              bufferBase: 1_000_000,
              multiplierCalldata: 0,
              bufferCalldata: 500_000,
            },
            {
              multiplierBase: ethers.utils.parseEther('1.02'),
              bufferBase: 2_000_000,
              multiplierCalldata: ethers.utils.parseEther('1.03'),
              bufferCalldata: 1_500_000,
            },
            5_000,
          )
          await chainlinkOracleFactory2.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, dsu.address)
          await expect(chainlinkOracleFactory2.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, dsu.address))
            .to.be.revertedWithCustomError(chainlinkOracleFactory2, 'InitializableAlreadyInitializedError')
            .withArgs(1)
        })
      })

      context('#create', async () => {
        it('cant recreate price id', async () => {
          await expect(chainlinkOracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED)).to.be.revertedWithCustomError(
            chainlinkOracleFactory,
            'KeeperFactoryAlreadyCreatedError',
          )
        })

        it('reverts when not owner', async () => {
          await expect(
            chainlinkOracleFactory.connect(user).create(CHAINLINK_ETH_USD_PRICE_FEED),
          ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'OwnableNotOwnerError')
        })
      })

      context('#updateGranularity', async () => {
        it('reverts when not owner', async () => {
          await expect(chainlinkOracleFactory.connect(user).updateGranularity(10)).to.be.revertedWithCustomError(
            chainlinkOracleFactory,
            'OwnableNotOwnerError',
          )
        })
      })

      context('#authorize', async () => {
        it('reverts when not owner', async () => {
          await expect(
            chainlinkOracleFactory.connect(user).authorize(oracleFactory.address),
          ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'OwnableNotOwnerError')
        })
      })

      context('#associate', async () => {
        it('reverts when not owner', async () => {
          await expect(
            chainlinkOracleFactory.connect(user).associate(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED),
          ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'OwnableNotOwnerError')
        })
      })
    })

    describe('#initialize', async () => {
      it('only initializes with a valid priceId', async () => {
        const oracle = await new KeeperOracle__factory(owner).deploy(60)
        await expect(oracle.initialize()).to.emit(oracle, 'Initialized').withArgs(1)
      })

      it('reverts if already initialized', async () => {
        const oracle = await new KeeperOracle__factory(owner).deploy(60)
        await oracle.initialize()
        await expect(oracle.initialize())
          .to.be.revertedWithCustomError(oracle, 'InitializableAlreadyInitializedError')
          .withArgs(1)
      })
    })

    describe('constants', async () => {
      it('#MIN_VALID_TIME_AFTER_VERSION', async () => {
        expect(await chainlinkOracleFactory.validFrom()).to.equal(4)
      })

      it('#MAX_VALID_TIME_AFTER_VERSION', async () => {
        expect(await chainlinkOracleFactory.validTo()).to.equal(10)
      })

      it('#GRACE_PERIOD', async () => {
        expect(await keeperOracle.timeout()).to.equal(60)
      })

      it('#commitKeepConfig', async () => {
        const keepConfig = await chainlinkOracleFactory.commitKeepConfig(1)
        expect(keepConfig.multiplierBase).to.equal(0)
        expect(keepConfig.bufferBase).to.equal(1_000_000)
        expect(keepConfig.multiplierCalldata).to.equal(0)
        expect(keepConfig.bufferCalldata).to.equal(505_000)
      })

      it('#commitKeepConfig with multiple requested', async () => {
        const keepConfig = await chainlinkOracleFactory.commitKeepConfig(5)
        expect(keepConfig.multiplierBase).to.equal(0)
        expect(keepConfig.bufferBase).to.equal(5_000_000)
        expect(keepConfig.multiplierCalldata).to.equal(0)
        expect(keepConfig.bufferCalldata).to.equal(525_000)
      })

      it('#settleKeepConfig', async () => {
        const keepConfig = await chainlinkOracleFactory.settleKeepConfig()
        expect(keepConfig.multiplierBase).to.equal(ethers.utils.parseEther('1.02'))
        expect(keepConfig.bufferBase).to.equal(2_000_000)
        expect(keepConfig.multiplierCalldata).to.equal(ethers.utils.parseEther('1.03'))
        expect(keepConfig.bufferCalldata).to.equal(1_500_000)
      })
    })

    describe('#commit', async () => {
      it('commits successfully and incentivizes the keeper', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const originalFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.globalCallbacks(STARTING_TIME)).to.deep.eq([market.address])
        expect(await keeperOracle.localCallbacks(STARTING_TIME, market.address)).to.deep.eq([user.address])

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
            value: getFee(REPORT),
            maxFeePerGas: 100000000,
          }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrice(REPORT), true])

        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const newFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)

        expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(utils.parseEther('0.30'), utils.parseEther('0.35'))
        expect(originalFactoryDSUBalance.sub(newFactoryDSUBalance)).to.be.within(
          utils.parseEther('0.30'),
          utils.parseEther('0.35'),
        )

        expect((await market.position()).timestamp).to.equal(STARTING_TIME)
      })

      it('commits successfully if report is barely not too early', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT_BARELY_NOT_TOO_EARLY, {
              value: getFee(REPORT_BARELY_NOT_TOO_EARLY),
              maxFeePerGas: 100000000,
            }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrice(REPORT_BARELY_NOT_TOO_EARLY), true])
      })

      it('commits successfully if report is barely not too late', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT_BARELY_NOT_TOO_LATE, {
              value: getFee(REPORT_BARELY_NOT_TOO_LATE),
              maxFeePerGas: 100000000,
            }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrice(REPORT_BARELY_NOT_TOO_LATE), true])
      })

      it('fails to commit if report is outside of time range', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT_BARELY_TOO_EARLY, {
              value: getFee(REPORT_BARELY_TOO_EARLY),
            }),
        ).to.revertedWithCustomError(chainlinkOracleFactory, 'ChainlinkFactoryVersionOutsideRangeError')

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT_BARELY_TOO_LATE, {
              value: getFee(REPORT_BARELY_TOO_LATE),
            }),
        ).to.revertedWithCustomError(chainlinkOracleFactory, 'ChainlinkFactoryVersionOutsideRangeError')
      })

      it('fails to commit if update fee is not provided', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT),
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      })

      it('does not commit a version that has already been committed', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
            value: getFee(REPORT),
          }),
        ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('rejects invalid update data', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, '0x', {
            value: 1,
          }),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
      })

      it('cannot skip a version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.versions(2)).to.be.equal(STARTING_TIME + 1)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 1, REPORT, {
            value: getFee(REPORT),
          }),
        ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('cannot skip a version if the grace period has expired', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await time.increase(59)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.versions(2)).to.be.equal(STARTING_TIME + 60)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          chainlinkOracleFactory
            .connect(user)
            .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 60, REPORT_AFTER_EXPIRATION, {
              value: getFee(REPORT_AFTER_EXPIRATION),
            }),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('commits unincentivized if there are no requested or committed versions, does not incentivize keeper, updates latest', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        await increase(1)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.true
        expect(version.price).to.equal(getPrice(REPORT))

        // Didn't incentivize keeper
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        expect(newDSUBalance.sub(originalDSUBalance)).to.equal(0)

        expect(await keeperOracle.connect(user).latest()).to.deep.equal(version)
      })

      it('reverts if not called from factory', async () => {
        await expect(
          keeperOracle.connect(user).commit({ timestamp: STARTING_TIME, price: parse6decimal('1000'), valid: true }),
        ).to.be.revertedWithCustomError(keeperOracle, 'InstanceNotFactoryError')
      })

      it('reverts if version is zero', async () => {
        await expect(
          keeperOracle.connect(factorySigner).commit({ timestamp: 0, price: 0, valid: false }),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('can commit if there are requested versions but no committed versions', async () => {
        await time.increase(30)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
      })

      it('can commit if there are committed versions but no requested versions', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        await time.increase(60)
        await chainlinkOracleFactory
          .connect(user)
          .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 60, REPORT_AFTER_EXPIRATION, {
            value: getFee(REPORT_AFTER_EXPIRATION),
          })
      })

      it('can commit if there are committed versions and requested versions', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await time.increase(1)
        await chainlinkOracleFactory
          .connect(user)
          .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, { value: getFee(REPORT) })
        await time.increaseTo(STARTING_TIME + 160)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        const secondRequestedVersion = await currentBlockTimestamp()
        const nonRequestedOracleVersion = STARTING_TIME + 60
        await chainlinkOracleFactory
          .connect(user)
          .commit([CHAINLINK_ETH_USD_PRICE_FEED], nonRequestedOracleVersion, REPORT_AFTER_EXPIRATION, {
            value: getFee(REPORT_AFTER_EXPIRATION),
          })
        expect((await keeperOracle.connect(user).latest()).timestamp).to.equal(nonRequestedOracleVersion)

        await chainlinkOracleFactory
          .connect(user)
          .commit([CHAINLINK_ETH_USD_PRICE_FEED], secondRequestedVersion, REPORT_WAY_AFTER_EXPIRATION, {
            value: getFee(REPORT_WAY_AFTER_EXPIRATION),
          })
        expect((await keeperOracle.connect(user).latest()).timestamp).to.equal(secondRequestedVersion)
      })

      it('cannot commit invalid VAAs for the oracle version', async () => {
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME - 60, REPORT, {
            value: getFee(REPORT),
          }),
        ).to.reverted
      })

      it('must be more recent than the most recently committed version', async () => {
        await time.increase(2)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 2, REPORT, {
          value: getFee(REPORT),
        })

        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 1, OTHER_REPORT, {
            value: getFee(OTHER_REPORT),
          }),
        ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('does not commitRequested if oracleVersion is incorrect', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME - 1, REPORT, {
          value: getFee(REPORT),
          gasPrice: 100000000,
        })
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)

        // Keeper isn't incentivized because we did not go through commitRequested
        expect(newDSUBalance).to.equal(originalDSUBalance)
      })

      it('can commit multiple non-requested versions, as long as they are in order', async () => {
        await time.increase(1)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        await time.increase(60)
        await chainlinkOracleFactory
          .connect(user)
          .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 60, REPORT_AFTER_EXPIRATION, {
            value: getFee(REPORT_AFTER_EXPIRATION),
          })
      })

      it('cant commit non-requested version until after an invalid has passed grace period', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect((await keeperOracle.global()).latestIndex).to.equal(0)

        await time.increase(59)
        await expect(
          chainlinkOracleFactory
            .connect(user)
            .commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME + 60, REPORT_AFTER_EXPIRATION, {
              value: getFee(REPORT_AFTER_EXPIRATION),
            }),
        ).to.be.reverted
      })

      it('reverts if committing invalid non-requested version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect((await keeperOracle.global()).latestIndex).to.equal(0)

        await time.increase(60)
        await expect(
          chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME - 1, '0x'),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
      })
    })

    describe('#settle', async () => {
      it('settles successfully and incentivizes the keeper', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const originalFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
          maxFeePerGas: 100000000,
        })
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const newFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)

        expect((await market.position()).timestamp).to.equal(STARTING_TIME)

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .settle([CHAINLINK_ETH_USD_PRICE_FEED], [market.address], [STARTING_TIME], [1], {
              maxFeePerGas: 100000000,
            }),
        ).to.emit(keeperOracle, 'CallbackFulfilled')
        // .withArgs([market.address, user.address, STARTING_TIME]) cannot parse indexed tuples in events

        expect((await market.positions(user.address)).timestamp).to.equal(STARTING_TIME)

        expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(utils.parseEther('0.30'), utils.parseEther('0.35'))
        expect(originalFactoryDSUBalance.sub(newFactoryDSUBalance)).to.be.within(
          utils.parseEther('0.30'),
          utils.parseEther('0.35'),
        )
      })

      it('reverts if array lengths mismatch', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        await expect(
          chainlinkOracleFactory
            .connect(user)
            .settle([CHAINLINK_ETH_USD_PRICE_FEED], [market.address, market.address], [STARTING_TIME], [1]),
        ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'KeeperFactoryInvalidSettleError')

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .settle([CHAINLINK_ETH_USD_PRICE_FEED], [market.address], [STARTING_TIME, STARTING_TIME], [1]),
        ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'KeeperFactoryInvalidSettleError')

        await expect(
          chainlinkOracleFactory
            .connect(user)
            .settle([CHAINLINK_ETH_USD_PRICE_FEED], [market.address], [STARTING_TIME], [1, 1]),
        ).to.be.revertedWithCustomError(chainlinkOracleFactory, 'KeeperFactoryInvalidSettleError')
      })

      it('reverts if calldata is ids is empty', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })

        await expect(chainlinkOracleFactory.connect(user).settle([], [], [], [])).to.be.revertedWithCustomError(
          chainlinkOracleFactory,
          'KeeperFactoryInvalidSettleError',
        )
      })
    })

    describe('#status', async () => {
      it('returns the correct versions', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        const [latestIndex, currentIndex] = await keeperOracle.status()
        expect(latestIndex.valid).to.be.true
        expect(latestIndex.price).to.equal(getPrice(REPORT))
        expect(currentIndex).to.equal(await currentBlockTimestamp())
      })

      it('returns empty versions if no version has ever been committed', async () => {
        const [latestIndex, currentIndex] = await keeperOracle.status()
        expect(currentIndex).to.equal(await currentBlockTimestamp())
        expect(latestIndex.timestamp).to.equal(0)
        expect(latestIndex.price).to.equal(0)
        expect(latestIndex.valid).to.be.false
      })
    })

    describe('#request', async () => {
      it('can request a version', async () => {
        // No requested versions
        expect((await keeperOracle.global()).currentIndex).to.equal(0)
        await expect(keeperOracle.connect(oracleSigner).request(market.address, user.address))
          .to.emit(keeperOracle, 'OracleProviderVersionRequested')
          .withArgs(STARTING_TIME)
        // Now there is exactly one requested version
        expect(await keeperOracle.versions(1)).to.equal(STARTING_TIME)
        expect((await keeperOracle.global()).currentIndex).to.equal(1)
      })

      it('can request a version w/ granularity', async () => {
        await chainlinkOracleFactory.updateGranularity(10)

        // No requested versions
        expect((await keeperOracle.global()).currentIndex).to.equal(0)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        const currentTimestamp = await chainlinkOracleFactory.current()

        // Now there is exactly one requested version
        expect(await keeperOracle.versions(1)).to.equal(currentTimestamp)
        expect((await keeperOracle.global()).currentIndex).to.equal(1)
      })

      it('does not allow unauthorized instances to request', async () => {
        const badInstance = await smock.fake<IInstance>('IInstance')
        const badFactory = await smock.fake<IFactory>('IFactory')
        badInstance.factory.returns(badFactory.address)
        badFactory.instances.returns(true)
        const badSigner = await impersonateWithBalance(badInstance.address, utils.parseEther('10'))

        await expect(
          keeperOracle.connect(badSigner).request(market.address, user.address),
        ).to.be.revertedWithCustomError(keeperOracle, 'OracleProviderUnauthorizedError')
      })

      it('a version can only be requested once', async () => {
        await ethers.provider.send('evm_setAutomine', [false])
        await ethers.provider.send('evm_setIntervalMining', [0])

        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)

        await ethers.provider.send('evm_mine', [])

        const currentTimestamp = await chainlinkOracleFactory.current()
        expect(await keeperOracle.callStatic.versions(1)).to.equal(currentTimestamp)
        expect(await keeperOracle.callStatic.versions(2)).to.equal(0)
      })
    })

    describe('#latest', async () => {
      it('returns the latest version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        const latestValue = await keeperOracle.connect(user).latest()
        expect(latestValue.valid).to.be.true
        expect(latestValue.price).to.equal(getPrice(REPORT))
      })

      it('returns empty version if no version has ever been committed', async () => {
        const latestIndex = await keeperOracle.connect(user).latest()
        expect(latestIndex.timestamp).to.equal(0)
        expect(latestIndex.price).to.equal(0)
        expect(latestIndex.valid).to.be.false
      })
    })

    describe('#current', async () => {
      it('returns the current timestamp', async () => {
        expect(await keeperOracle.connect(user).current()).to.equal(await currentBlockTimestamp())
      })

      it('returns the current timestamp w/ granularity == 0', async () => {
        await expect(chainlinkOracleFactory.connect(owner).updateGranularity(0)).to.be.revertedWithCustomError(
          chainlinkOracleFactory,
          'KeeperFactoryInvalidGranularityError',
        )
      })

      it('returns the current timestamp w/ granularity > MAX', async () => {
        await expect(chainlinkOracleFactory.connect(owner).updateGranularity(3601)).to.be.revertedWithCustomError(
          chainlinkOracleFactory,
          'KeeperFactoryInvalidGranularityError',
        )
        await expect(chainlinkOracleFactory.connect(owner).updateGranularity(3600)).to.be.not.reverted
      })

      it('returns the current timestamp w/ fresh granularity > 1', async () => {
        await chainlinkOracleFactory.connect(owner).updateGranularity(10)

        const granularity = await chainlinkOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(1)
        expect(granularity.currentGranularity).to.equal(10)
        expect(granularity.effectiveAfter).to.equal(await currentBlockTimestamp())

        expect(await keeperOracle.connect(user).current()).to.equal(await currentBlockTimestamp())
      })

      it('returns the current timestamp w/ settled granularity > 1', async () => {
        const granularity = await chainlinkOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(0)
        expect(granularity.currentGranularity).to.equal(1)
        expect(granularity.effectiveAfter).to.equal(0)

        await chainlinkOracleFactory.connect(owner).updateGranularity(10)

        const granularity2 = await chainlinkOracleFactory.granularity()
        expect(granularity2.latestGranularity).to.equal(1)
        expect(granularity2.currentGranularity).to.equal(10)
        expect(granularity2.effectiveAfter).to.equal(await currentBlockTimestamp())

        await time.increase(1)

        expect(await keeperOracle.connect(user).current()).to.equal(
          Math.ceil((await currentBlockTimestamp()) / 10) * 10,
        )
      })

      it('returns the current timestamp w/ fresh + fresh granularity > 1', async () => {
        await chainlinkOracleFactory.connect(owner).updateGranularity(10)
        // hardhat automatically moves 1 second ahead so we have to do this twice
        await chainlinkOracleFactory.connect(owner).updateGranularity(100)
        await expect(chainlinkOracleFactory.connect(owner).updateGranularity(1000)).to.be.revertedWithCustomError(
          chainlinkOracleFactory,
          'KeeperFactoryInvalidGranularityError',
        )
      })

      it('returns the current timestamp w/ settled + fresh granularity > 1', async () => {
        await chainlinkOracleFactory.connect(owner).updateGranularity(10)
        await time.increase(1)

        await chainlinkOracleFactory.connect(owner).updateGranularity(100)
        const granularity = await chainlinkOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(10)
        expect(granularity.currentGranularity).to.equal(100)
        expect(granularity.effectiveAfter).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)

        expect(await keeperOracle.connect(user).current()).to.equal(
          Math.ceil((await currentBlockTimestamp()) / 10) * 10,
        )
      })

      it('returns the current timestamp w/ settled + settled granularity > 1', async () => {
        await chainlinkOracleFactory.connect(owner).updateGranularity(10)
        await time.increase(1)

        await chainlinkOracleFactory.connect(owner).updateGranularity(100)
        const granularity = await chainlinkOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(10)
        expect(granularity.currentGranularity).to.equal(100)
        expect(granularity.effectiveAfter).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)

        const previousCurrent = Math.ceil((await currentBlockTimestamp()) / 10) * 10
        await time.increase(previousCurrent - (await currentBlockTimestamp()) + 1)

        expect(await keeperOracle.connect(user).current()).to.equal(
          Math.ceil((await currentBlockTimestamp()) / 100) * 100,
        )
      })
    })

    describe('#atVersion', async () => {
      it('returns the correct version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await chainlinkOracleFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], STARTING_TIME, REPORT, {
          value: getFee(REPORT),
        })
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.true
        expect(version.price).to.equal(getPrice(REPORT))
      })

      it('returns invalid version if that version was not requested', async () => {
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.false
      })

      it('returns invalid version if that version was requested but not committed', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.false
      })
    })
  })
})
