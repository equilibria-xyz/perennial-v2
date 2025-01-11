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
import { OracleFactory } from '@perennial/v2-oracle/types/generated'
import { getLabsMultisig } from '../../../../../common/testutil/constants'

const GAUNTLET_ADDRESS = '0x9B08824A87D79a65dD30Fc5c6B9e734A313E4235'

describe('Verify Markets', () => {
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

    if (!getLabsMultisig('base')) throw new Error('No Multisig Found')
    labsMultisig = getLabsMultisig('base') as string
  })

  it('MarketFactory', async () => {
    await expect(marketFactory.callStatic.initialize()).to.be.reverted
    expect(await marketFactory.callStatic.owner()).to.equal((await HRE.deployments.get('TimelockController')).address)
    expect(await marketFactory.callStatic.pauser()).to.equal(labsMultisig)
    expect(await marketFactory.callStatic.implementation()).to.equal((await HRE.deployments.get('MarketImpl')).address)
    expect(await proxyAdmin.callStatic.getProxyAdmin(marketFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(marketFactory.address)).to.equal(
      (await HRE.deployments.get('MarketFactoryImpl')).address,
    )
  })

  it('Protocol Parameters', async () => {
    const param = await marketFactory.callStatic.parameter()
    expect(await marketFactory.paused()).to.be.false
    expect(param.protocolFee).to.equal(0)
    expect(param.maxFee).to.equal(utils.parseUnits('0.002', 6))
    expect(param.maxLiquidationFee).to.equal(utils.parseUnits('50', 6))
    expect(param.maxCut).to.equal(utils.parseUnits('0.1', 6))
    expect(param.maxRate).to.equal(utils.parseUnits('5.00', 6))
    expect(param.minMaintenance).to.equal(utils.parseUnits('0.004', 6))
    expect(param.minEfficiency).to.equal(utils.parseUnits('0.25', 6))
  })

  it('Market: ETH', async () => {
    const pythId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
    const oracle = await oracleFactory.callStatic.oracles(pythId)
    const ethMarket = Market__factory.connect(
      await marketFactory.callStatic.markets(oracle, constants.AddressZero),
      signer,
    )

    const parameter = await ethMarket.callStatic.parameter()
    expect(parameter.fundingFee).to.equal(utils.parseUnits('0.05', 6))
    expect(parameter.interestFee).to.equal(utils.parseUnits('0.05', 6))
    expect(parameter.positionFee).to.equal(utils.parseUnits('0.05', 6))
    expect(parameter.oracleFee).to.equal(0)
    expect(parameter.riskFee).to.equal(utils.parseUnits('1', 6))
    expect(parameter.maxPendingGlobal).to.equal(12)
    expect(parameter.maxPendingLocal).to.equal(6)
    expect(parameter.makerRewardRate).to.equal(0)
    expect(parameter.longRewardRate).to.equal(0)
    expect(parameter.shortRewardRate).to.equal(0)
    expect(parameter.settlementFee).to.equal(utils.parseUnits('1.50', 6))
    expect(parameter.closed).to.be.false

    const riskParameter = await ethMarket.callStatic.riskParameter()
    expect(riskParameter.margin).to.equal(utils.parseUnits('0.0095', 6))
    expect(riskParameter.maintenance).to.equal(utils.parseUnits('0.008', 6))
    expect(riskParameter.takerFee).to.equal(utils.parseUnits('0.0002', 6))
    expect(riskParameter.takerSkewFee).to.equal(utils.parseUnits('0.001', 6))
    expect(riskParameter.takerImpactFee).to.equal(utils.parseUnits('0.001', 6))
    expect(riskParameter.makerFee).to.equal(utils.parseUnits('0.0001', 6))
    expect(riskParameter.makerImpactFee).to.equal(0)
    expect(riskParameter.makerLimit).to.equal(utils.parseUnits('3008', 6)) // $5M
    expect(riskParameter.efficiencyLimit).to.equal(utils.parseUnits('0.5', 6))
    expect(riskParameter.liquidationFee).to.equal(utils.parseUnits('0.05', 6))
    expect(riskParameter.minLiquidationFee).to.equal(utils.parseUnits('5', 6))
    expect(riskParameter.maxLiquidationFee).to.equal(utils.parseUnits('25', 6))
    expect(riskParameter.utilizationCurve.minRate).to.equal(0)
    expect(riskParameter.utilizationCurve.maxRate).to.equal(utils.parseUnits('0.155', 6))
    expect(riskParameter.utilizationCurve.targetRate).to.equal(utils.parseUnits('0.055', 6))
    expect(riskParameter.utilizationCurve.targetUtilization).to.equal(utils.parseUnits('0.60', 6))
    expect(riskParameter.pController.k).to.equal(utils.parseUnits('20000', 6))
    expect(riskParameter.pController.max).to.equal(utils.parseUnits('2.5', 6))
    expect(riskParameter.minMargin).to.equal(utils.parseUnits('10', 6))
    expect(riskParameter.minMaintenance).to.equal(utils.parseUnits('10', 6))
    expect(riskParameter.skewScale).to.equal(0)
    expect(riskParameter.staleAfter).to.equal(60)
    expect(riskParameter.makerReceiveOnly).to.be.false
  })

  it('Market: BTC', async () => {
    const pythId = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
    const oracle = await oracleFactory.callStatic.oracles(pythId)
    const btcMarket = Market__factory.connect(
      await marketFactory.callStatic.markets(oracle, constants.AddressZero),
      signer,
    )

    const parameter = await btcMarket.callStatic.parameter()
    expect(parameter.fundingFee).to.equal(utils.parseUnits('0.05', 6))
    expect(parameter.interestFee).to.equal(utils.parseUnits('0.05', 6))
    expect(parameter.positionFee).to.equal(utils.parseUnits('0.05', 6))
    expect(parameter.oracleFee).to.equal(0)
    expect(parameter.riskFee).to.equal(utils.parseUnits('1', 6))
    expect(parameter.maxPendingGlobal).to.equal(12)
    expect(parameter.maxPendingLocal).to.equal(6)
    expect(parameter.makerRewardRate).to.equal(0)
    expect(parameter.longRewardRate).to.equal(0)
    expect(parameter.shortRewardRate).to.equal(0)
    expect(parameter.settlementFee).to.equal(utils.parseUnits('1.50', 6))
    expect(parameter.closed).to.be.false

    const riskParameter = await btcMarket.callStatic.riskParameter()
    expect(riskParameter.margin).to.equal(utils.parseUnits('0.0095', 6))
    expect(riskParameter.maintenance).to.equal(utils.parseUnits('0.008', 6))
    expect(riskParameter.takerFee).to.equal(utils.parseUnits('0.0002', 6))
    expect(riskParameter.takerSkewFee).to.equal(utils.parseUnits('0.001', 6))
    expect(riskParameter.takerImpactFee).to.equal(utils.parseUnits('0.001', 6))
    expect(riskParameter.makerFee).to.equal(utils.parseUnits('0.0001', 6))
    expect(riskParameter.makerImpactFee).to.equal(0)
    expect(riskParameter.makerLimit).to.equal(utils.parseUnits('185.76', 6)) // $5M
    expect(riskParameter.efficiencyLimit).to.equal(utils.parseUnits('0.5', 6))
    expect(riskParameter.liquidationFee).to.equal(utils.parseUnits('0.05', 6))
    expect(riskParameter.minLiquidationFee).to.equal(utils.parseUnits('5', 6))
    expect(riskParameter.maxLiquidationFee).to.equal(utils.parseUnits('25', 6))
    expect(riskParameter.utilizationCurve.minRate).to.equal(0)
    expect(riskParameter.utilizationCurve.maxRate).to.equal(utils.parseUnits('0.155', 6))
    expect(riskParameter.utilizationCurve.targetRate).to.equal(utils.parseUnits('0.055', 6))
    expect(riskParameter.utilizationCurve.targetUtilization).to.equal(utils.parseUnits('0.60', 6))
    expect(riskParameter.pController.k).to.equal(utils.parseUnits('20000', 6))
    expect(riskParameter.pController.max).to.equal(utils.parseUnits('2.5', 6))
    expect(riskParameter.minMargin).to.equal(utils.parseUnits('10', 6))
    expect(riskParameter.minMaintenance).to.equal(utils.parseUnits('10', 6))
    expect(riskParameter.skewScale).to.equal(0)
    expect(riskParameter.staleAfter).to.equal(60)
    expect(riskParameter.makerReceiveOnly).to.be.false
  })
})
