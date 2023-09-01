import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  AbstractPyth,
  AggregatorV3Interface,
  IERC20Metadata,
  IPythStaticFee,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
  PythFactory__factory,
  PythOracle,
  PythOracle__factory,
} from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { parse6decimal } from '../../../../common/testutil/types'
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

describe('PythOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let pyth: FakeContract<AbstractPyth>
  let pythUpdateFee: FakeContract<IPythStaticFee>
  let chainlinkFeed: FakeContract<AggregatorV3Interface>
  let oracle: Oracle
  let pythOracle: PythOracle
  let pythOracleFactory: PythFactory
  let oracleFactory: OracleFactory
  let dsu: FakeContract<IERC20Metadata>
  let oracleSigner: SignerWithAddress

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

    const oracleImpl = await new Oracle__factory(owner).deploy()
    oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize(dsu.address)
    await oracleFactory.updateMaxClaim(parse6decimal('10'))

    const pythOracleImpl = await new PythOracle__factory(owner).deploy(pyth.address)
    pythOracleFactory = await new PythFactory__factory(owner).deploy(
      pythOracleImpl.address,
      chainlinkFeed.address,
      dsu.address,
    )
    await pythOracleFactory.initialize(oracleFactory.address)
    await oracleFactory.register(pythOracleFactory.address)
    await pythOracleFactory.authorize(oracleFactory.address)

    pythOracle = PythOracle__factory.connect(await pythOracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED), owner)
    await pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED)

    oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address),
      owner,
    )
    await oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address)

    oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
  })

  it('parses Pyth exponents correctly', async () => {
    const minDelay = await pythOracle.MIN_VALID_TIME_AFTER_VERSION()
    await pythOracle.connect(oracleSigner).request(user.address)
    await pythOracle
      .connect(user)
      .commitRequested(
        0,
        getVaa(100000000000, 2, -8, (await pythOracle.callStatic.nextVersionToCommit()).add(minDelay)),
        {
          value: 1,
        },
      )
    expect((await pythOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('1000', 6))

    await pythOracle.connect(oracleSigner).request(user.address)
    await pythOracle
      .connect(user)
      .commitRequested(1, getVaa(20000000, 2, -4, (await pythOracle.callStatic.nextVersionToCommit()).add(minDelay)), {
        value: 1,
      })
    expect((await pythOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('2000', 6))
  })
})
