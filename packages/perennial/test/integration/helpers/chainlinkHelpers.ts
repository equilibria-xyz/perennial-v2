import HRE from 'hardhat'
import { BigNumber } from 'ethers'
import { smock, FakeContract } from '@defi-wonderland/smock'

import { FeedRegistryInterface__factory, FeedRegistryInterface, IOracleProvider } from '../../../types/generated'

const { ethers, deployments } = HRE

export class ChainlinkContext {
  private feedRegistryExternal!: FeedRegistryInterface
  private latestRoundId: BigNumber
  private currentRoundId: BigNumber
  private delay: number
  private decimals!: number
  private readonly base: string
  private readonly quote: string
  private readonly feedRegistryOverride: string // optional constructor arg for using ChainlinkContext in different packages

  public oracle!: FakeContract<IOracleProvider>

  constructor(base: string, quote: string, initialRoundId: BigNumber, delay: number, feedRegistryOverride?: string) {
    this.base = base
    this.quote = quote
    this.latestRoundId = initialRoundId
    this.currentRoundId = initialRoundId
    this.delay = delay
    this.feedRegistryOverride = feedRegistryOverride ? feedRegistryOverride : '0x0'
  }

  public async init(): Promise<ChainlinkContext> {
    const [owner] = await ethers.getSigners()

    this.feedRegistryExternal = await FeedRegistryInterface__factory.connect(
      this.feedRegistryOverride === '0x0'
        ? (
            await deployments.get('ChainlinkFeedRegistry')
          ).address
        : this.feedRegistryOverride,
      owner,
    )
    this.oracle = await smock.fake<IOracleProvider>('IOracleProvider')

    this.decimals = await this.feedRegistryExternal.decimals(this.base, this.quote)

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

    this.oracle.sync.reset()
    this.oracle.sync.whenCalledWith().returns([latestVersion, currentData.startedAt])
    this.oracle.current.reset()
    this.oracle.current.whenCalledWith().returns(currentData.startedAt)
    this.oracle.latest.reset()
    this.oracle.latest.whenCalledWith().returns(latestVersion)
    this.oracle.at.whenCalledWith(latestData.startedAt).returns(latestVersion)
  }
}
