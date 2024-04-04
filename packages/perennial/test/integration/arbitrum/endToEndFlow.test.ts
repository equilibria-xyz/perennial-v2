import { expect } from 'chai'
import HRE from 'hardhat'
import { createMarket, deployProtocolForOracle, InstanceVarsBasic, settle } from '../helpers/setupHelpers'
import {
  DEFAULT_ORDER,
  DEFAULT_POSITION,
  DEFAULT_LOCAL,
  DEFAULT_VERSION,
  DEFAULT_CHECKPOINT,
  expectOrderEq,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
  expectCheckpointEq,
} from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { Market } from '@equilibria/perennial-v2-oracle/types/generated'
import { constants } from '../../../../common/testutil'
import { TIMESTAMP_1 } from '../mainnet/fees.test'
import { currentBlockTimestamp, increaseTo } from '../../../../common/testutil/time'

// arbitrum addresses
const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413'
const ORACLE_FACTORY_OWNER = '0xdA381aeD086f544BaC66e73C071E158374cc105B'
const ETH_USDC_ORACLE_PROVIDER = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A'
const DSU_MINTER = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

// fork-relevant timestamps
const TIMESTAMP_0 = 1712161580
const TIMESTAMP_1 = TIMESTAMP_0 + 10 * 60

describe('End to End Flow', () => {
  let instanceVars: InstanceVarsBasic
  let market: Market

  const realOracleFixture = async () => {
    const oracleFactory = await HRE.ethers.getContractAt('IOracleProviderFactory', ORACLE_FACTORY)
    const oracleProvider = await HRE.ethers.getContractAt('IOracleProvider', ETH_USDC_ORACLE_PROVIDER)

    expect(oracleProvider.address).to.not.be.undefined
    instanceVars = await deployProtocolForOracle(oracleFactory, ORACLE_FACTORY_OWNER, oracleProvider, DSU_MINTER)
  }

  beforeEach(async () => {
    await loadFixture(realOracleFixture)
    const { user, oracle, dsu } = instanceVars

    // TODO: move into fixture if this is the only market we'll create
    market = await createMarket(instanceVars, oracle)
    await dsu.connect(user).approve(market.address, parse6decimal('10000').mul(1e12))
  })

  it('creates a market using real oracle', async () => {
    const { oracle, dsu } = instanceVars

    expect(market.address).to.not.be.undefined
    expect(await market.token()).to.equal(dsu.address)
    expect(await market.oracle()).to.equal(oracle.address)

    const [latestVersion, currentTimestamp] = await oracle.status()
    expect(latestVersion.timestamp).to.equal(TIMESTAMP_0)
    expect(latestVersion.price).to.equal(parse6decimal('3355.394928'))
    expect(latestVersion.valid).to.equal(true)
    expect(currentTimestamp).to.equal(1712168030)
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('2')
    const COLLATERAL = parse6decimal('10000')
    const { user, dsu, marketImpl } = instanceVars

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await increaseTo(TIMESTAMP_1)
    expect(await currentBlockTimestamp()).to.equal(TIMESTAMP_1)

    // FIXME: the timestamp seems nondeterministic, even when controlling the current block timestamp
    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, TIMESTAMP_1, POSITION, 0, 0, COLLATERAL, false, constants.AddressZero)
    // .to.emit(market, 'OrderCreated')
    // .withArgs(user.address, {
    //   ...DEFAULT_ORDER,
    //   timestamp: TIMESTAMP_1,
    //   orders: 1,
    //   collateral: COLLATERAL,
    //   makerPos: POSITION,
    // })
    return

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_1), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })

    // Check global state
    expectGlobalEq(await market.global(), {
      currentId: 1,
      latestId: 0,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
      exposure: 0,
    })
    expectOrderEq(await market.pendingOrder(1), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_1,
      orders: 1,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_0,
    })
    expectVersionEq(await market.versions(TIMESTAMP_0), {
      ...DEFAULT_VERSION,
      liquidationFee: { _value: parse6decimal('-10.00') },
    })

    // Settle the market with a new oracle version
    // TODO: update oracle
    //await chainlink.next()
    await settle(market, user)

    // check user state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 2,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
    })
    expectCheckpointEq(await market.checkpoints(user.address, TIMESTAMP_2), {
      ...DEFAULT_CHECKPOINT,
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })

    // Check global post-settlement state
    expectGlobalEq(await market.global(), {
      currentId: 2,
      latestId: 1,
      protocolFee: 0,
      riskFee: 0,
      oracleFee: 0,
      donation: 0,
      exposure: 0,
    })
    expectOrderEq(await market.pendingOrder(2), {
      ...DEFAULT_ORDER,
      timestamp: TIMESTAMP_2,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: TIMESTAMP_1,
      maker: POSITION,
    })
  })
})
