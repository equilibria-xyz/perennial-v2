import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, CallOverrides, constants, ContractTransaction, utils } from 'ethers'
import { impersonateWithBalance } from '../../../common/testutil/impersonate'
import { smock } from '@defi-wonderland/smock'
import { parse6decimal } from '../../../common/testutil/types'
import { currentBlockTimestamp, increaseTo } from '../../../common/testutil/time'
import { getTimestamp } from '../../../common/testutil/transaction'

import { Account__factory, Controller, Controller__factory, IERC20Metadata } from '../../types/generated'
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
  MagicValueLib__factory,
} from '@perennial/core/types/generated'
import { MarketParameterStruct, RiskParameterStruct } from '@perennial/core/types/generated/contracts/Market'

import {
  OracleFactory__factory,
  IKeeperOracle,
  Oracle__factory,
  IOracleFactory,
  IOracle,
} from '@perennial/oracle/types/generated'
import { OracleVersionStruct } from '../../types/generated/@perennial/core/contracts/interfaces/IOracleProvider'
import { Verifier__factory } from '@perennial/verifier/types/generated'

// Simulates an oracle update from KeeperOracle.
// If timestamp matches a requested version, callbacks implicitly settle the market.
export async function advanceToPrice(
  keeperOracle: IKeeperOracle,
  receiver: SignerWithAddress,
  timestamp: BigNumber,
  price: BigNumber,
  overrides?: CallOverrides,
): Promise<number> {
  const keeperFactoryAddress = await keeperOracle.factory()
  const oracleFactory = await impersonateWithBalance(keeperFactoryAddress, utils.parseEther('10'))

  // a keeper cannot commit a future price, so advance past the block
  const currentBlockTime = BigNumber.from(await currentBlockTimestamp())
  if (currentBlockTime < timestamp) {
    await increaseTo(timestamp.toNumber() + 2)
  }

  // create a version with the desired parameters and commit to the KeeperOracle
  const oracleVersion: OracleVersionStruct = {
    timestamp: timestamp,
    price: price,
    valid: true,
  }
  const tx: ContractTransaction = await keeperOracle
    .connect(oracleFactory)
    .commit(oracleVersion, receiver.address, 0, overrides ?? {})

  // inform the caller of the current timestamp
  return await getTimestamp(tx)
}

// Using a provided factory, create a new market and set some reasonable initial parameters
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
    riskFee: 0,
    makerFee: 0,
    takerFee: 0,
    maxPendingGlobal: 8,
    maxPendingLocal: 8,
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

export async function deployController(
  owner: SignerWithAddress,
  usdcAddress: Address,
  dsuAddress: Address,
  reserveAddress: Address,
  marketFactoryAddress: Address,
): Promise<Controller> {
  const accountImpl = await new Account__factory(owner).deploy(usdcAddress, dsuAddress, reserveAddress)
  accountImpl.initialize(constants.AddressZero)
  const controller = await new Controller__factory(owner).deploy(accountImpl.address, marketFactoryAddress)
  return controller
}

// Deploys the protocol using a provided oracle
export async function deployProtocolForOracle(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
): Promise<IMarketFactory> {
  // Deploy protocol contracts
  const verifier = await new Verifier__factory(owner).deploy()
  const marketImpl = await deployMarketImplementation(owner, verifier.address)
  const marketFactory = await deployMarketFactory(
    owner,
    owner,
    oracleFactory.address,
    verifier.address,
    marketImpl.address,
  )
  return marketFactory
}

// Creates a market for a specified collateral token, which can't do much of anything
export async function mockMarket(token: Address): Promise<IMarket> {
  const oracle = await smock.fake<IOracleProvider>('IOracleProvider')
  const verifier = await smock.fake<IVerifier>('@perennial/verifier/contracts/interfaces/IVerifier.sol:IVerifier')
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
      'contracts/libs/MagicValueLib.sol:MagicValueLib': (await new MagicValueLib__factory(owner).deploy()).address,
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

export async function deployOracleFactory(owner: SignerWithAddress): Promise<IOracleFactory> {
  // Deploy oracle factory to a proxy
  const oracleImpl = await new Oracle__factory(owner).deploy()
  const oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
  await oracleFactory.connect(owner).initialize()
  return oracleFactory
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
    maxFee: parse6decimal('0.01'),
    maxLiquidationFee: parse6decimal('20'),
    maxCut: parse6decimal('0.50'),
    maxRate: parse6decimal('10.00'),
    minMaintenance: parse6decimal('0.01'),
    minEfficiency: parse6decimal('0.1'),
    referralFee: 0,
    minScale: parse6decimal('0.001'),
    maxStaleAfter: 7200,
  })

  return marketFactory
}

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
      'contracts/libs/MagicValueLib.sol:MagicValueLib': (await new MagicValueLib__factory(owner).deploy()).address,
    },
    owner,
  ).deploy(verifierAddress)
  return marketImpl
}
