import HRE from 'hardhat'
import { expect } from 'chai'
import {
  MarketFactory,
  MarketFactory__factory,
  Market__factory,
  OracleFactory__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../../../types/generated'
import { utils, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { OracleFactory } from '@equilibria/perennial-v2-oracle/types/generated'
import { getLabsMultisig } from '../../../../../common/testutil/constants'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'

const GAUNTLET_ADDRESS = '0x9B08824A87D79a65dD30Fc5c6B9e734A313E4235'

describe('Verify Markets Migration', () => {
  let signer: SignerWithAddress
  let proxyAdmin: ProxyAdmin
  let marketFactory: MarketFactory
  let oracleFactory: OracleFactory
  let labsMultisig: string

  beforeEach(async () => {
    ;[signer] = await HRE.ethers.getSigners()
    proxyAdmin = ProxyAdmin__factory.connect((await HRE.deployments.get('ProxyAdmin')).address, signer)
    marketFactory = MarketFactory__factory.connect((await HRE.deployments.get('MarketFactory')).address, signer)
    oracleFactory = OracleFactory__factory.connect((await HRE.deployments.get('OracleFactory')).address, signer)

    if (!getLabsMultisig('arbitrum')) throw new Error('No Multisig Found')
    labsMultisig = getLabsMultisig('arbitrum') as string
  })

  async function performUpgrade() {
    const timelockSigner = await impersonateWithBalance(
      (
        await HRE.deployments.get('TimelockController')
      ).address,
      '0x116345785d8a0001',
    )
    await proxyAdmin
      .connect(timelockSigner)
      .upgrade(marketFactory.address, (await HRE.deployments.get('MarketFactoryImpl')).address)
  }

  it('MarketFactory', async () => {
    await performUpgrade()

    await expect(marketFactory.callStatic.initialize()).to.be.reverted
    expect(await marketFactory.callStatic.owner()).to.equal((await HRE.deployments.get('TimelockController')).address)
    expect(await marketFactory.callStatic.pauser()).to.equal(labsMultisig)
    expect(await marketFactory.callStatic.implementation()).to.equal((await HRE.deployments.get('MarketImpl')).address)
    expect(await proxyAdmin.callStatic.getProxyAdmin(marketFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(marketFactory.address)).to.equal(
      (await HRE.deployments.get('MarketFactoryImpl')).address,
    )
  })

  it('Market: ETH', async () => {
    const pythId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
    const oracle = await oracleFactory.callStatic.oracles(pythId)
    const ethMarket = Market__factory.connect(
      await marketFactory.callStatic.markets(oracle, constants.AddressZero),
      signer,
    )

    const parameterBefore = await ethMarket.callStatic.parameter()
    const riskParameterBefore = await ethMarket.callStatic.riskParameter()
    const global = await ethMarket.global()
    const position = await ethMarket.position()
    const pendingPosition = await ethMarket.pendingPosition(global.currentId)
    const versionLatestBefore = await ethMarket.versions(position.timestamp)
    const versionPendingBefore = await ethMarket.versions(pendingPosition.timestamp)

    await performUpgrade()

    const parameter = await ethMarket.callStatic.parameter()
    const riskParameter = await ethMarket.callStatic.riskParameter()

    expect(parameter.fundingFee).to.equal(parameterBefore.fundingFee)
    expect(parameter.interestFee).to.equal(parameterBefore.interestFee)
    expect(parameter.positionFee).to.equal(parameterBefore.positionFee)
    expect(parameter.oracleFee).to.equal(parameterBefore.oracleFee)
    expect(parameter.riskFee).to.equal(parameterBefore.riskFee)
    expect(parameter.maxPendingGlobal).to.equal(parameterBefore.maxPendingGlobal)
    expect(parameter.maxPendingLocal).to.equal(parameterBefore.maxPendingLocal)
    expect(parameter.settlementFee).to.equal(parameterBefore.settlementFee)
    expect(parameter.makerCloseAlways).to.equal(parameterBefore.makerCloseAlways)
    expect(parameter.takerCloseAlways).to.equal(parameterBefore.takerCloseAlways)
    expect(parameter.closed).to.equal(parameterBefore.closed)

    expect(riskParameter.margin).to.equal(riskParameterBefore.margin)
    expect(riskParameter.maintenance).to.equal(riskParameterBefore.maintenance)
    expect(riskParameter.takerFee).to.equal(riskParameterBefore.takerFee)
    expect(riskParameter.takerMagnitudeFee).to.equal(riskParameterBefore.takerMagnitudeFee)
    expect(riskParameter.impactFee).to.equal(riskParameterBefore.impactFee)
    expect(riskParameter.makerFee).to.equal(riskParameterBefore.makerFee)
    expect(riskParameter.makerMagnitudeFee).to.equal(riskParameterBefore.makerMagnitudeFee)
    expect(riskParameter.makerLimit).to.equal(riskParameterBefore.makerLimit)
    expect(riskParameter.efficiencyLimit).to.equal(riskParameterBefore.efficiencyLimit)
    expect(riskParameter.liquidationFee).to.equal(riskParameterBefore.liquidationFee)
    expect(riskParameter.minLiquidationFee).to.equal(riskParameterBefore.minLiquidationFee)
    expect(riskParameter.maxLiquidationFee).to.equal(riskParameterBefore.maxLiquidationFee)
    expect(riskParameter.utilizationCurve.minRate).to.equal(riskParameterBefore.utilizationCurve.minRate)
    expect(riskParameter.utilizationCurve.maxRate).to.equal(riskParameterBefore.utilizationCurve.maxRate)
    expect(riskParameter.utilizationCurve.targetRate).to.equal(riskParameterBefore.utilizationCurve.targetRate)
    expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
      riskParameterBefore.utilizationCurve.targetUtilization,
    )
    expect(riskParameter.pController.k).to.equal(riskParameterBefore.pController.k)
    expect(riskParameter.pController.max).to.equal(riskParameterBefore.pController.max)
    expect(riskParameter.minMargin).to.equal(riskParameterBefore.minMargin)
    expect(riskParameter.minMaintenance).to.equal(riskParameterBefore.minMaintenance)
    expect(riskParameter.virtualTaker).to.equal(riskParameterBefore.virtualTaker)
    expect(riskParameter.staleAfter).to.equal(riskParameterBefore.staleAfter)
    expect(riskParameter.makerReceiveOnly).to.equal(riskParameterBefore.makerReceiveOnly)

    const versionLatest = await ethMarket.versions(position.timestamp)
    const versionPending = await ethMarket.versions(pendingPosition.timestamp)

    expect(versionLatest.valid).to.equal(versionLatestBefore.valid)
    expect(versionLatest.makerValue._value).to.equal(versionLatestBefore.makerValue._value)
    expect(versionLatest.longValue._value).to.equal(versionLatestBefore.longValue._value)
    expect(versionLatest.shortValue._value).to.equal(versionLatestBefore.shortValue._value)

    expect(versionPending.valid).to.equal(versionPendingBefore.valid)
    expect(versionPending.makerValue._value).to.equal(versionPendingBefore.makerValue._value)
    expect(versionPending.longValue._value).to.equal(versionPendingBefore.longValue._value)
    expect(versionPending.shortValue._value).to.equal(versionPendingBefore.shortValue._value)
  })
})
