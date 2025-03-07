import 'hardhat'
import { expect } from 'chai'
import { BigNumber, BigNumberish, constants, ContractTransaction, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'
const { deployments, ethers } = HRE

import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { currentBlockTimestamp, includeAt, increaseTo } from '../../../../common/testutil/time'
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
import {
  DEFAULT_CHECKPOINT,
  DEFAULT_ORDER,
  DEFAULT_POSITION,
  expectCheckpointEq,
  expectOrderEq,
  expectPositionEq,
  parse6decimal,
} from '../../../../common/testutil/types'

const INITIAL_DEPOSIT = parse6decimal('200000')
const MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE = 'update(address,int256,int256,int256,address)'

describe('Cross Margin', () => {
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let marketFactory: IMarketFactory
  let margin: Margin
  let marketA: MarketWithOracle
  let marketB: MarketWithOracle
  let marketC: MarketWithOracle
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
    marketC = await createMarketWithOracle(
      '0x000000000000000000000000000000000000000000000000000000000000000c',
      'TOKENC-USD',
    )

    // commit initial prices
    const initialTimestamp = (await currentBlockTimestamp()) - 3
    await advanceToPrice(marketA, userA, initialTimestamp, parse6decimal('100'))
    await advanceToPrice(marketB, userA, initialTimestamp, parse6decimal('500'))
    await advanceToPrice(marketC, userA, initialTimestamp, parse6decimal('30000'))

    // fund wallets with 200k and deposit all into margin contract
    await fundWallet(dsu, userA)
    await fundWallet(dsu, userB)
    await dsu.connect(userA).approve(margin.address, constants.MaxUint256)
    await dsu.connect(userB).approve(margin.address, constants.MaxUint256)
    await margin.connect(userA).deposit(userA.address, INITIAL_DEPOSIT)
    await margin.connect(userB).deposit(userB.address, INITIAL_DEPOSIT)
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
    await market.updateRiskParameter({
      ...STANDARD_RISK_PARAMETER,
      staleAfter: 30 * 60, // prices stale after 30 minutes
    })
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
    settle = true,
  ): Promise<number> {
    const keeperFactoryAddress = await market.keeperOracle.factory()
    const oracleFactory = await impersonateWithBalance(keeperFactoryAddress, utils.parseEther('10'))

    // a keeper cannot commit a future price, so advance past the block
    const currentBlockTime = await currentBlockTimestamp()
    if (currentBlockTime < timestamp) {
      // console.log('advanceToPrice increasing by two seconds from', currentBlockTime, 'to', timestamp + 2)
      await increaseTo(timestamp + 2)
    } else {
      // console.log('advanceToPrice commiting at', currentBlockTime)
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

    if (settle) await market.market.connect(user).settle(user.address)

    // inform the caller of the commitment timestamp
    return await getTimestamp(tx)
  }

  async function getPrice(market: IMarket): Promise<BigNumber> {
    const oracle = IOracle__factory.connect(await market.oracle(), owner)
    const latestVersion = await oracle.latest()
    return latestVersion.price
  }

  // changes position and returns the timestamp of the version created
  async function changePosition(
    market: MarketWithOracle,
    user: SignerWithAddress,
    makerDelta: BigNumberish,
    takerDelta: BigNumberish,
  ): Promise<number> {
    const tx = await changePositionImpl(market, user, makerDelta, takerDelta)
    await expect(tx).to.not.be.reverted
    return await getTimestamp(tx)
  }

  // returns a TX promise for changing position, suitable for wrapping in an includeAt directive
  function changePositionImpl(
    market: MarketWithOracle,
    user: SignerWithAddress,
    makerDelta: BigNumberish,
    takerDelta: BigNumberish,
  ): Promise<ContractTransaction> {
    return market.market
      .connect(user)
      [MARKET_UPDATE_MAKER_TAKER_DELTA_PROTOTYPE](user.address, makerDelta, takerDelta, 0, constants.AddressZero)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    // console.log('test starting at block time', await currentBlockTimestamp()) // 1646459115
  })

  it('fixture sets up test environment', async () => {
    // ensure unique markets were created
    expect(marketA.market.address).to.not.equal(marketB.market.address)

    // prove initial prices were committed to oracles
    expect(await getPrice(marketA.market)).to.equal(parse6decimal('100'))
    expect(await getPrice(marketB.market)).to.equal(parse6decimal('500'))
    expect(await getPrice(marketC.market)).to.equal(parse6decimal('30000'))

    // confirm funds were deposited into margin contract
    expect(await margin.crossMarginBalances(userA.address)).to.equal(INITIAL_DEPOSIT)
    expect(await margin.crossMarginBalances(userB.address)).to.equal(INITIAL_DEPOSIT)
  })

  it('prevent withdrawal if price is stale in a cross-margined market', async () => {
    const timestampA = await changePosition(marketA, userA, parse6decimal('700'), 0)
    expect(await margin.isCrossed(userA.address, marketA.market.address)).to.equal(true)
    const timestampB = await changePosition(marketB, userA, parse6decimal('100'), 0)
    expect(await margin.isCrossed(userA.address, marketB.market.address)).to.equal(true)

    // at prices 100 and 500, userA's margin requirements are 700*100*0.3 + 100*500*0.3 = 21k + 15k = 36k
    // user has 200k cross-margined, so could remove 164k at these prices
    let marginRequiredA = await marketA.market.marginRequired(userA.address, 0)
    const marginRequiredB = await marketB.market.marginRequired(userA.address, 0)
    expect(marginRequiredA).to.equal(parse6decimal('21000'))
    expect(marginRequiredB).to.equal(parse6decimal('15000'))
    expect(marginRequiredA.add(marginRequiredB)).to.equal(parse6decimal('36000'))

    // marketA price moons from 100 to 777, impacting userA's margin requirements
    // 700*777*0.3 + 15k = 163170 + 15k = 178170
    await advanceToPrice(marketA, userA, timestampA, parse6decimal('777'))
    marginRequiredA = await marketA.market.marginRequired(userA.address, 0)
    expect(marginRequiredA.add(marginRequiredB)).to.equal(parse6decimal('178170'))
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestampA), {
      ...DEFAULT_CHECKPOINT,
      transfer: parse6decimal('200000'),
    })

    // user can no longer withdraw 30k
    await expect(margin.connect(userA).withdraw(userA.address, parse6decimal('30000'))).to.be.revertedWithCustomError(
      margin,
      'MarketInsufficientMarginError',
    )

    // cannot withdraw 20k because marketB price is stale
    await increaseTo(timestampB + 3600)
    expect(await marketB.market.stale()).to.equal(true)
    await expect(margin.connect(userA).withdraw(userA.address, parse6decimal('20000'))).to.be.revertedWithCustomError(
      margin,
      'MarketStalePriceError',
    )
  })

  it('maintains margin requirements', async () => {
    // userA creates maker positions; markets are cross-margined by default
    const timestampA = await changePosition(marketA, userA, parse6decimal('1000'), 0)
    expect(await margin.isCrossed(userA.address, marketA.market.address)).to.equal(true)
    const timestampB = await changePosition(marketB, userA, parse6decimal('300'), 0)
    expect(await margin.isCrossed(userA.address, marketB.market.address)).to.equal(true)

    // commit requested prices
    await advanceToPrice(marketA, userA, timestampA, parse6decimal('101'))
    await advanceToPrice(marketB, userA, timestampB, parse6decimal('499'))

    // confirm cross-margin positions were settled
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

    // check margin
    const marginA = await marketA.market.marginRequired(userA.address, 0)
    expect(marginA).to.equal(parse6decimal('30300'))
    const marginB = await marketB.market.marginRequired(userA.address, 0)
    expect(marginB).to.equal(parse6decimal('44910'))

    // cannot remove more collateral than is needed to maintain margin requirements
    const maxWithdrawl = INITIAL_DEPOSIT.sub(marginA).sub(marginB)
    await expect(margin.connect(userA).withdraw(userA.address, maxWithdrawl.add(1))).to.be.revertedWithCustomError(
      margin,
      'MarketInsufficientMarginError',
    )

    // cannot isolate more collateral than is needed to maintain margin requirements for crossed markets
    await expect(
      margin.connect(userA).isolate(userA.address, marketC.market.address, maxWithdrawl.add(1)),
    ).to.be.revertedWithCustomError(margin, 'MarketInsufficientMarginError')

    // can isolate slighty less collateral than is needed to maintain margin requirements for crossed markets
    await expect(margin.connect(userA).isolate(userA.address, marketC.market.address, maxWithdrawl.sub(1))).to.not.be
      .reverted
    expect(await margin.isolatedBalances(userA.address, marketC.market.address)).to.equal(maxWithdrawl.sub(1))
  })

  it('collects pnl and fees', async () => {
    // userA creates maker positions
    const timestamp1 = (await currentBlockTimestamp()) + 60
    await includeAt(async () => {
      await changePositionImpl(marketA, userA, parse6decimal('1000'), 0)
      await changePositionImpl(marketB, userA, parse6decimal('600'), 0)
    }, timestamp1)
    await advanceToPrice(marketA, userA, timestamp1, parse6decimal('105'))
    await advanceToPrice(marketB, userA, timestamp1, parse6decimal('510'))
    expect(await margin.crossMarginBalances(userA.address)).to.equal(INITIAL_DEPOSIT)
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp1), {
      ...DEFAULT_CHECKPOINT,
      transfer: INITIAL_DEPOSIT,
    })

    // userB shorts both markets, such that userA has long exposure
    const timestamp2 = timestamp1 + 60
    await includeAt(async () => {
      await changePositionImpl(marketA, userB, 0, parse6decimal('-750'))
      await changePositionImpl(marketB, userB, 0, parse6decimal('-450'))
    }, timestamp2)
    await advanceToPrice(marketA, userB, timestamp2, parse6decimal('110'))
    await advanceToPrice(marketB, userB, timestamp2, parse6decimal('525'))
    let balanceB = await margin.crossMarginBalances(userB.address)
    expect(balanceB).to.equal(INITIAL_DEPOSIT)
    expectCheckpointEq(await margin.crossMarginCheckpoints(userB.address, timestamp2), {
      ...DEFAULT_CHECKPOINT,
      transfer: INITIAL_DEPOSIT,
    })

    // prices went up; commit unrequested prices and settle userB
    const timestamp3 = timestamp2 + 3600
    await increaseTo(timestamp3)
    await advanceToPrice(marketA, userB, timestamp3, parse6decimal('150'))
    await advanceToPrice(marketB, userB, timestamp3, parse6decimal('650'))
    // userA did not settle at timestamp2 and should have no checkpoint written
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp2), {
      ...DEFAULT_CHECKPOINT,
    })
    // userB checkpoint at timestamp2 should not have changed
    expectCheckpointEq(await margin.crossMarginCheckpoints(userB.address, timestamp2), {
      ...DEFAULT_CHECKPOINT,
      transfer: INITIAL_DEPOSIT,
    })
    // userB checkpoint at timestamp3 should reflect loss
    balanceB = await margin.crossMarginBalances(userB.address)
    expect(balanceB).to.equal(parse6decimal('113722.6181'))
    expectCheckpointEq(await margin.crossMarginCheckpoints(userB.address, timestamp3), {
      ...DEFAULT_CHECKPOINT,
      collateral: balanceB,
    })

    // settle userA
    await marketA.market.settle(userA.address)
    await marketB.market.settle(userA.address)
    // again, userA did not settle at timestamp2 and should have no checkpoint written
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp2), {
      ...DEFAULT_CHECKPOINT,
    })
    // userA collateral should have increased at timestamp3
    const balanceA = await margin.crossMarginBalances(userA.address)
    expect(balanceA).to.equal(parse6decimal('286274.6426'))
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp3), {
      ...DEFAULT_CHECKPOINT,
      collateral: balanceA,
    })
  })

  it('implicitly deisolates when closing position', async () => {
    // userA isolates some collateral
    await margin.connect(userA).isolate(userA.address, marketA.market.address, parse6decimal('1000'))

    // settlement with no position should not deisolate
    await marketA.market.settle(userA.address)
    expect(await margin.isolatedBalances(userA.address, marketA.market.address)).to.equal(parse6decimal('1000'))
    expect(await margin.isIsolated(userA.address, marketA.market.address)).to.equal(true)

    // userA creates isolated maker position
    let timestamp = await changePosition(marketA, userA, parse6decimal('20'), 0)
    await advanceToPrice(marketA, userA, timestamp, parse6decimal('100.5'))
    expectPositionEq(await marketA.market.positions(userA.address), {
      ...DEFAULT_POSITION,
      maker: parse6decimal('20'),
      timestamp: timestamp,
    })
    expect(await margin.isolatedBalances(userA.address, marketA.market.address)).to.equal(parse6decimal('1000'))
    expect(await margin.isIsolated(userA.address, marketA.market.address)).to.equal(true)

    // userA closes position
    timestamp = await changePosition(marketA, userA, parse6decimal('-20'), 0)
    await advanceToPrice(marketA, userA, timestamp, parse6decimal('100.6'))
    expectPositionEq(await marketA.market.positions(userA.address), {
      ...DEFAULT_POSITION,
      timestamp: timestamp,
    })

    // userA balance should be deisolated
    expect(await margin.isolatedBalances(userA.address, marketA.market.address)).to.equal(0)
    expect(await margin.isIsolated(userA.address, marketA.market.address)).to.equal(false)
    expectCheckpointEq(await marketA.market.checkpoints(userA.address, timestamp), {
      ...DEFAULT_CHECKPOINT,
      transfer: parse6decimal('-1000'),
      collateral: parse6decimal('1000'),
    })

    // userA opens a new isolated position
    await margin.connect(userA).isolate(userA.address, marketA.market.address, parse6decimal('600'))
    timestamp = await changePosition(marketA, userA, parse6decimal('10'), 0)
    await advanceToPrice(marketA, userA, timestamp, parse6decimal('100.7'))

    // checkpoint records the correct amount of collateral
    expect(await margin.isolatedBalances(userA.address, marketA.market.address)).to.equal(parse6decimal('600'))
    expect(await margin.isIsolated(userA.address, marketA.market.address)).to.equal(true)
    expectCheckpointEq(await marketA.market.checkpoints(userA.address, timestamp), {
      ...DEFAULT_CHECKPOINT,
      collateral: parse6decimal('600'),
    })
  })

  it('depsosit and withdrawal is checkpointed without position change', async () => {
    // userB starts with only 100k
    const INITIAL_DEPOSIT_B = parse6decimal('100000')
    await margin.connect(userB).withdraw(userB.address, INITIAL_DEPOSIT_B)

    // userA opens a cross-margin position in two markets
    const timestamp1 = (await currentBlockTimestamp()) + 60
    console.log('timestamp1', timestamp1)
    await includeAt(async () => {
      await changePositionImpl(marketA, userA, parse6decimal('200'), 0)
      await changePositionImpl(marketB, userA, parse6decimal('50'), 0)
    }, timestamp1)

    // after settlement should have a cross-margin checkpoint but no isolated checkpoints
    await advanceToPrice(marketA, userA, timestamp1, parse6decimal('100.1'))
    // note this checkpoint is "unfinalized", as marketB has not yet settled
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp1), {
      ...DEFAULT_CHECKPOINT,
      transfer: INITIAL_DEPOSIT,
    })
    expectCheckpointEq(await margin.isolatedCheckpoints(userA.address, marketA.market.address, timestamp1), {
      ...DEFAULT_CHECKPOINT,
    })
    expectCheckpointEq(await margin.isolatedCheckpoints(userA.address, marketB.market.address, timestamp1), {
      ...DEFAULT_CHECKPOINT,
    })

    // userB opens a short position in marketB
    const timestamp2 = timestamp1 + 60 * 5
    await includeAt(async () => {
      await changePositionImpl(marketB, userB, 0, parse6decimal('-25'))
    }, timestamp2)
    // need to commit timestamp1 price for userA before userB can settle timestamp2
    await advanceToPrice(marketB, userA, timestamp1, parse6decimal('500.1'), false)
    await advanceToPrice(marketB, userB, timestamp2, parse6decimal('500.2'))

    // userA decides to withdraw some funds without position change
    const timestamp3 = timestamp2 + 60 * 5
    const withdrawalA = parse6decimal('2500')
    await includeAt(async () => {
      await margin.connect(userA).withdraw(userA.address, withdrawalA)
    }, timestamp3)
    expect(await margin.crossMarginBalances(userA.address)).to.equal(INITIAL_DEPOSIT.sub(withdrawalA))

    // userA should have no checkpoint at timestamp2 (no activity) or timestamp3 (not yet settled)
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp2), {
      ...DEFAULT_CHECKPOINT,
    })
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp3), {
      ...DEFAULT_CHECKPOINT,
    })

    // userA settles; should have a checkpoint at timestamp3
    await advanceToPrice(marketA, userA, timestamp3, parse6decimal('100.3'))
    expectCheckpointEq(await margin.crossMarginCheckpoints(userA.address, timestamp3), {
      ...DEFAULT_CHECKPOINT,
      transfer: -withdrawalA,
      collateral: INITIAL_DEPOSIT,
    })

    // concerned over price movement, userB recollateralizes without position change
    const timestamp4 = timestamp3 + 60 * 5
    const depositB = parse6decimal('3500')
    await includeAt(async () => {
      await margin.connect(userB).deposit(userB.address, depositB)
    }, timestamp4)
    expect(await margin.crossMarginBalances(userB.address)).to.equal(INITIAL_DEPOSIT_B.add(depositB))

    // userB settles; should have a checkpoint at timestamp4
    await advanceToPrice(marketB, userB, timestamp4, parse6decimal('500.3'))
    expectCheckpointEq(await margin.crossMarginCheckpoints(userB.address, timestamp4), {
      ...DEFAULT_CHECKPOINT,
      transfer: depositB,
      collateral: INITIAL_DEPOSIT_B,
    })
  })
})
