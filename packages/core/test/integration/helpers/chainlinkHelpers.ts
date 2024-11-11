import HRE from 'hardhat'
import { BigNumber } from 'ethers'
import { smock, FakeContract } from '@defi-wonderland/smock'

import { FeedRegistryInterface__factory, FeedRegistryInterface, IOracleProvider } from '../../../types/generated'
import { buildChainlinkRoundId } from '@perennial/v2-oracle/util/buildChainlinkRoundId'
import { IOracleFactory, IOracleFactory__factory, IPayoffProvider } from '@perennial/v2-oracle/types/generated'

const { ethers, deployments } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000

interface Payoff {
  provider?: IPayoffProvider
  decimals: number
}

export class ChainlinkContext {
  private feedRegistryExternal!: FeedRegistryInterface
  private initialRoundId: BigNumber
  private latestRoundId: BigNumber
  private currentRoundId: BigNumber
  public payoff: Payoff
  public delay: number
  private decimals!: number
  public settlementFee!: BigNumber
  public oracleFee!: BigNumber
  private readonly base: string
  private readonly quote: string
  public readonly id: string

  public oracleFactory!: FakeContract<IOracleFactory>
  public oracle!: FakeContract<IOracleProvider>

  constructor(base: string, quote: string, payoff: Payoff, delay: number) {
    const initialRoundId = buildChainlinkRoundId(INITIAL_PHASE_ID, INITIAL_AGGREGATOR_ROUND_ID)
    this.base = base
    this.quote = quote
    this.payoff = payoff
    this.id = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['string', 'string'], [base, quote]))
    this.initialRoundId = initialRoundId
    this.latestRoundId = initialRoundId
    this.currentRoundId = initialRoundId
    this.delay = delay
  }

  public async init(settlementFee: BigNumber, oracleFee: BigNumber): Promise<ChainlinkContext> {
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

    this.updateParams(settlementFee, oracleFee)
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
    const latestPrice =
      this.decimals < 18
        ? latestData.answer.mul(BigNumber.from(10).pow(18 - this.decimals))
        : latestData.answer.div(BigNumber.from(10).pow(this.decimals - 18))

    const latestVersion = {
      timestamp: latestData.startedAt,
      price: await this._payoff(priceFn(latestPrice)),
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
    this.oracle.at
      .whenCalledWith(latestData.startedAt)
      .returns([latestVersion, { settlementFee: this.settlementFee, oracleFee: this.oracleFee }])
  }

  public updateParams(settlementFee: BigNumber, oracleFee: BigNumber): void {
    this.settlementFee = settlementFee
    this.oracleFee = oracleFee
  }

  public async reset(): Promise<void> {
    this.currentRoundId = this.initialRoundId
    this.latestRoundId = this.initialRoundId

    this.oracle.at.reset()

    await this.next()
  }

  public async setInvalidVersion(): Promise<void> {
    await this.next()

    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)

    const latestPrice =
      this.decimals < 18
        ? latestData.answer.mul(BigNumber.from(10).pow(18 - this.decimals))
        : latestData.answer.div(BigNumber.from(10).pow(this.decimals - 18))

    const latestVersion = {
      timestamp: latestData.startedAt,
      price: await this._payoff(latestPrice),
      valid: false,
    }

    this.oracle.at
      .whenCalledWith(latestData.startedAt)
      .returns([latestVersion, { settlementFee: this.settlementFee, oracleFee: this.oracleFee }])
  }

  private async _payoff(price: BigNumber): Promise<BigNumber> {
    // apply payoff
    let priceAfterPayoff = this.payoff.provider ? await this.payoff.provider.payoff(price) : price

    // adjust decimals
    if (this.payoff.decimals > 0) priceAfterPayoff = priceAfterPayoff.mul(BigNumber.from(10).pow(this.payoff.decimals))
    if (this.payoff.decimals < 0)
      priceAfterPayoff = priceAfterPayoff.div(BigNumber.from(10).pow(this.payoff.decimals * -1))

    return priceAfterPayoff.div(1e12)
  }
}
