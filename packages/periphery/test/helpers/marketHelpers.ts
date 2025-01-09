import { ethers } from 'hardhat'
import { BigNumber, CallOverrides, utils, constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import {
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  IMarket,
  IMarketFactory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  Market__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
} from '@perennial/v2-core/types/generated'
import { IOracle } from '@perennial/v2-oracle/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata, IOracleProvider, IVerifier } from '../../types/generated'
import { parse6decimal } from '../../../common/testutil/types'
import { MarketParameterStruct, RiskParameterStruct } from '@perennial/v2-core/types/generated/contracts/Market'
import { smock } from '@defi-wonderland/smock'
import { impersonateWithBalance } from '../../../common/testutil/impersonate'

export async function createMarket(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  dsu: IERC20Metadata,
  oracle: IOracle,
  riskParamOverrides?: Partial<RiskParameterStruct>,
  marketParamOverrides?: Partial<MarketParameterStruct>,
  overrides?: CallOverrides,
): Promise<IMarket> {
  const definition = {
    token: dsu.address,
    oracle: oracle.address,
  }
  const riskParameter = {
    margin: parse6decimal('0.3'),
    maintenance: parse6decimal('0.3'),
    takerFee: {
      linearFee: 0,
      proportionalFee: 0,
      adiabaticFee: 0,
      scale: parse6decimal('10000'),
    },
    makerFee: {
      linearFee: 0,
      proportionalFee: 0,
      adiabaticFee: 0,
      scale: parse6decimal('10000'),
    },
    makerLimit: parse6decimal('1000'),
    efficiencyLimit: parse6decimal('0.2'),
    liquidationFee: parse6decimal('10.00'),
    utilizationCurve: {
      minRate: 0,
      maxRate: parse6decimal('5.00'),
      targetRate: parse6decimal('0.80'),
      targetUtilization: parse6decimal('0.80'),
    },

    pController: {
      k: parse6decimal('40000'),
      min: parse6decimal('-1.20'),
      max: parse6decimal('1.20'),
    },
    minMargin: parse6decimal('500'),
    minMaintenance: parse6decimal('500'),
    staleAfter: 7200,
    makerReceiveOnly: false,
    ...riskParamOverrides,
  }
  const marketParameter = {
    fundingFee: parse6decimal('0.1'),
    interestFee: parse6decimal('0.1'),
    oracleFee: 0,
    riskFee: 0,
    makerFee: 0,
    takerFee: 0,
    maxPendingGlobal: 8,
    maxPendingLocal: 8,
    settlementFee: 0,
    maxPriceDeviation: parse6decimal('0.1'),
    closed: false,
    settle: false,
    ...marketParamOverrides,
  }
  const marketAddress = await marketFactory.callStatic.create(definition)
  await marketFactory.create(definition, overrides ?? {})

  const market = Market__factory.connect(marketAddress, owner)
  await market.updateRiskParameter(riskParameter, overrides ?? {})
  await market.updateParameter(marketParameter, overrides ?? {})

  return market
}

// Deploys an empty market used by the factory as a template for creating new markets
export async function deployMarketImplementation(owner: SignerWithAddress, verifierAddress: Address): Promise<Market> {
  const marketImpl = await new Market__factory(
    {
      'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
      'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
      'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
      'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
        await new CheckpointStorageLib__factory(owner).deploy()
      ).address,
      'contracts/types/Global.sol:GlobalStorageLib': (await new GlobalStorageLib__factory(owner).deploy()).address,
      'contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
        await new MarketParameterStorageLib__factory(owner).deploy()
      ).address,
      'contracts/types/Position.sol:PositionStorageGlobalLib': (
        await new PositionStorageGlobalLib__factory(owner).deploy()
      ).address,
      'contracts/types/Position.sol:PositionStorageLocalLib': (
        await new PositionStorageLocalLib__factory(owner).deploy()
      ).address,
      'contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
        await new RiskParameterStorageLib__factory(owner).deploy()
      ).address,
      'contracts/types/Version.sol:VersionStorageLib': (await new VersionStorageLib__factory(owner).deploy()).address,
    },
    owner,
  ).deploy(verifierAddress)
  return marketImpl
}

// Creates a market for a specified collateral token, which can't do much of anything
export async function mockMarket(token: Address): Promise<IMarket> {
  const oracle = await smock.fake<IOracleProvider>('IOracleProvider')
  const verifier = await smock.fake<IVerifier>('IVerifier')
  const factory = await smock.fake<IMarketFactory>('IMarketFactory')
  const factorySigner = await impersonateWithBalance(factory.address, utils.parseEther('10'))

  // deploy market
  const [owner] = await ethers.getSigners()
  const market = await new Market__factory(
    {
      'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
      'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
      'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
      'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
        await new CheckpointStorageLib__factory(owner).deploy()
      ).address,
      'contracts/types/Global.sol:GlobalStorageLib': (await new GlobalStorageLib__factory(owner).deploy()).address,
      'contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
        await new MarketParameterStorageLib__factory(owner).deploy()
      ).address,
      'contracts/types/Position.sol:PositionStorageGlobalLib': (
        await new PositionStorageGlobalLib__factory(owner).deploy()
      ).address,
      'contracts/types/Position.sol:PositionStorageLocalLib': (
        await new PositionStorageLocalLib__factory(owner).deploy()
      ).address,
      'contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
        await new RiskParameterStorageLib__factory(owner).deploy()
      ).address,
      'contracts/types/Version.sol:VersionStorageLib': (await new VersionStorageLib__factory(owner).deploy()).address,
    },
    owner,
  ).deploy(verifier.address)

  // initialize market
  const marketDefinition = {
    token: token,
    oracle: oracle.address,
  }
  await market.connect(factorySigner).initialize(marketDefinition)
  return market
}

// Deposits collateral to (amount > 0) or withdraws collateral from (amount < 0) a market
export async function transferCollateral(user: SignerWithAddress, market: IMarket, amount: BigNumber) {
  await market.connect(user)['update(address,int256,int256,address)'](user.address, 0, amount, constants.AddressZero)
}
