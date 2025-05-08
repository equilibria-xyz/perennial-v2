import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
const { ethers } = HRE
const { constants, utils } = ethers
import { Address } from 'hardhat-deploy/dist/types'

const STORK_ADDRESS = '0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_ADDRESS = '0x7b4Adf64B0d60fF97D672E473420203D52562A84'
const USDC_ADDRESS = '0x39CD9EF9E511ec008247aD5DA01245D84a9521be'
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

import {
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  GuaranteeStorageGlobalLib__factory,
  GuaranteeStorageLocalLib__factory,
  InvariantLib__factory,
  Market,
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
} from '../../types/generated'
import {
  GasOracle__factory,
  KeeperOracle__factory,
  StorkFactory,
  StorkFactory__factory,
} from '@perennial/v2-oracle/types/generated'
import { MultiInvoker, MultiInvoker_Optimism__factory, VaultFactory } from '@perennial/v2-periphery/types/generated'

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
      'contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': (
        await new GuaranteeStorageLocalLib__factory(owner).deploy()
      ).address,
      'contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': (
        await new GuaranteeStorageGlobalLib__factory(owner).deploy()
      ).address,
      'contracts/types/Order.sol:OrderStorageLocalLib': (
        await new OrderStorageLocalLib__factory(owner).deploy()
      ).address,
      'contracts/types/Order.sol:OrderStorageGlobalLib': (
        await new OrderStorageGlobalLib__factory(owner).deploy()
      ).address,
    },
    owner,
  ).deploy(verifierAddress)
  return marketImpl
}

export async function deployMarketFactoryImplementation(
  owner: SignerWithAddress,
  marketImpl: Market,
  oracleFactoryAddress: Address,
  verifierAddress: Address,
): Promise<MarketFactory> {
  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactoryAddress,
    verifierAddress,
    marketImpl.address,
  )
  await factoryImpl.connect(owner).initialize()

  return factoryImpl
}

export async function deployStorkOracleFactoryImplementation(owner: SignerWithAddress): Promise<StorkFactory> {
  const commitmentGasOracle = await new GasOracle__factory(owner).deploy(
    CHAINLINK_ETH_USD_FEED,
    8,
    1_000_000,
    ethers.utils.parseEther('1.02'),
    1_000_000,
    0,
    0,
    0,
  )
  const settlementGasOracle = await new GasOracle__factory(owner).deploy(
    CHAINLINK_ETH_USD_FEED,
    8,
    200_000,
    ethers.utils.parseEther('1.02'),
    500_000,
    0,
    0,
    0,
  )
  const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(30)
  const storkOracleFactoryImpl = await new StorkFactory__factory(owner).deploy(
    STORK_ADDRESS,
    commitmentGasOracle.address,
    settlementGasOracle.address,
    keeperOracleImpl.address,
  )

  return storkOracleFactoryImpl
}

export async function deployMultiInvokerImplementation(
  owner: SignerWithAddress,
  marketFactoryAddress: Address,
  makerVaultFactory?: VaultFactory,
  solverVaultFactory?: VaultFactory,
): Promise<MultiInvoker> {
  const multiInvoker = await new MultiInvoker_Optimism__factory(owner).deploy(
    USDC_ADDRESS,
    DSU_ADDRESS,
    marketFactoryAddress,
    makerVaultFactory ? makerVaultFactory.address : constants.AddressZero,
    solverVaultFactory ? solverVaultFactory.address : constants.AddressZero,
    constants.AddressZero,
    DSU_RESERVE,
    500_000,
    500_000,
  )

  return multiInvoker
}
