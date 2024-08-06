import HRE, { ethers } from 'hardhat'

import {
  KeeperOracle__factory,
  KeeperOracle,
  KeeperFactory,
  PythFactory__factory,
  AbstractPyth,
  IERC20Metadata,
  Oracle__factory,
  OracleFactory__factory,
  AggregatorV3Interface,
  IMarket,
  IMarketFactory,
  Oracle,
} from '../../../types/generated'
import { utils, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { parse6decimal } from '../../../../common/testutil/types'
import { expect } from 'chai'
import { currentBlockTimestamp, increase } from '../../../../common/testutil/time'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const KEEPER_ORACLE_TIMEOUT = 60

describe('KeeperOracle', () => {
  let owner: SignerWithAddress
  let receiver: SignerWithAddress
  let user: SignerWithAddress
  let oracle: Oracle
  let oracleSigner: SignerWithAddress
  let keeperOracle: KeeperOracle
  let keeperOracleFactory: KeeperFactory
  let market: FakeContract<IMarket>
  let marketFactory: FakeContract<IMarketFactory>
  let dsu: FakeContract<IERC20Metadata>

  async function commitPrice(timestamp: number, price: BigNumber) {
    const oracleVersion = {
      timestamp: timestamp,
      price: price,
      valid: true,
    }
    const keeperFactorySigner = await impersonateWithBalance(keeperOracleFactory.address, utils.parseEther('10'))

    await expect(
      keeperOracle.connect(keeperFactorySigner).commit(oracleVersion, receiver.address, {
        gasLimit: 1_000_000,
        maxFeePerGas: 100000000,
      }),
    ).to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
  }

  beforeEach(async () => {
    // snapshot initial chain state for multiple tests
    ;[owner, user, receiver] = await ethers.getSigners()

    // mock external components
    const pyth = await smock.fake<AbstractPyth>('AbstractPyth')
    pyth.priceFeedExists.returns(true)
    const chainlinkFeed = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu.transfer.returns(true)

    // mock the market
    market = await smock.fake<IMarket>('IMarket')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market.factory.returns(marketFactory.address)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    market.settle.whenCalledWith(ethers.constants.AddressZero).returns()
    market.token.returns(dsu.address)

    // deploy prerequisites
    const oracleImpl = await new Oracle__factory(owner).deploy()
    const oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize()

    // deploy the implementation contract and a factory letting us create an instance
    const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(KEEPER_ORACLE_TIMEOUT)
    keeperOracleFactory = await new PythFactory__factory(owner).deploy(pyth.address, keeperOracleImpl.address)
    await keeperOracleFactory.initialize(oracleFactory.address)
    await keeperOracleFactory.updateParameter(1, 0, 0, 0, 4, 10)
    await oracleFactory.register(keeperOracleFactory.address)

    // create our KeeperOracle instance
    keeperOracle = KeeperOracle__factory.connect(
      await keeperOracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      }),
      owner,
    )
    await keeperOracleFactory.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    })

    // needed for making oracle requests
    oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, keeperOracleFactory.address),
      owner,
    )
    await oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, keeperOracleFactory.address)

    oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))

    await keeperOracle.register(oracle.address)
    await oracle.register(market.address)

    // Base fee isn't working properly in coverage, so we need to set it manually
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
  })

  afterEach(async () => {
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
  })

  // @dev - this doesn't fail in CI
  it('can commit new prices', async () => {
    // validate initial (empty) state
    let version = await keeperOracle.latest()
    expect(version.timestamp).to.equal(0)
    expect(version.price).to.equal(0)
    expect(version.valid).to.be.false

    // commit a new version
    const newTimestamp = (await currentBlockTimestamp()) - 5
    await commitPrice(newTimestamp, parse6decimal('3456.789'))

    // validate the commit worked
    version = await keeperOracle.latest()
    expect(version.timestamp).to.equal(newTimestamp)
    expect(version.price).to.equal(parse6decimal('3456.789'))
    expect(version.valid).to.be.true
  })

  it('cannot commit invalid prices', async () => {
    const keeperFactorySigner = await impersonateWithBalance(keeperOracleFactory.address, utils.parseEther('10'))
    const newTimestamp = (await currentBlockTimestamp()) - 4
    const oracleVersion = {
      timestamp: newTimestamp,
      price: parse6decimal('0.000555'),
      valid: false,
    }
    expect(
      keeperOracle.connect(keeperFactorySigner).commit(oracleVersion, receiver.address, { maxFeePerGas: 100000000 }),
    ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
  })

  it('cannot commit prices which would overflow or underflow', async () => {
    const STORAGE_SIZE = 64
    const keeperFactorySigner = await impersonateWithBalance(keeperOracleFactory.address, utils.parseEther('10'))
    const newTimestamp = (await currentBlockTimestamp()) - 3

    const overflowPrice = BigNumber.from(2).pow(STORAGE_SIZE).add(2)
    const oracleVersion = {
      timestamp: newTimestamp,
      price: overflowPrice,
      valid: true,
    }
    expect(
      keeperOracle.connect(keeperFactorySigner).commit(oracleVersion, receiver.address, { maxFeePerGas: 100000000 }),
    ).to.be.reverted

    const underflowPrice = BigNumber.from(2).pow(STORAGE_SIZE).add(2).mul(-1)
    oracleVersion.price = underflowPrice
    expect(
      keeperOracle.connect(keeperFactorySigner).commit(oracleVersion, receiver.address, { maxFeePerGas: 100000000 }),
    ).to.be.reverted
  })

  it('reverts committing 0 timestamp', async () => {
    const badOracleVersion = {
      timestamp: 0,
      price: parse6decimal('63.48'),
      valid: true,
    }
    const keeperFactorySigner = await impersonateWithBalance(keeperOracleFactory.address, utils.parseEther('10'))
    await expect(
      keeperOracle.connect(keeperFactorySigner).commit(badOracleVersion, receiver.address, {
        maxFeePerGas: 100000000,
      }),
    ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
  })

  it('reverts requesting no new price before a new price', async () => {
    await expect(
      keeperOracle.connect(oracleSigner).request(market.address, user.address, false),
    ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleNoPriorRequestsError')
  })

  it('discards expired prices', async () => {
    // establish an initial valid version
    const startTime = await currentBlockTimestamp()
    const initialTimestamp = startTime - 4
    await commitPrice(initialTimestamp, parse6decimal('3333.777'))

    // request a version
    await increase(10)
    const tx = await keeperOracle.connect(oracleSigner).request(market.address, user.address, true, {
      maxFeePerGas: 100000000,
    })
    // TODO: weaponize this transaction-to-blocktime facility into a utility function
    const requestedTime = (await ethers.provider.getBlock(tx.blockNumber!)).timestamp

    // attempt to commit a requested price older than the timeout
    await increase(KEEPER_ORACLE_TIMEOUT + 1)

    // enable market settlement callback
    market.settle.whenCalledWith(ethers.constants.AddressZero).returns()

    await commitPrice(requestedTime, parse6decimal('3333.444'))

    // ensure carryover price is received instead of invalid price
    const invalidPrice = await keeperOracle.at(requestedTime)
    expect(invalidPrice[0].timestamp).to.equal(requestedTime)
    expect(invalidPrice[0].price).to.equal(parse6decimal('3333.777'))
    expect(invalidPrice[0].valid).to.be.false
  })
})
