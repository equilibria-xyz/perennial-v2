import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  AggregatorV3Interface,
  IERC20Metadata,
  IMarket,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  IMarketFactory,
  KeeperOracle,
  KeeperOracle__factory,
  MockFeeManager,
  MockVerifierProxy,
  MockFeeManager__factory,
  MockVerifierProxy__factory,
  ChainlinkFactory,
  ChainlinkFactory__factory,
  GasOracle,
} from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { utils, BigNumberish } from 'ethers'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'

const { ethers } = HRE
use(smock.matchers)

const CHAINLINK_ETH_USD_PRICE_FEED = '0x00027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b'

/*
{
  feedId: '0x00027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b',
  validFromTimestamp: 1701469671,
  observationsTimestamp: 1701469671,
  nativeFee: 4800,
  linkFee: 667900,
  expiresAt: 1701556071,
  price: 2092999105372457000000
}
*/
const CHAINLINK_PAYLOAD =
  '0x00067f14c763070bec1de1118aceeed1546878ab24e3213de21127249adabcbd0000000000000000000000000000000000000000000000000000000003547708000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b00000000000000000000000000000000000000000000000000000000656a5de700000000000000000000000000000000000000000000000000000000656a5de700000000000000000000000000000000000000000000000000000000000012c000000000000000000000000000000000000000000000000000000000000a30fc00000000000000000000000000000000000000000000000000000000656baf6700000000000000000000000000000000000000000000007176328d26d7abdc400000000000000000000000000000000000000000000000000000000000000002cdb2e4defe76c0798cb647ffeb2e206ac169f519fd96f02d2baf897afb30f552416544a83a5d7911721ece8bb5b07557733a749dced2294c161c48e21bfae6db00000000000000000000000000000000000000000000000000000000000000022678c8bcfd688b51c8558203a1420aeb772658349785b8ee6d807a3952007fb236956a7d9a4f9a60dd8be9c646a82464c54239f591a995b1f055c37101ee2a55'

const overwriteTimestamp = (payload: string, timestamp: BigNumberish) => {
  const [context, report, r, s, v] = ethers.utils.defaultAbiCoder.decode(
    ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
    payload,
  )
  const [feedId, validFrom, , nativeFee, linkFee, expiresAt, price] = ethers.utils.defaultAbiCoder.decode(
    ['bytes32', 'uint32', 'uint32', 'uint192', 'uint192', 'uint32', 'uint192'],
    report,
  )
  const newReport = ethers.utils.defaultAbiCoder.encode(
    ['bytes32', 'uint32', 'uint32', 'uint192', 'uint192', 'uint32', 'uint192'],
    [feedId, validFrom, timestamp, nativeFee, linkFee, expiresAt, price],
  )
  return ethers.utils.defaultAbiCoder.encode(
    ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
    [context, newReport, r, s, v],
  )
}

const listify = (...payload: string[]) => {
  return ethers.utils.defaultAbiCoder.encode(['bytes[]'], [payload])
}

