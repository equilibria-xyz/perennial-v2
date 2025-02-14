import 'hardhat'
import { expect } from 'chai'
import { BigNumber, BigNumberish, constants, ContractTransaction, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'
const { deployments, ethers } = HRE

import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { currentBlockTimestamp, increaseTo } from '../../../../common/testutil/time'
import { getTimestamp } from '../../../../common/testutil/transaction'

import {
  ChainlinkFactory,
  IOracle,
  IOracle__factory,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle__factory,
  OracleFactory,
} from '@perennial/v2-oracle/types/generated'
import { OracleVersionStruct } from '@perennial/v2-oracle/types/generated/contracts/Oracle'

import {
  deployChainlinkOracleFactory,
  deployMargin,
  deployMarketFactory,
  deployOracleFactory,
  fundWallet,
  STANDARD_MARKET_PARAMETER,
  STANDARD_PROTOCOL_PARAMETERS,
  STANDARD_RISK_PARAMETER,
} from '../helpers/setupHelpers'
import {
  IERC20Metadata__factory,
  IMarket,
  IMarketFactory,
  Margin,
  Market__factory,
  Verifier__factory,
} from '../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { DEFAULT_POSITION, expectPositionEq, parse6decimal } from '../../../../common/testutil/types'

const MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE = 'update(address,int256,int256,int256,address)'

describe('Cross Margin', () => {
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let marketFactory: IMarketFactory
  let margin: Margin
  let marketA: MarketWithOracle
  let marketB: MarketWithOracle
  let oracleFactory: OracleFactory
  let chainlinkOracleFactory: ChainlinkFactory

  interface MarketWithOracle {
    market: IMarket
    oracle: IOracle
    keeperOracle: KeeperOracle
  }

  async function fixture() {
    ;[owner, userA, userB] = await ethers.getSigners()

    oracleFactory = await deployOracleFactory(owner)
    await oracleFactory.connect(owner).initialize()

    const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
    const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)
    const verifier = await new Verifier__factory(owner).deploy()
    margin = await deployMargin(dsu, owner)
    let marketImpl
    ;[marketFactory, marketImpl] = await deployMarketFactory(oracleFactory, margin, verifier, owner)
    await marketFactory.connect(owner).initialize()
    expect(await marketFactory.owner()).to.equal(owner.address)
    await marketFactory.updateParameter(STANDARD_PROTOCOL_PARAMETERS)
    await margin.initialize(marketFactory.address)

    chainlinkOracleFactory = await deployChainlinkOracleFactory(owner, oracleFactory)
    expect(await oracleFactory.factories(chainlinkOracleFactory.address)).to.equal(true)
    expect(await oracleFactory.owner()).to.equal(owner.address)
    expect(await chainlinkOracleFactory.owner()).to.equal(owner.address)

    // create markets, each with a unique oracle
    marketA = await createMarketWithOracle(
      '0x000000000000000000000000000000000000000000000000000000000000000a',
      'TOKENA-USD',
    )
    marketB = await createMarketWithOracle(
      '0x000000000000000000000000000000000000000000000000000000000000000b',
      'TOKENB-USD',
    )

    // commit initial prices
    const initialTimestamp = (await currentBlockTimestamp()) - 3
    await advanceToPrice(marketA, userA, initialTimestamp, parse6decimal('100'))
    await advanceToPrice(marketB, userA, initialTimestamp, parse6decimal('500'))

    // fund wallets with 200k and deposit into margin contract
    await fundWallet(dsu, userA)
    await fundWallet(dsu, userB)
    await dsu.connect(userA).approve(margin.address, constants.MaxUint256)
    await dsu.connect(userB).approve(margin.address, constants.MaxUint256)
    await margin.connect(userA).deposit(userA.address, parse6decimal('200000'))
    await margin.connect(userB).deposit(userB.address, parse6decimal('200000'))
  }

  async function createOracle(id: string, name: string): Promise<[IOracle, KeeperOracle]> {
    const payoffDefinition = {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    }
    // create the keeper oracle (implementation)
    const keeperOracle = KeeperOracle__factory.connect(
      await chainlinkOracleFactory.callStatic.create(id, id, payoffDefinition),
      owner,
    )
    await chainlinkOracleFactory.create(id, id, payoffDefinition)
    expect(await chainlinkOracleFactory.oracles(id)).to.equal(keeperOracle.address)

    // create the oracle (which interacts with the market)
    const oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(id, chainlinkOracleFactory.address, name),
      owner,
    )
    await oracleFactory.create(id, chainlinkOracleFactory.address, name)
    await keeperOracle.register(oracle.address)

    return [oracle, keeperOracle]
  }

  async function createMarketWithOracle(id: string, name: string): Promise<MarketWithOracle> {
    const [oracle, keeperOracle] = await createOracle(id, name)
    const marketAddress = await marketFactory.callStatic.create(oracle.address)
    await marketFactory.create(oracle.address)

    const market = Market__factory.connect(marketAddress, owner)
    await market.updateRiskParameter(STANDARD_RISK_PARAMETER)
    await market.updateParameter(STANDARD_MARKET_PARAMETER)

    await oracle.register(market.address)

    return { market, oracle, keeperOracle }
  }

  // Simulates an oracle update from KeeperOracle.
  // If timestamp matches a requested version, callbacks implicitly settle the market.
  // Explicitly settles the user.
  async function advanceToPrice(
    market: MarketWithOracle,
    user: SignerWithAddress,
    timestamp: number,
    price: BigNumber,
  ): Promise<number> {
    const keeperFactoryAddress = await market.keeperOracle.factory()
    const oracleFactory = await impersonateWithBalance(keeperFactoryAddress, utils.parseEther('10'))

    // a keeper cannot commit a future price, so advance past the block
    const currentBlockTime = await currentBlockTimestamp()
    if (currentBlockTime < timestamp) {
      await increaseTo(timestamp + 2)
    }
    // create a version with the desired parameters and commit to the KeeperOracle
    const oracleVersion: OracleVersionStruct = {
      timestamp: BigNumber.from(timestamp),
      price: price,
      valid: true,
    }
    const tx: ContractTransaction = await market.keeperOracle
      .connect(oracleFactory)
      .commit(oracleVersion, user.address, 0)

    market.market.connect(user).settle(user.address)

    // inform the caller of the current timestamp
    return await getTimestamp(tx)
  }

  async function getPrice(market: IMarket): Promise<BigNumber> {
    const oracle = IOracle__factory.connect(await market.oracle(), owner)
    const latestVersion = await oracle.latest()
    return latestVersion.price
  }

  async function changePosition(
    market: MarketWithOracle,
    user: SignerWithAddress,
    makerDelta: BigNumberish,
    takerDelta: BigNumberish,
  ): Promise<number> {
    const tx = await market.market
      .connect(user)
      [MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE](user.address, makerDelta, takerDelta, 0, constants.AddressZero)
    return await getTimestamp(tx)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  it('fixture sets up test environment', async () => {
    // ensure unique markets were created
    expect(marketA.market.address).to.not.equal(marketB.market.address)

    // prove initial prices were committed to oracles
    expect(await getPrice(marketA.market)).to.equal(parse6decimal('100'))
    expect(await getPrice(marketB.market)).to.equal(parse6decimal('500'))

    // confirm funds were deposited into margin contract
    expect(await margin.crossMarginBalances(userA.address)).to.equal(parse6decimal('200000'))
    expect(await margin.crossMarginBalances(userB.address)).to.equal(parse6decimal('200000'))
  })

  it('markets are cross-margined by default', async () => {
    const timestampA = await changePosition(marketA, userA, parse6decimal('1000'), 0)
    expect(await margin.isCrossed(userA.address, marketA.market.address)).to.equal(true)
    const timestampB = await changePosition(marketB, userA, parse6decimal('300'), 0)
    expect(await margin.isCrossed(userA.address, marketB.market.address)).to.equal(true)

    // commit requested prices
    await advanceToPrice(marketA, userA, timestampA, parse6decimal('101'))
    await advanceToPrice(marketB, userA, timestampB, parse6decimal('499'))

    // confirm cross-margin positions were settled
    console.log(await marketA.market.positions(userA.address))
    expectPositionEq(await marketA.market.positions(userA.address), {
      ...DEFAULT_POSITION,
      maker: parse6decimal('1000'),
      timestamp: timestampA,
    })
    expectPositionEq(await marketB.market.positions(userA.address), {
      ...DEFAULT_POSITION,
      maker: parse6decimal('300'),
      timestamp: timestampB,
    })
  })
})
