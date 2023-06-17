import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import {
  FeedRegistryInterface__factory,
  FeedRegistryInterface,
  ReferenceKeeperOracle__factory,
  ReferenceKeeperOracle,
} from '../../../types/generated'
import { increaseTo } from '../../../../common/testutil/time'

const { ethers, deployments } = HRE

export class ChainlinkContext {
  private feedRegistryExternal!: FeedRegistryInterface
  private latestRoundId: BigNumber
  private currentRoundId: BigNumber
  private delay: number
  private decimals!: number
  private readonly base: string
  private readonly quote: string

  public oracle!: ReferenceKeeperOracle

  constructor(base: string, quote: string, initialRoundId: BigNumber, delay: number) {
    this.base = base
    this.quote = quote
    this.latestRoundId = initialRoundId
    this.currentRoundId = initialRoundId
    this.delay = delay
  }

  public async init(): Promise<ChainlinkContext> {
    const [owner] = await ethers.getSigners()

    this.feedRegistryExternal = await FeedRegistryInterface__factory.connect(
      (
        await deployments.get('ChainlinkFeedRegistry')
      ).address,
      owner,
    )
    this.oracle = await new ReferenceKeeperOracle__factory(owner).deploy()

    this.decimals = await this.feedRegistryExternal.decimals(this.base, this.quote)

    await this.next()

    return this
  }

  public async next(): Promise<void> {
    await this.nextWithPriceModification(n => n)
  }

  public async nextWithPriceModification(priceFn: (price: BigNumber) => BigNumber): Promise<void> {
    // update current
    this.currentRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.currentRoundId)
    const currentData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.currentRoundId)
    await increaseTo(currentData.startedAt.toNumber())
    await this.oracle.sync()

    // update latest if available
    if (this.currentRoundId.sub(this.latestRoundId).lt(this.delay)) return

    this.latestRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.latestRoundId)
    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)
    const latestVersion = {
      timestamp: latestData.startedAt,
      price: priceFn(latestData.answer.div(BigNumber.from(10).pow(this.decimals - 6))),
      valid: true,
    }

    const nextTimestamp = await this.oracle.next()
    if (nextTimestamp.toNumber() == 0) console.log('[WARNING] trying to commit a non-requested version')
    await this.oracle.commit(nextTimestamp, latestVersion.price)
  }
}
