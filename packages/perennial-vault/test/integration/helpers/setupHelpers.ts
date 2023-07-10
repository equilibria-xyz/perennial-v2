import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { IERC20Metadata, IMarket, IMarket__factory, IMarketFactory } from '../../../types/generated'
import { MarketParameterStruct, RiskParameterStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'

export interface DeployProductParams
  extends Partial<Omit<RiskParameterStruct & MarketParameterStruct, 'payoffDefinition'>> {
  factory: IMarketFactory
  token: IERC20Metadata
  name: string
  symbol: string
  oracle: string
  payoff: string
  owner: SignerWithAddress
}

// Deploys a product that uses an oracle based on an oracle in the Chainlink feed registry.
// Returns the address of the deployed product.
export async function deployProductOnMainnetFork({
  token,
  factory,
  name,
  symbol,
  oracle,
  payoff,
  owner,
  maintenance,
  fundingFee,
  interestFee,
  makerFee,
  makerImpactFee,
  takerFee,
  takerSkewFee,
  takerImpactFee,
  positionFee,
  makerLimit,
  utilizationCurve,
  minMaintenance,
  staleAfter,
}: DeployProductParams): Promise<IMarket> {
  const riskParameter: RiskParameterStruct = {
    maintenance: maintenance ?? parse6decimal('0.10'),
    takerFee: takerFee ?? parse6decimal('0.0'),
    takerSkewFee: takerSkewFee ?? parse6decimal('0.0'),
    takerImpactFee: takerImpactFee ?? parse6decimal('0.0'),
    makerFee: makerFee ?? parse6decimal('0.0'),
    makerImpactFee: makerImpactFee ?? parse6decimal('0.0'),
    makerLimit: makerLimit ?? parse6decimal('100'),
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
    utilizationCurve: utilizationCurve ?? {
      minRate: parse6decimal('0.02'),
      maxRate: parse6decimal('0.80'),
      targetRate: parse6decimal('0.08'),
      targetUtilization: parse6decimal('0.80'),
    },
    pController: {
      k: parse6decimal('40000'),
      max: parse6decimal('1.20'),
    },
    minMaintenance: minMaintenance ?? parse6decimal('100'),
    staleAfter: staleAfter ?? 7200,
    makerReceiveOnly: false,
  }
  const marketParameter: MarketParameterStruct = {
    fundingFee: fundingFee ?? parse6decimal('0.00'),
    interestFee: interestFee ?? parse6decimal('0.00'),
    positionFee: positionFee ?? parse6decimal('0.0'),
    riskFee: 0,
    oracleFee: 0,
    closed: false,
  }
  const marketDefinition: IMarket.MarketDefinitionStruct = {
    name: name,
    symbol: symbol,
    token: token.address,
    reward: constants.AddressZero,
    oracle: oracle ?? constants.AddressZero,
    payoff: payoff ?? constants.AddressZero,
  }

  const productAddress = await factory.connect(owner).callStatic.create(marketDefinition, riskParameter)
  await factory.connect(owner).create(marketDefinition, riskParameter)

  const market = IMarket__factory.connect(productAddress, owner)
  await market.connect(owner).updateParameter(marketParameter)

  return market
}