describe('ChainlinkFactory', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let chainlinkFeed: FakeContract<AggregatorV3Interface>
  let mockFeeManager: MockFeeManager
  let mockVerifierProxy: MockVerifierProxy
  let commitmentGasOracle: FakeContract<GasOracle>
  let settlementGasOracle: FakeContract<GasOracle>
  let oracle: Oracle
  let keeperOracle: KeeperOracle
  let chainlinkFactory: ChainlinkFactory
  let oracleFactory: OracleFactory
  let dsu: FakeContract<IERC20Metadata>
  let usdc: FakeContract<IERC20Metadata>
  let weth: FakeContract<IERC20Metadata>
  let oracleSigner: SignerWithAddress
  let market: FakeContract<IMarket>
  let marketFactory: FakeContract<IMarketFactory>

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    chainlinkFeed = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    chainlinkFeed.latestRoundData.returns([
      utils.parseEther('1'),
      183323161000,
      utils.parseEther('1'),
      utils.parseEther('1'),
      utils.parseEther('1'),
    ])

    weth = await smock.fake<IERC20Metadata>('IERC20Metadata')
    mockFeeManager = await new MockFeeManager__factory(owner).deploy(weth.address)
    mockVerifierProxy = await new MockVerifierProxy__factory(owner).deploy(mockFeeManager.address)

    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu.transfer.returns(true)
    usdc = await smock.fake<IERC20Metadata>('IERC20Metadata')
    usdc.transfer.returns(true)
    usdc.approve.returns(true)

    market = await smock.fake<IMarket>('IMarket')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market.factory.returns(marketFactory.address)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    market.settle.returns()
    market.token.returns(dsu.address)

    const oracleImpl = await new Oracle__factory(owner).deploy()
    oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize()

    commitmentGasOracle = await smock.fake<GasOracle>('GasOracle')
    commitmentGasOracle.cost.whenCalledWith(1).returns(utils.parseEther('0.20'))
    settlementGasOracle = await smock.fake<GasOracle>('GasOracle')
    settlementGasOracle.cost.whenCalledWith(0).returns(utils.parseEther('0.05'))

    const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
    chainlinkFactory = await new ChainlinkFactory__factory(owner).deploy(
      mockVerifierProxy.address,
      mockFeeManager.address,
      weth.address,
      commitmentGasOracle.address,
      settlementGasOracle.address,
      keeperOracleImpl.address,
    )
    await chainlinkFactory.initialize(oracleFactory.address)
    await chainlinkFactory.updateParameter(1, 0, 4, 10)
    await oracleFactory.register(chainlinkFactory.address)

    keeperOracle = KeeperOracle__factory.connect(
      await chainlinkFactory.callStatic.create(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      }),
      owner,
    )
    await chainlinkFactory.create(CHAINLINK_ETH_USD_PRICE_FEED, CHAINLINK_ETH_USD_PRICE_FEED, {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    })

    oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(CHAINLINK_ETH_USD_PRICE_FEED, chainlinkFactory.address, 'ETH-USD'),
      owner,
    )
    await oracleFactory.create(CHAINLINK_ETH_USD_PRICE_FEED, chainlinkFactory.address, 'ETH-USD')

    await keeperOracle.register(oracle.address)
    await oracle.register(market.address)

    oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
  })

  it('factoryType is ChainlinkFactory', async () => {
    expect(await chainlinkFactory.factoryType()).to.equal('ChainlinkFactory')
  })

  it('parses Chainlink report correctly', async () => {
    market.claimFee.returns(utils.parseUnits('0.25', 6))
    await keeperOracle.connect(oracleSigner).request(market.address, user.address)

    const report = listify(
      overwriteTimestamp(
        CHAINLINK_PAYLOAD,
        (await keeperOracle.callStatic.next()).add((await chainlinkFactory.parameter()).validFrom),
      ),
    )
    const version = await keeperOracle.callStatic.next()

    await expect(
      chainlinkFactory.connect(user).commit([CHAINLINK_ETH_USD_PRICE_FEED], version, report, {
        value: 4800,
        gasLimit: 1_000_000,
      }),
    )
      .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
      .withArgs([version, '2092999105', true])
    expect((await keeperOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('2092.999105', 6))
  })

  it('commit reverts if msg.value is too low', async () => {
    await keeperOracle.connect(oracleSigner).request(market.address, user.address)

    const report = listify(
      overwriteTimestamp(
        CHAINLINK_PAYLOAD,
        (await keeperOracle.callStatic.next()).add((await chainlinkFactory.parameter()).validFrom),
      ),
    )

    await expect(
      chainlinkFactory
        .connect(user)
        .commit([CHAINLINK_ETH_USD_PRICE_FEED], await keeperOracle.callStatic.next(), report, {
          value: 4799,
        }),
    ).to.be.reverted
  })
})
