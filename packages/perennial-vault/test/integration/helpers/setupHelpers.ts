import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, BigNumberish } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { IERC20Metadata, IMarket, IMarket__factory, IMarketFactory } from '../../../types/generated'
import { MarketParameterStruct, RiskParameterStruct } from '@perennial/v2-core/types/generated/contracts/Market'

export interface DeployProductParams
  extends Partial<
    Omit<RiskParameterStruct & Omit<MarketParameterStruct, 'makerFee' | 'takerFee'>, 'payoffDefinition'>
  > {
  marketMakerFee?: BigNumberish
  marketTakerFee?: BigNumberish
  factory: IMarketFactory
  token: IERC20Metadata
  oracle: string
  owner: SignerWithAddress
}

// Deploys a product that uses an oracle based on an oracle in the Chainlink feed registry.
// Returns the address of the deployed product.
export async function deployProductOnFork({
  token,
  factory,
  oracle,
  owner,
  margin,
  maintenance,
  fundingFee,
  interestFee,
  makerLimit,
  makerFee,
  takerFee,
  marketMakerFee,
  marketTakerFee,
  efficiencyLimit,
  utilizationCurve,
  minMargin,
  minMaintenance,
  staleAfter,
}: DeployProductParams): Promise<IMarket> {
  const riskParameter: RiskParameterStruct = {
    margin: margin ?? parse6decimal('0.10'),
    maintenance: maintenance ?? parse6decimal('0.10'),
    takerFee: takerFee ?? {
      linearFee: parse6decimal('0.0'),
      proportionalFee: parse6decimal('0.0'),
      adiabaticFee: parse6decimal('0.0'),
      scale: parse6decimal('0.0'),
    },
    makerFee: makerFee ?? {
      linearFee: parse6decimal('0.0'),
      proportionalFee: parse6decimal('0.0'),
      scale: parse6decimal('0.0'),
    },
    makerLimit: makerLimit ?? parse6decimal('100'),
    efficiencyLimit: efficiencyLimit ?? parse6decimal('0.2'),
    liquidationFee: parse6decimal('10.00'),
    utilizationCurve: utilizationCurve ?? {
      minRate: parse6decimal('0.02'),
      maxRate: parse6decimal('0.80'),
      targetRate: parse6decimal('0.08'),
      targetUtilization: parse6decimal('0.80'),
    },
    pController: {
      k: parse6decimal('40000'),
      min: parse6decimal('-1.20'),
      max: parse6decimal('1.20'),
    },
    minMargin: minMargin ?? parse6decimal('100'),
    minMaintenance: minMaintenance ?? parse6decimal('100'),
    staleAfter: staleAfter ?? 7200,
    makerReceiveOnly: false,
  }
  const marketParameter = {
    fundingFee: fundingFee ?? parse6decimal('0.00'),
    interestFee: interestFee ?? parse6decimal('0.00'),
    makerFee: marketMakerFee ?? parse6decimal('0.0'),
    takerFee: marketTakerFee ?? parse6decimal('0.0'),
    riskFee: 0,
    oracleFee: 0,
    settlementFee: 0,
    maxPendingGlobal: 8,
    maxPendingLocal: 8,
    maxPriceDeviation: parse6decimal('0.1'),
    closed: false,
    settle: false,
  }
  const marketDefinition: IMarket.MarketDefinitionStruct = {
    token: token.address,
    oracle: oracle ?? constants.AddressZero,
  }

  const protocolParameter = { ...(await factory.parameter()) }
  protocolParameter.maxLiquidationFee = parse6decimal('25')
  await factory.connect(owner).updateParameter(protocolParameter)

  const productAddress = await factory.connect(owner).callStatic.create(marketDefinition)
  await factory.connect(owner).create(marketDefinition)

  const market = IMarket__factory.connect(productAddress, owner)
  await market.connect(owner).updateRiskParameter(riskParameter)
  await market.connect(owner).updateParameter(marketParameter)

  return market
}
