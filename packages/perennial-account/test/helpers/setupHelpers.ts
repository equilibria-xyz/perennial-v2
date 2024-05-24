import HRE, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, ContractTransaction, constants, utils } from 'ethers'
import { impersonateWithBalance } from '../../../common/testutil/impersonate'
import { parse6decimal } from '../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'

import { IERC20Metadata } from '../../types/generated'
import {
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  IMarket,
  IMarketFactory,
  InvariantLib__factory,
  IOracleProvider,
  IVerifier,
  Market,
  Market__factory,
  MarketFactory,
  MarketFactory__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  ProxyAdmin__factory,
  RiskParameterStorageLib__factory,
  TransparentUpgradeableProxy__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
} from '@equilibria/perennial-v2/types/generated'
import { MarketParameterStruct, RiskParameterStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'
import { OracleFactory, OracleFactory__factory, IKeeperOracle } from '@equilibria/perennial-v2-oracle/types/generated'
import { currentBlockTimestamp, increaseTo } from '../../../common/testutil/time'
import { OracleVersionStruct } from '../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IOracleProvider'

// Deploys an empty market used by the factory as a template for creating new markets
async function deployMarketImplementation(owner: SignerWithAddress, verifierAddress: Address): Promise<Market> {
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

// Deploys the market factory and configures default protocol parameters
async function deployMarketFactory(
  owner: SignerWithAddress,
  pauser: SignerWithAddress,
  oracleFactoryAddress: Address,
  verifierAddress: Address,
  marketImplAddress: Address,
): Promise<MarketFactory> {
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()
  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactoryAddress,
    verifierAddress,
    marketImplAddress,
  )
  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const marketFactory = new MarketFactory__factory(owner).attach(factoryProxy.address)
  await marketFactory.connect(owner).initialize()

  // Set protocol parameters
  await marketFactory.updatePauser(pauser.address)
  await marketFactory.updateParameter({
    protocolFee: parse6decimal('0.50'),
    maxFee: parse6decimal('0.01'),
    maxFeeAbsolute: parse6decimal('1000'),
    maxCut: parse6decimal('0.50'),
    maxRate: parse6decimal('10.00'),
    minMaintenance: parse6decimal('0.01'),
    minEfficiency: parse6decimal('0.1'),
    referralFee: 0,
  })

  return marketFactory
}

// Deploys the protocol using an existing "real" oracle
export async function deployProtocolForOracle(
  owner: SignerWithAddress,
  oracleFactory: OracleFactory,
  oracleFactoryOwnerAddress: Address,
): Promise<IMarketFactory> {
  // Deploy protocol contracts
  const verifier = await smock.fake<IVerifier>(
    '@equilibria/perennial-v2-verifier/contracts/interfaces/IVerifier.sol:IVerifier',
  )
  const marketImpl = await deployMarketImplementation(owner, verifier.address)
  const marketFactory = await deployMarketFactory(
    owner,
    owner,
    oracleFactory.address,
    verifier.address,
    marketImpl.address,
  )

  // Impersonate the owner of the oracle factory to authorize it for the newly-deployed market factory
  oracleFactory = new OracleFactory__factory(owner).attach(oracleFactory.address)
  const oracleFactoryOwner = await impersonateWithBalance(oracleFactoryOwnerAddress, utils.parseEther('10'))
  await oracleFactory.connect(oracleFactoryOwner).authorize(marketFactory.address)
  return marketFactory
}

// Using a provided factory, create a new market and set some reasonable initial parameters
export async function createMarket(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  dsu: IERC20Metadata,
  oracle: IOracleProvider,
  riskParamOverrides?: Partial<RiskParameterStruct>,
  marketParamOverrides?: Partial<MarketParameterStruct>,
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
    closed: false,
    settle: false,
    ...marketParamOverrides,
  }
  const marketAddress = await marketFactory.callStatic.create(definition)
  await marketFactory.create(definition)

  const market = Market__factory.connect(marketAddress, owner)
  await market.updateRiskParameter(riskParameter)
  await market.updateParameter(constants.AddressZero, constants.AddressZero, marketParameter)

  return market
}

// Simulates an oracle update from KeeperOracle.
// If timestamp matches a requested version, callbacks implicitly settle the market.
export async function advanceToPrice(
  keeperOracle: IKeeperOracle,
  timestamp: BigNumber,
  price: BigNumber,
): Promise<number> {
  const keeperFactoryAddress = await keeperOracle.factory()
  const oracleFactory = await impersonateWithBalance(keeperFactoryAddress, utils.parseEther('10'))

  // a keeper cannot commit a future price, so advance past the block
  const currentBlockTime = BigNumber.from(await currentBlockTimestamp())
  if (currentBlockTime < timestamp) await increaseTo(timestamp.toNumber() + 2)

  // create a version with the desired parameters and commit to the KeeperOracle
  const oracleVersion: OracleVersionStruct = {
    timestamp: timestamp,
    price: price,
    valid: true,
  }
  const tx: ContractTransaction = await keeperOracle.connect(oracleFactory).commit(oracleVersion, {
    maxFeePerGas: 100000000,
  })

  // inform the caller of the current timestamp
  return (await HRE.ethers.provider.getBlock(tx.blockNumber ?? 0)).timestamp
}

// placates linter, which has an aversion to non-null assertions
export async function getEventArguments(tx: ContractTransaction, name: string): Promise<any> {
  const receipt = await tx.wait()
  if (!receipt.events) throw new Error('Transaction receipt had no events')
  const firstMatch = receipt.events.find(e => e.event === name)
  if (!firstMatch) throw new Error(`Transaction did not raise ${name} event`)
  const args = firstMatch.args
  if (!args) throw new Error(`${name} event had no arguments`)
  return args
}

// Creates a market for a specified collateral token, which can't do much of anything
export async function mockMarket(token: Address): Promise<IMarket> {
  const oracle = await smock.fake<IOracleProvider>('IOracleProvider')
  const verifier = await smock.fake<IVerifier>(
    '@equilibria/perennial-v2-verifier/contracts/interfaces/IVerifier.sol:IVerifier',
  )
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
