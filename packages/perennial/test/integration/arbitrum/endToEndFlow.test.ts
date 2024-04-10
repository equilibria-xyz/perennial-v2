import { expect } from 'chai'
import HRE, { ethers } from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
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
import {
  KeeperOracle,
  KeeperOracle__factory,
  PythFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { currentBlockTimestamp, increaseTo } from '../../../../common/testutil/time'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { Market } from '../../../types/generated'

const { AddressZero } = constants

// arbitrum addresses
const KEEPER_FACTORY = '0x6b60e7c96B4d11A63891F249eA826f8a73Ef4E6E' // PythFactory_Arbitrum for deploying the top level oracles
const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413' // OracleFactory used by MarketFactory
const ORACLE_FACTORY_OWNER = '0xdA381aeD086f544BaC66e73C071E158374cc105B' // TimelockController
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const ETH_USD_KEEPER_ORACLE = '0xf9249EC6785221226Cb3f66fa049aA1E5B6a4A57' // KeeperOracle
const ETH_USD_ORACLE = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A' // Oracle with id 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
const DSU_MINTER = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27' // DSU SimpleReserve
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Market implementation

// fork-relevant timestamps
const TIMESTAMP_0 = 1712161580 // Wed Apr 03 2024 16:26:20 GMT+0000
const PRICE_0 = parse6decimal('3355.394928') // ETH-USD

// queried from https://hermes.pyth.network/docs/#/rest/get_vaa
const VAA_HOUR_LATER =
  'UE5BVQEAAAADuAEAAAADDQF1qHkUupuhCBFVGh5RAyxAHN5cfMki8m3fQmQwVso4JWqrrNIV9Ch+sXVAn0k/YH2R5zWyIwYuPBCtodXpvFmZAAIP3JKeIB/SuHT1sIw20hOjCGFihO86zQmFGHhmNfjisjuqS4BAJbGNrmmxwOvRqJrCFGRQSb1B9wHoc6KYcp88AANMAKU5Y57f6HgL91bRA0YjfcUiHOfM5oMHIaqI7Ct7u0HXB6wWu9SLQ1koqHzEK00+FTCqnj2zZcxUFcj2jxlKAARr0mbDQvl8qZ65BZ0/JstJsmtDSlxIBgDMkCumBHLXxXA2T6/Gabk5ksR0rXDm114zZqSWL4IkDAPthLxIr/J/AQZ/GhH2aZMhcsx3tt7Bzx3YyiyWCTK7Zr5jXzI0Pv4wWnNqlmAFuXjyFarZLNzUcFnrgTWwa5DdaH3SX2FEMVuTAAfn6sEq+8p72qSfxEAMugF2A+3gLV508m+YMjZLDrjjGXftB2mSIatdkPb89/SmHEG9mGZgmBLo88zOpwea3Py3AQhvXRARaHwHMykE1Lf6VefEjbje8ZnI4N88UZZiV/eVfi/BkLTwrt6jDjueS4rYRxoj/lORlvr5NVcHz6O5N0bHAQmH0k2GHEIZQhuWbnOixSaK3KHmDXxf5/gdcP72uoAUl3yh/JpsJH1N9wsZrbrC+Yb4UwGrKL2Y8Z2WvZLvn8I4AQo9+4EOru3+6k9VpJOVGI92auV+0HeZXYzOsxusFhQK+13L25P52DVUp4LstfK7I9g81BE0iCVhdL9UUZkVnDZ1AAvMlwnwgy+RiFgyg+wyK28nKYBytMylVy1mKR7ALYgnKQnybcpQLa1MnW0bTLrTY1yH3sSV6t11q8mjTYTH8uIJAAzdfpFA6UgUaGm13XGKy7JH3jcE5KQ4I6stAxA65SWb7x7kVF4kTUZ0qveIcoa94JXAbW8Vjpza11oeAvrVyznvABFTc/mflv3KduUd/LPNgCOc3ZQh9Q4lRcnwOzAldamIhh80YpFAI+nkXbzNWvMFELd74oCfZ7ur+3Ont10U6uiHABKc0UY8kRY2nVCtg3qeLJnafrsPwky7AwJH2kME384uFzF4/J5TSXmKg3yKqQp3Bbrecqoj3+6cBo1cf7E2jUezAGYNkTwAAAAAABrhAfrtrFhR4yubI7X5QRqMK6xKrj7U3XuBHdGnLqSqcQAAAAAC4JBfAUFVV1YAAAAAAAfqgJkAACcQwzVXXh45o5XuoipbS6tHUGLOr2gBAFUA/2FJGpMREt3xvYFHzRtkE3X3n1glEm1mVICHRjT9Cs4AAABNxDg2IAAAAAAMXBdJ////+AAAAABmDZE8AAAAAGYNkTsAAABN7bhLwAAAAAAP8g77CvACukv/Z/XwPv2pp3OgsvdOcPBUrts9R4Hgcz6qR9V6pOPgww1tJU0efEK1mzTeAWykMPQ9NJ6Q4R6bOE4ovJE1HoqYaxeOeXo5A2sVjzj3+EVrSL3D0Fk7ZhvE4mq11ta+xU83W8vUSVjPvP7B6tZ3ca7vABbyU4NPD3w50tD4xjICZVMTQFLWMEvFg2w8474FkSDYxxq/jEvKzy++P9OT1YviTj7K39aY2WT3ihDvYXZ+HkNyzhecSH3hfqbIvBfiD6HuALiZ'
const VAA_2HRS_LATER =
  'UE5BVQEAAAADuAEAAAADDQFsBUnwLPrSZoV4WQiY3GUg2Q66NyAaldoyH5ZIJ0ZkETzvfhkRWbjoBrSpYZhHVbuRYdZTPZtBrGyg6j4sxiCAAQL32kcgJLK96UTlfdX3SoEyhocpsEEERIrQlFvc7DwJUxkphb/NZ4ClThdKLy2R7o8Jn61Ca5tNXiw0vUV4EB0NAQPdMFrLNBLVc5KZxTgHWlitEjOYa3Gdp2EYNJlxwznhMFBiL19cubTC2NvBzH/2d4XMziMQIesdUPCyYHHIve3hAAR3dzw9JKtnPjC2AI1rhOB2oPYqLE5Z3JsTvfnjuiFS4WimZ4EYLtxBUlMnwmgZvdPrH4nAroey1ZtBojzFCeMbAAaCMLaKaEQTch8hC7DUfHMm7LeZJciXhHgcSFtJVV8KjBrY2b1eXYQciztShmewcnS6TDGg/eDX4yRdbgcVQCQFAQeK4c3gHFKVGFzW+J6TTb/mPM5p4SiZcxdIb9Ka49QAYHzzeVCMgBXpCSuVczaZAdvAdbr63WB9aojA27ahTJ5DAQqJon4VIghzlzd3oUCWHakeBwrBGQ3YMCatBSEO572L8XH6GcgbzR4+ds+f+TESaKoHTWcnJOhzQSzqZidTAnC7AAuE1P3Wg/byq0hcM7Q6OF4CVILHoJZZrbG+AWY7IhTuDHbW9H255u6G+yI5DKB1N8YTjZuxZ5O5rUbO887UQQ7BAAyIqdkFpu/5cK5l6uRtLbf/k1id++UQRi8n7CfPac+Ryzvow2wI1UVPKAaNXMjQAwlMbiUKGKwbRmuRN7ChnpEFAA4TktPaoYqH7mATAtXXBc1tuoG/qlfGGW2qBbaPySGQRGANAArwMmlosmNdE+LCLu5q/mnCBGUZq7hTCFJMYeB5ABDt0vlPLLj54ba9LjA+pv0livhFYugldTyNetyKr2kDuwWZkECwZ4I4wfbPZIVAST6TafASe7fhR5Gads8BpO0xABEOJGx3I6SZI9dj+yIS/iNG5M0lyR9q64NsR0K0iqxj7wC1kdDHs97tfcDqlchc4ijnBemIl8KhOED295r/UggkARIFUrj9ANvPfSFqNFZAIEVmwDwz9B3rDOy0xhU1glOvq3uNPtwa1+zXcogYdHsmNCO2KVxurBzd92gJ2/hFRBBWAWYNn0wAAAAAABrhAfrtrFhR4yubI7X5QRqMK6xKrj7U3XuBHdGnLqSqcQAAAAAC4LERAUFVV1YAAAAAAAfqob8AACcQS7Wu2jbRAfmb9mV40YZnWnP8y64BAFUA/2FJGpMREt3xvYFHzRtkE3X3n1glEm1mVICHRjT9Cs4AAABMlUOsWQAAAAAeHuzk////+AAAAABmDZ9MAAAAAGYNn0sAAABNjKCk4AAAAAASmqlyCqbX7ce3zjatJ3hfg8zxh/mwYPl0yID2YqpGFtPHvS1AVLhx/oMnEJJDlt7Eq1WbUlpe+7jrJzb2Ixq+kzOI6Iat6srSSrY+ROo4CUTiejdpy7TujH9yJSPZdM50t6AVksSN5bnA+gWvX7AboBSlHBI4bGTkRfiQydXONlH/CwJCFDLJwl+E3CwnKDMRXv9+Dn8QVffWnNwJzk26d2R4D2Oo0hZpAiojvP19Ut/iXSIvxGC/UC2oQpiBkLQzAQxQFxxSiWxxUZJs'
const VAA_3HRS_LATER =
  'UE5BVQEAAAADuAEAAAADDQFLc0pVHyH+14tnsJjxnKT/wj63ixUYmKoHhZ5uV0oMiD0iWbknaNLHyTn35rQVSJlN+zGYv2gBiknMgKn98u39AQJeVQRTmgq9oxtfK4iwQ+KEE6wzcF5vD3g3WU60GUTYS0xujiyfYakRcASWCpYHX+nMRHrUDY+0is1trL4SufDAAQO9Yyclqwn3eY/4M4XP4JdXb7O539d9w59hyVDlqsHTwiuznX5lk5BvhvnLCgmn0pLlqg3INiD/Bk9ngn3SB0JgAQSgq+lzkpJrUSh86Xg0CrJ8FjTJ2kZDNtw3WQpOLF7AJGGkxCrU+64C0gaW7+wPSY77d+OOJQ0md+nuNIw25ZZkAAa/ihmPU89rl4hRBqrca2mFi40YFmp9xbK505fmMNXi5nyCEhUL4IWreicVaAu4P83omLLw4Tmfs/TVtoGdagAjAAfg6a6BfhZ8uvxOr1mMecpoxsp2+FaVfY/QJpssmMw0ezSSIAQbsWfiLJ9FpcoQMpcrgp2wN73Pw9wxmNiaNeScAQgnXa1wWpTwyjC+vl9aKG2DuB/B8o8IuvXUjQClDOOH+CvFzzCcNcW+XmOk4FjMkDrmjEdwNy6osytnGVNCzTq/AAmEDVlLjpTpLcl/yJIGpA8MxWRbHpjN2cedfy5yyA+8Q168/nUgw8gOV0FnQiaEjvyhpQZCWVOOJudNSthIxm37AAq8VzuMy2gMRWxNjAmEP1BcaQDnvdy6UUKCReocfScSh1wHSzbehYFBcCI8PsfSSzckynK4FKx5/8hmrZrmacTAAQu63uGHiAdV/Zp2iJ1REmoyUXQAvXDrHmJdPhrPOlTiBhKtcAplwuykXGd7eh7EzSWSKHeeYqDnuXf7M87bic/5AQ4uY/Uv4PzfcSzfz6yYOaWZij6t5MLzZu+pS0F2bHe4fxI7tTBq42ioyf3VIn8IGw+Ky/XxleApo7FIHXO2C/3PABBUL2zhLCTk2MnV4e2+2BCgtJ3cZKmF3H+XbN98ZMY5R3ib9rEZCKDskH8+JBVbBLDA1QbHpKBD0iYowR85a7dYARIEs3dpxCzHWS4o0db3K04X3k2X009B5qXkvmai9T3L2FgeV9GQTsJ21/9KUHUBO59Yy1gnJrcMrGIVH89MSylxAWYNrV0AAAAAABrhAfrtrFhR4yubI7X5QRqMK6xKrj7U3XuBHdGnLqSqcQAAAAAC4NI2AUFVV1YAAAAAAAfqwuQAACcQP5+7HJdtj8XLYFHmk/ebNWySvXoBAFUA/2FJGpMREt3xvYFHzRtkE3X3n1glEm1mVICHRjT9Cs4AAABNRudPrQAAAAAOey6T////+AAAAABmDa1cAAAAAGYNrVsAAABNXSuYoAAAAAARDtbmCiLr7CAcorRSNORl1Vcn5SDNz6oNDBuIKRKRVXWSfVaJkCthK5YZ2ODZguHwr08Gb7DmkpYttcy2jBBOlo3/rdGdU3xkwtctADhqxv5xxrw8DsIrb4uNduCVWN51l+kKwFVkLEtez3/jq4xJb6DK+K6k0zngXAlX2Ubswrc7yjG84wJsAmOOZQdWsB24cbUuVuvgL9KfwUMUtEFWcMUjIeRrW/vXKlz5mZJz/vqgDn+szgao+0PJDrXl6KdvyWUKhuPvHsbD77h3'

describe('End to End Flow', () => {
  let instanceVars: InstanceVarsBasic
  let market: Market
  let keeperOracle: KeeperOracle

  // creates a market against a forked Pyth oracle
  const realOracleFixture = async () => {
    const oracleFactory = await HRE.ethers.getContractAt('IOracleProviderFactory', ORACLE_FACTORY)
    const oracleProvider = await HRE.ethers.getContractAt('IOracleProvider', ETH_USD_ORACLE)

    expect(oracleProvider.address).to.not.be.undefined
    instanceVars = await deployProtocolForOracle(oracleFactory, ORACLE_FACTORY_OWNER, oracleProvider, DSU_MINTER)
    const { owner, user, oracle, dsu } = instanceVars

    market = await createMarket(instanceVars, oracle)
    keeperOracle = await new KeeperOracle__factory(owner).attach(ETH_USD_KEEPER_ORACLE)
    await dsu.connect(user).approve(market.address, parse6decimal('10000').mul(1e12))
  }

  // simulates an oracle update from KeeperOracle; this skips payment of keeper fees
  async function advanceToPrice(timestamp: number, price: BigNumber): Promise<number> {
    const { owner } = instanceVars
    const oracleFactory = await impersonateWithBalance(KEEPER_FACTORY, utils.parseEther('10'))

    // a keeper cannot commit a future price, so advance past the block
    if ((await currentBlockTimestamp()) < timestamp) await increaseTo(timestamp + 2)

    // create a version with the desired parameters and commit to the KeeperOracle
    const oracleVersion = {
      timestamp: timestamp,
      price: price,
      valid: true,
    }
    await expect(
      keeperOracle.connect(oracleFactory).commit(oracleVersion, {
        maxFeePerGas: 100000000,
      }),
    ).to.emit(keeperOracle, 'OracleProviderVersionFulfilled')

    // inform the caller of the current timestamp
    return await currentBlockTimestamp()
  }

  beforeEach(async () => {
    await loadFixture(realOracleFixture)
    // Base fee isn't working properly in coverage, so set it manually
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
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
    expect(currentTimestamp).to.be.greaterThanOrEqual(TIMESTAMP_0)
  })

  it.skip('updates oracle price to be updated by committing VAA to factory', async () => {
    const { owner, user, oracle } = instanceVars

    const pythOracleFactory = await new PythFactory__factory(owner).attach(KEEPER_FACTORY)

    // determine the granularity, needed to calculate starting time for an update period
    const { latestGranularity, currentGranularity, effectiveAfter } = await pythOracleFactory.granularity()
    console.log(latestGranularity, currentGranularity, effectiveAfter)
    expect(latestGranularity).to.equal(1)
    expect(currentGranularity).to.equal(10)
    expect(effectiveAfter).to.equal(1705331638)
    const granularity = latestGranularity.toNumber()

    // TODO: should I just call pythOracleFactory.current to get the timestamp?
    const time2 = TIMESTAMP_0 + 3600
    const granularStartingTime = Math.ceil(time2 / granularity + 1) * granularity
    console.log('granularStartingTime', granularStartingTime)

    // decode raw data from hermes to a hexstring suitable for use onchain
    const decodedVaa = '0x' + Buffer.from(VAA_HOUR_LATER, 'base64').toString('hex')
    console.log('decodedVaa', decodedVaa)

    // FIXME: reverts inside parseAndVerifyBatchAttestationVM, making a call to wormhole 0xebe57e8045f2f230872523bbff7374986e45c486
    const oracleFactoryOwner = await impersonateWithBalance(ORACLE_FACTORY_OWNER, utils.parseEther('10'))
    await expect(
      pythOracleFactory
        .connect(oracleFactoryOwner)
        .commit([PYTH_ETH_USD_PRICE_FEED], granularStartingTime, decodedVaa, {
          value: 1,
          maxFeePerGas: 100000000,
        }),
    )
      .to.emit(ETH_USD_ORACLE, 'OracleProviderVersionFulfilled')
      .withArgs({ timestamp: granularStartingTime, price: '1838207180', valid: true })
  })

  it('updates oracle price by committing oracle version to KeeperOracle', async () => {
    const { oracle } = instanceVars

    // ensure another test hasn't reset us to an irrelevant epoch
    const startTime = await currentBlockTimestamp()
    expect(await startTime).to.be.greaterThanOrEqual(TIMESTAMP_0)

    // confirm inital price and timestamp matches our constants
    const [initialVersion, initialTimestamp] = await oracle.status()
    expect(initialVersion.timestamp).to.equal(TIMESTAMP_0)
    expect(initialVersion.price).to.equal(PRICE_0)
    expect(initialVersion.valid).to.equal(true)
    expect(initialTimestamp).to.be.greaterThanOrEqual(TIMESTAMP_0)

    // advance 10 minutes into the future and request an oracle price
    const requestedTime = startTime + 10 * 60
    const newBlockTimestamp = await advanceToPrice(requestedTime, parse6decimal('3377.429922'))

    // confirm the oracle's latest version is our update
    const [latestVersion, currentTimestamp] = await oracle.status()
    expect(latestVersion.timestamp).to.equal(requestedTime)
    expect(latestVersion.price).to.equal(parse6decimal('3377.429922'))
    expect(latestVersion.valid).to.equal(true)
    expect(currentTimestamp).to.be.greaterThanOrEqual(requestedTime)

    // confirm we can retrieve the price for the expected timestamp
    const versionAt = await oracle.at(requestedTime)
    expect(versionAt).to.eql(latestVersion)

    // confirm timestamps make sense
    expect(newBlockTimestamp)
      .to.be.greaterThanOrEqual(requestedTime)
      .and.lessThan(requestedTime + 10)
    expect(newBlockTimestamp).to.equal(await currentBlockTimestamp())
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('2')
    const COLLATERAL = parse6decimal('10000')
    const { user, dsu, marketImpl } = instanceVars

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    const time1 = await currentBlockTimestamp()

    const time2 = time1 + 12
    await expect(
      market
        .connect(user)
        ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
    )
      .to.emit(market, 'Updated')
      .withArgs(user.address, user.address, time2, POSITION, 0, 0, COLLATERAL, false, AddressZero)
      .to.emit(market, 'OrderCreated')
      .withArgs(user.address, {
        ...DEFAULT_ORDER,
        timestamp: time2,
        orders: 1,
        collateral: COLLATERAL,
        makerPos: POSITION,
      })

    // Check user is in the correct state
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 0,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 1), {
      ...DEFAULT_ORDER,
      timestamp: time2,
      orders: 1,
      collateral: COLLATERAL,
      makerPos: POSITION,
    })
    expectCheckpointEq(await market.checkpoints(user.address, time1), {
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
      timestamp: time2,
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
    // FIXME: suspect this time offset of 1-2 is nondeterministic
    const time3 = (await advanceToPrice(time2, parse6decimal('3344.555'))) + 2

    // Check global state after implicit settlement from oracle provider
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
      timestamp: time3,
    })
    expectPositionEq(await market.position(), {
      ...DEFAULT_POSITION,
      timestamp: time2,
      maker: POSITION,
    })

    // TODO: backmerge https://github.com/equilibria-xyz/perennial-v2/pull/283 to 2.2 or this branch
    expect(await market.connect(user)['settle(address)'](user.address)).to.not.be.reverted

    // Check user state after an explicit settlement of that user
    expectLocalEq(await market.locals(user.address), {
      ...DEFAULT_LOCAL,
      currentId: 1,
      latestId: 1,
      collateral: COLLATERAL,
    })
    expectOrderEq(await market.pendingOrders(user.address, 2), {
      ...DEFAULT_ORDER,
    })
    expectCheckpointEq(await market.checkpoints(user.address, time2), {
      ...DEFAULT_CHECKPOINT,
      transfer: parse6decimal('10000.000000'),
    })
    expectPositionEq(await market.positions(user.address), {
      ...DEFAULT_POSITION,
      timestamp: time2,
      maker: POSITION,
    })
  })
})
