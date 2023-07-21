import HRE from 'hardhat'
import { BigNumber } from 'ethers'
import { smock, FakeContract } from '@defi-wonderland/smock'

import { FeedRegistryInterface__factory, FeedRegistryInterface, IOracleProvider } from '../../../types/generated'
import { buildChainlinkRoundId } from '@equilibria/perennial-v2-oracle/util/buildChainlinkRoundId'
import { IOracleFactory, IOracleFactory__factory } from '@equilibria/perennial-v2-oracle/types/generated'

const { ethers, deployments } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000

export class ChainlinkContext {
  private feedRegistryExternal!: FeedRegistryInterface
  private initialRoundId: BigNumber
  private latestRoundId: BigNumber
  private currentRoundId: BigNumber
  private delay: number
  private decimals!: number
  private readonly base: string
  private readonly quote: string
  public readonly id: string

  public oracleFactory!: FakeContract<IOracleFactory>
  public oracle!: FakeContract<IOracleProvider>

  constructor(base: string, quote: string, delay: number) {
    const initialRoundId = buildChainlinkRoundId(INITIAL_PHASE_ID, INITIAL_AGGREGATOR_ROUND_ID)
    this.base = base
    this.quote = quote
    this.id = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['string', 'string'], [base, quote]))
    this.initialRoundId = initialRoundId
    this.latestRoundId = initialRoundId
    this.currentRoundId = initialRoundId
    this.delay = delay
  }

  public async init(): Promise<ChainlinkContext> {
    const [owner] = await ethers.getSigners()

    this.feedRegistryExternal = FeedRegistryInterface__factory.connect(
      (await deployments.get('ChainlinkFeedRegistry')).address,
      owner,
    )
    this.oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    this.oracleFactory = await smock.fake<IOracleFactory>(IOracleFactory__factory)
    this.decimals = await this.feedRegistryExternal.decimals(this.base, this.quote)

    this.oracleFactory.instances.whenCalledWith(this.oracle.address).returns(true)
    this.oracleFactory.oracles.whenCalledWith(this.id).returns(this.oracle.address)

    await this.next()

    return this
  }

  public async next(): Promise<void> {
    await this.nextWithPriceModification(n => n)
  }

  public async nextWithPriceModification(priceFn: (price: BigNumber) => BigNumber): Promise<void> {
    this.currentRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.currentRoundId)
    if (this.currentRoundId.sub(this.latestRoundId).gt(this.delay)) {
      this.latestRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.latestRoundId)
    }

    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)
    const currentData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.currentRoundId)

    const latestVersion = {
      version: latestData.startedAt,
      timestamp: latestData.startedAt,
      price: priceFn(latestData.answer.div(BigNumber.from(10).pow(this.decimals - 6))),
      valid: true,
    }

    this.oracle.status.reset()
    this.oracle.status.whenCalledWith().returns([latestVersion, currentData.startedAt])
    this.oracle.request.reset()
    this.oracle.request.whenCalledWith().returns()
    this.oracle.current.reset()
    this.oracle.current.whenCalledWith().returns(currentData.startedAt)
    this.oracle.latest.reset()
    this.oracle.latest.whenCalledWith().returns(latestVersion)
    this.oracle.at.whenCalledWith(latestData.startedAt).returns(latestVersion)
  }

  public async reset(): Promise<void> {
    this.currentRoundId = this.initialRoundId
    this.latestRoundId = this.initialRoundId

    this.oracle.at.reset()

    await this.next()
  }
}
