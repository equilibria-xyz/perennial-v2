import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { IERC20Metadata, IFactory, IMarket, IMarket__factory } from '../../../types/generated'
import { MarketParameterStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IFactory'

export interface DeployProductParams extends Partial<Omit<MarketParameterStruct, 'payoffDefinition'>> {
  factory: IFactory
  token: IERC20Metadata
  name: string
  symbol: string
  owner: SignerWithAddress
}

// Deploys a product that uses an oracle based on an oracle in the Chainlink feed registry.
// Returns the address of the deployed product.
export async function deployProductOnMainnetFork({
  token,
  factory,
  name,
  symbol,
  owner,
  oracle,
  maintenance,
  fundingFee,
  makerFee,
  takerFee,
  positionFee,
  makerLimit,
  utilizationCurve,
}: DeployProductParams): Promise<IMarket> {
  const marketParameter: MarketParameterStruct = {
    maintenance: maintenance ?? parse6decimal('0.10'),
    fundingFee: fundingFee ?? parse6decimal('0.00'),
    takerFee: takerFee ?? parse6decimal('0.0'),
    makerFee: makerFee ?? parse6decimal('0.0'),
    positionFee: positionFee ?? parse6decimal('0.0'),
    makerLimit: makerLimit ?? parse6decimal('100'),
    closed: false,
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
    utilizationCurve: utilizationCurve ?? {
      minRate: parse6decimal('0.02'),
      maxRate: parse6decimal('0.08'),
      targetRate: parse6decimal('0.80'),
      targetUtilization: parse6decimal('0.80'),
    },
    oracle: oracle ?? constants.AddressZero,
    payoff: {
      provider: constants.AddressZero,
      short: false,
    },
  }
  const marketDefinition: IMarket.MarketDefinitionStruct = {
    name: name,
    symbol: symbol,
    token: token.address,
    reward: constants.AddressZero,
  }

  const productAddress = await factory.connect(owner).callStatic.createMarket(marketDefinition, marketParameter)
  await factory.connect(owner).createMarket(marketDefinition, marketParameter)

  return IMarket__factory.connect(productAddress, owner)
}
