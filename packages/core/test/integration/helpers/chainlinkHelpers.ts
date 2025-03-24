import HRE from 'hardhat'
import { BigNumber, utils } from 'ethers'
import { smock, FakeContract } from '@defi-wonderland/smock'

import { StorkChainlinkAdapter__factory, IOracleProvider, StorkChainlinkAdapter } from '../../../types/generated'
import { IOracleFactory, IOracleFactory__factory, IPayoffProvider } from '@perennial/v2-oracle/types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
const { ethers, deployments } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const UNDERLYING_PRICE = utils.parseEther('3374.655169')
export const INITIAL_TIMESTAMP = 1742479639

interface Payoff {
  provider?: IPayoffProvider
  decimals: number
}

export class ChainlinkContext {
  public payoff: Payoff
  public delay: number

  private storkChainlinkAdapter!: StorkChainlinkAdapter
  private initialTimestamp!: number
  private latestTimestamp!: number
  private currentTimestamp!: number
  public settlementFee!: BigNumber
  public oracleFee!: BigNumber
  public id!: string
  public oracleFactory!: FakeContract<IOracleFactory>
  public oracle!: FakeContract<IOracleProvider>
  public price!: BigNumber
  constructor(payoff: Payoff, delay: number) {
    this.payoff = payoff
    this.delay = delay
  }

  public async init(settlementFee: BigNumber, oracleFee: BigNumber): Promise<ChainlinkContext> {
    const [owner] = await ethers.getSigners()

    this.initialTimestamp = INITIAL_TIMESTAMP
    this.latestTimestamp = this.initialTimestamp
    this.currentTimestamp = this.initialTimestamp

    this.storkChainlinkAdapter = StorkChainlinkAdapter__factory.connect(
      (await deployments.get('StorkChainlinkAdapter')).address,
      owner,
    )
    this.id = await this.storkChainlinkAdapter.priceId()
    this.oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    this.oracleFactory = await smock.fake<IOracleFactory>(IOracleFactory__factory)

    this.oracleFactory.instances.whenCalledWith(this.oracle.address).returns(true)
    this.oracleFactory.oracles.whenCalledWith(this.id).returns(this.oracle.address)

    this.updateParams(settlementFee, oracleFee)

    this.price = UNDERLYING_PRICE

    await this.next()
    return this
  }

  public async next(): Promise<void> {
    await this.nextWithPriceModification(n => n)
  }

  public async nextWithPriceModification(priceFn: (price: BigNumber) => BigNumber): Promise<void> {
    this.latestTimestamp = this.currentTimestamp
    this.currentTimestamp = this.currentTimestamp + 100

    this.price = priceFn(this.price)

    const latestVersion = {
      timestamp: this.latestTimestamp,
      price: await this._payoff(this.price),
      valid: true,
    }

    this.oracle.status.reset()
    this.oracle.status.whenCalledWith().returns([latestVersion, this.currentTimestamp])
    this.oracle.request.reset()
    this.oracle.request.whenCalledWith().returns()
    this.oracle.current.reset()
    this.oracle.current.whenCalledWith().returns(this.currentTimestamp)
    this.oracle.latest.reset()
    this.oracle.latest.whenCalledWith().returns(latestVersion)
    this.oracle.at
      .whenCalledWith(this.latestTimestamp)
      .returns([latestVersion, { settlementFee: this.settlementFee, oracleFee: this.oracleFee }])
  }

  public updateParams(settlementFee: BigNumber, oracleFee: BigNumber): void {
    this.settlementFee = settlementFee
    this.oracleFee = oracleFee
  }

  public async reset(): Promise<void> {
    this.currentTimestamp = this.initialTimestamp
    this.latestTimestamp = this.initialTimestamp

    this.oracle.at.reset()

    await this.next()
  }

  public async setInvalidVersion(): Promise<void> {
    await this.next()

    const latestVersion = {
      timestamp: this.latestTimestamp,
      price: await this._payoff(UNDERLYING_PRICE),
      valid: false,
    }

    this.oracle.at
      .whenCalledWith(this.latestTimestamp)
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
