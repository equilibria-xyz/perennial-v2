import HRE from 'hardhat'
import { BigNumber } from 'ethers'
import { smock, FakeContract } from '@defi-wonderland/smock'

import { StorkChainlinkAdapter__factory, IOracleProvider, StorkChainlinkAdapter } from '../../../types/generated'
import { IOracleFactory, IOracleFactory__factory, IPayoffProvider } from '@perennial/v2-oracle/types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'

const { ethers, deployments } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000

interface Payoff {
  provider?: IPayoffProvider
  decimals: number
}

export class ChainlinkContext {
  public payoff: Payoff
  public delay: number

  private storkChainlinkAdapter!: StorkChainlinkAdapter
  private initialRoundId!: BigNumber
  private latestRoundId!: BigNumber
  private currentRoundId!: BigNumber
  private decimals!: number
  public settlementFee!: BigNumber
  public oracleFee!: BigNumber
  public id!: string
  public oracleFactory!: FakeContract<IOracleFactory>
  public oracle!: FakeContract<IOracleProvider>

  constructor(payoff: Payoff, delay: number) {
    this.payoff = payoff
    this.delay = delay * 10 ** 9
  }

  public async init(settlementFee: BigNumber, oracleFee: BigNumber): Promise<ChainlinkContext> {
    const [owner] = await ethers.getSigners()

    const initialRoundId = BigNumber.from(await currentBlockTimestamp()).mul(BigNumber.from(10).pow(9))

    this.initialRoundId = initialRoundId
    this.latestRoundId = initialRoundId
    this.currentRoundId = initialRoundId

    this.storkChainlinkAdapter = StorkChainlinkAdapter__factory.connect(
      (await deployments.get('StorkChainlinkAdapter')).address,
      owner,
    )
    this.id = await this.storkChainlinkAdapter.priceId()
    this.oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    this.oracleFactory = await smock.fake<IOracleFactory>(IOracleFactory__factory)
    this.decimals = await this.storkChainlinkAdapter.decimals()

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
    this.currentRoundId = this.currentRoundId.add(1)
    this.latestRoundId = this.latestRoundId.add(this.delay)

    const latestData = await this.storkChainlinkAdapter.getRoundData(this.latestRoundId)
    const currentData = await this.storkChainlinkAdapter.getRoundData(this.currentRoundId)

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

    const latestData = await this.storkChainlinkAdapter.getRoundData(this.latestRoundId)

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
