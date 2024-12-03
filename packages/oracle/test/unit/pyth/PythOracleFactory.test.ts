import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { mine } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  AbstractPyth,
  AggregatorV3Interface,
  IERC20Metadata,
  IMarket,
  IPythStaticFee,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
  PythFactory__factory,
  IMarketFactory,
  KeeperOracle,
  KeeperOracle__factory,
  GasOracle,
} from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { utils, BigNumber, BigNumberish } from 'ethers'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'

const { ethers } = HRE

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

const getVaa = (price: BigNumberish, conf: BigNumberish, expo: BigNumberish, publishTime: BigNumberish) => {
  const priceStruct = {
    price: price.toString(),
    conf: conf.toString(),
    expo: expo.toString(),
    publishTime: publishTime.toString(),
  }
  const struct = {
    id: PYTH_ETH_USD_PRICE_FEED,
    price: priceStruct,
    emaPrice: priceStruct,
  }
  const hexString = Buffer.from(JSON.stringify(struct), 'utf8').toString('hex')
  return '0x' + hexString
}

describe('PythOracleFactory', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let pyth: FakeContract<AbstractPyth>
  let pythUpdateFee: FakeContract<IPythStaticFee>
  let chainlinkFeed: FakeContract<AggregatorV3Interface>
  let commitmentGasOracle: FakeContract<GasOracle>
  let settlementGasOracle: FakeContract<GasOracle>
  let oracle: Oracle
  let keeperOracle: KeeperOracle
  let pythOracleFactory: PythFactory
  let oracleFactory: OracleFactory
  let dsu: FakeContract<IERC20Metadata>
  let oracleSigner: SignerWithAddress
  let market: FakeContract<IMarket>
  let marketFactory: FakeContract<IMarketFactory>

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    pyth = await smock.fake<AbstractPyth>('AbstractPyth')
    pythUpdateFee = await smock.fake<IPythStaticFee>('IPythStaticFee', { address: pyth.address })
    pyth.priceFeedExists.returns(true)
    pythUpdateFee.singleUpdateFeeInWei.returns(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pyth.parsePriceFeedUpdates.returns((params: any) => {
      const decoded = JSON.parse(Buffer.from(params.updateData[0].substring(2), 'hex').toString('utf8'))
      const publishTime = BigNumber.from(decoded.price.publishTime)
      if (publishTime.lt(params.minPublishTime) || publishTime.gt(params.maxPublishTime)) {
        return []
      }
      return [decoded]
    })

    chainlinkFeed = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    chainlinkFeed.latestRoundData.returns([
      utils.parseEther('1'),
      183323161000,
      utils.parseEther('1'),
      utils.parseEther('1'),
      utils.parseEther('1'),
    ])

    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu.transfer.returns(true)

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
    pythOracleFactory = await new PythFactory__factory(owner).deploy(
      pyth.address,
      commitmentGasOracle.address,
      settlementGasOracle.address,
      keeperOracleImpl.address,
    )
    await pythOracleFactory.initialize(oracleFactory.address)
    await pythOracleFactory.updateParameter(1, 0, 4, 10)
    await oracleFactory.register(pythOracleFactory.address)

    keeperOracle = KeeperOracle__factory.connect(
      await pythOracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      }),
      owner,
    )
    await pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    })

    oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD'),
      owner,
    )
    await oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD')

    await keeperOracle.register(oracle.address)
    await oracle.register(market.address)

    oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
  })

  it('factoryType is PythFactory', async () => {
    expect(await pythOracleFactory.factoryType()).to.equal('PythFactory')
    // hacks around issue mocking market.settle on subsequent test
    mine()
  })

  it('parses Pyth exponents correctly', async () => {
    market.claimFee.returns(utils.parseUnits('0.25', 6))

    const minDelay = (await pythOracleFactory.parameter()).validFrom
    await keeperOracle.connect(oracleSigner).request(market.address, user.address)
    await pythOracleFactory
      .connect(user)
      .commit(
        [PYTH_ETH_USD_PRICE_FEED],
        await keeperOracle.callStatic.next(),
        getVaa(100000000000, 2, -8, (await keeperOracle.callStatic.next()).add(minDelay)),
        {
          value: 1,
        },
      )
    expect((await keeperOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('1000', 6))

    await keeperOracle.connect(oracleSigner).request(market.address, user.address)
    await pythOracleFactory
      .connect(user)
      .commit(
        [PYTH_ETH_USD_PRICE_FEED],
        await keeperOracle.callStatic.next(),
        getVaa(20000000, 2, -4, (await keeperOracle.callStatic.next()).add(minDelay)),
        {
          value: 1,
        },
      )
    expect((await keeperOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('2000', 6))
  })
})
