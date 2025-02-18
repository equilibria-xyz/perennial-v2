import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Margin__factory } from '@perennial/v2-core/types/generated'

import {
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  GuaranteeStorageGlobalLib__factory,
  GuaranteeStorageLocalLib__factory,
  IOracleFactory,
  InvariantLib__factory,
  Market__factory,
  MarketFactory,
  MarketFactory__factory,
  MarketParameterStorageLib__factory,
  OrderStorageGlobalLib__factory,
  OrderStorageLocalLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
  IERC20Metadata__factory,
} from '../types/generated'

// Deploys Verifier, Market implementation, and MarketFactory
export async function deployMarketFactory(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  dsu: IERC20Metadata,
): Promise<MarketFactory> {
  const verifierImpl = await new VersionStorageLib__factory(owner).deploy()

  const margin = await new Margin__factory(
    {
      'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
        await new CheckpointStorageLib__factory(owner).deploy()
      ).address,
    },
    owner,
  ).deploy(dsu.address)

  const marketImpl = await new Market__factory(
    {
      '@perennial/v2-core/contracts/libs/CheckpointLib.sol:CheckpointLib': (
        await new CheckpointLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/libs/InvariantLib.sol:InvariantLib': (
        await new InvariantLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/libs/VersionLib.sol:VersionLib': (
        await new VersionLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Global.sol:GlobalStorageLib': (
        await new GlobalStorageLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
        await new MarketParameterStorageLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Position.sol:PositionStorageGlobalLib': (
        await new PositionStorageGlobalLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Position.sol:PositionStorageLocalLib': (
        await new PositionStorageLocalLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
        await new RiskParameterStorageLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Version.sol:VersionStorageLib': (
        await new VersionStorageLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': (
        await new GuaranteeStorageLocalLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': (
        await new GuaranteeStorageGlobalLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Order.sol:OrderStorageLocalLib': (
        await new OrderStorageLocalLib__factory(owner).deploy()
      ).address,
      '@perennial/v2-core/contracts/types/Order.sol:OrderStorageGlobalLib': (
        await new OrderStorageGlobalLib__factory(owner).deploy()
      ).address,
    },
    owner,
  ).deploy(verifierImpl.address, margin.address)
  const marketFactory = await new MarketFactory__factory(owner).deploy(
    oracleFactory.address,
    verifierImpl.address,
    marketImpl.address,
  )
  await margin.connect(owner).initialize(marketFactory.address)
  return marketFactory
}
