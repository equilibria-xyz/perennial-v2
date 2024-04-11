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
} from '../../../types/generated'
import { utils, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { fail } from 'assert'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { parse6decimal } from '../../../../common/testutil/types'
import { expect } from 'chai'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

describe('KeeperOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let keeperOracle: KeeperOracle
  let keeperOracleFactory: KeeperFactory

  let pyth: FakeContract<AbstractPyth>
  let dsu: FakeContract<IERC20Metadata>

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()
    // Base fee isn't working properly in coverage, so we need to set it manually
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])

    // TODO: move most of this stuff to a fixture to reuse chain state for multiple tests

    // mock external components
    const pyth = await smock.fake<AbstractPyth>('AbstractPyth')
    pyth.priceFeedExists.returns(true)
    const chainlinkFeed = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    const dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu.transfer.returns(true)

    // deploy prerequisites
    const oracleImpl = await new Oracle__factory(owner).deploy()
    const oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize(dsu.address)
    await oracleFactory.updateMaxClaim(parse6decimal('10'))

    const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
    keeperOracleFactory = await new PythFactory__factory(owner).deploy(
      pyth.address,
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
    await keeperOracleFactory.initialize(oracleFactory.address, chainlinkFeed.address, dsu.address)
    await oracleFactory.register(keeperOracleFactory.address)
    await keeperOracleFactory.authorize(oracleFactory.address)

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
  })

  it('can commit new prices', async () => {
    // validate initial (empty) state
    let version = await keeperOracle.latest()
    expect(version.timestamp).to.equal(0)
    expect(version.price).to.equal(0)
    expect(version.valid).to.be.false

    // commit a new version
    const newTimestamp = (await currentBlockTimestamp()) - 5
    const newVersion = {
      timestamp: newTimestamp,
      price: parse6decimal('3456.789'),
      valid: true,
    }
    const keeperFactorySigner = await impersonateWithBalance(keeperOracleFactory.address, utils.parseEther('10'))
    await expect(
      keeperOracle.connect(keeperFactorySigner).commit(newVersion, {
        maxFeePerGas: 100000000,
      }),
    ).to.emit(keeperOracle, 'OracleProviderVersionFulfilled')

    // validate the commit worked
    version = await keeperOracle.latest()
    expect(version.timestamp).to.equal(newTimestamp)
    expect(version.price).to.equal(parse6decimal('3456.789'))
    expect(version.valid).to.be.true
  })

  it.skip('discards expired prices', async () => {
    fail('not yet implemented')
  })
})
