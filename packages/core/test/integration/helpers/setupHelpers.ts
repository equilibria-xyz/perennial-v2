import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { utils, BigNumber, ContractTransaction, constants } from 'ethers'

import { impersonate } from '../../../../common/testutil'
import {
  IERC20Metadata,
  Market,
  IERC20Metadata__factory,
  MarketFactory__factory,
  Market__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  MarketFactory,
  IOracleProvider,
  IMarket,
  VersionStorageLib__factory,
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  GuaranteeStorageLocalLib__factory,
  GuaranteeStorageGlobalLib__factory,
  OrderStorageLocalLib__factory,
  OrderStorageGlobalLib__factory,
  VersionLib__factory,
  Verifier,
  Verifier__factory,
  InsuranceFund__factory,
  InsuranceFund,
  Margin__factory,
  Margin,
  IVerifier,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@perennial/v2-oracle/util/constants'
import { MarketParameterStruct, RiskParameterStruct } from '../../../types/generated/contracts/Market'
import {
  OracleFactory,
  Oracle__factory,
  OracleFactory__factory,
  IOracle__factory,
  PowerTwo__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
  GasOracle__factory,
  KeeperOracle__factory,
  StorkFactory__factory,
  StorkFactory,
} from '@perennial/v2-oracle/types/generated'
const { deployments, ethers } = HRE

export const USDC_HOLDER = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'
const DSU_MINTER = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'
const CHAINLINK_ETH_USD_FEED = '0x841d7C994aC0Bb17CcD65a021E686e3cFafE2118'
const STORK_ADDRESS = '0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62'

export const STANDARD_PROTOCOL_PARAMETERS = {
  maxFee: parse6decimal('0.01'),
  maxLiquidationFee: parse6decimal('20'),
  maxCut: parse6decimal('0.50'),
  maxRate: parse6decimal('10.00'),
  minMaintenance: parse6decimal('0.01'),
  minEfficiency: parse6decimal('0.1'),
  referralFee: 0,
  minScale: parse6decimal('0.001'),
  maxStaleAfter: 64800, // 18 hours
  minMinMaintenance: 0,
}

export const STANDARD_RISK_PARAMETER = {
  margin: parse6decimal('0.3'),
  maintenance: parse6decimal('0.3'),
  synBook: {
    d0: 0,
    d1: 0,
    d2: 0,
    d3: 0,
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
  maxLiquidationFee: parse6decimal('10.00'),
}

export const STANDARD_MARKET_PARAMETER = {
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
}

export interface InstanceVars {
  owner: SignerWithAddress
  coordinator: SignerWithAddress
  pauser: SignerWithAddress
  user: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  beneficiaryB: SignerWithAddress
  proxyAdmin: ProxyAdmin
  oracleFactory: OracleFactory
  marketFactory: MarketFactory
  margin: Margin
  payoff: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  oracle: IOracleProvider
  marketImpl: Market
  verifier: Verifier
  insuranceFund: InsuranceFund
}

export async function deployProtocol(chainlinkContext?: ChainlinkContext): Promise<InstanceVars> {
  const [owner, pauser, user, userB, userC, userD, beneficiaryB, coordinator] = await ethers.getSigners()

  const payoff = IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)

  const chainlink =
    chainlinkContext ??
    (await new ChainlinkContext({ provider: payoff, decimals: -5 }, 1).init(BigNumber.from(0), BigNumber.from(0)))

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const oracleFactoryImpl = await deployOracleFactory(owner)
  const oracleFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    oracleFactoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const oracleFactory = new OracleFactory__factory(owner).attach(oracleFactoryProxy.address)

  const verifierImpl = await new Verifier__factory(owner).deploy()
  const verifierProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    verifierImpl.address,
    proxyAdmin.address,
    [],
  )

  const margin = await deployMargin(dsu, owner)
  const [factoryImpl, marketImpl] = await deployMarketFactory(oracleFactory, margin, verifierProxy, owner)
  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const marketFactory = new MarketFactory__factory(owner).attach(factoryProxy.address)
  const verifier = new Verifier__factory(owner).attach(verifierProxy.address)

  // Init
  await oracleFactory.connect(owner).initialize()
  await marketFactory.connect(owner).initialize()
  await verifier.connect(owner).initialize(marketFactory.address)
  await margin.connect(owner).initialize(marketFactory.address)

  // Params
  await marketFactory.updatePauser(pauser.address)
  await marketFactory.updateParameter(STANDARD_PROTOCOL_PARAMETERS)
  await oracleFactory.connect(owner).register(chainlink.oracleFactory.address)
  await oracleFactory.connect(owner).updateParameter({
    maxGranularity: 10000,
    maxAsyncFee: parse6decimal('500'),
    maxSyncFee: parse6decimal('500'),
    maxOracleFee: parse6decimal('0.5'),
  })
  const oracle = IOracle__factory.connect(
    await oracleFactory.connect(owner).callStatic.create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD'),
    owner,
  )
  await oracleFactory.connect(owner).create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD')

  const insuranceFundImpl = await new InsuranceFund__factory(owner).deploy(marketFactory.address, margin.address)

  const insuranceFundProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    insuranceFundImpl.address,
    proxyAdmin.address,
    [],
  )

  const insuranceFund = new InsuranceFund__factory(owner).attach(insuranceFundProxy.address)
  await insuranceFund.connect(owner).initialize()

  // Set state
  await fundWallet(dsu, user)
  await fundWallet(dsu, userB)
  await fundWallet(dsu, userC)
  await fundWallet(dsu, userD)
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))

  return {
    owner,
    coordinator,
    pauser,
    user,
    userB,
    userC,
    userD,
    beneficiaryB,
    chainlink,
    payoff,
    dsu,
    usdc,
    usdcHolder,
    proxyAdmin,
    oracleFactory,
    marketFactory,
    oracle,
    marketImpl,
    verifier,
    insuranceFund,
    margin,
  }
}

export async function deployMargin(dsu: IERC20Metadata, owner: SignerWithAddress): Promise<Margin> {
  return await new Margin__factory(
    {
      'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
        await new CheckpointStorageLib__factory(owner).deploy()
      ).address,
    },
    owner,
  ).deploy(dsu.address)
}

export async function deployMarketFactory(
  oracleFactory: OracleFactory,
  margin: Margin,
  verifier: IVerifier,
  owner: SignerWithAddress,
): Promise<[MarketFactory, Market]> {
  const marketImpl = await new Market__factory(
    {
      'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
      'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
      'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
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
  ).deploy(verifier.address, margin.address)

  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactory.address,
    verifier.address,
    marketImpl.address,
  )

  return [factoryImpl, marketImpl]
}

export async function deployOracleFactory(owner: SignerWithAddress): Promise<OracleFactory> {
  // Deploy oracle factory to a proxy
  const oracleImpl = await new Oracle__factory(owner).deploy()
  const oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
  return oracleFactory
}

export async function deployStorkOracleFactory(
  owner: SignerWithAddress,
  oracleFactory: OracleFactory,
): Promise<StorkFactory> {
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

  const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
  const StorkOracleFactory = await new StorkFactory__factory(owner).deploy(
    STORK_ADDRESS,
    commitmentGasOracle.address,
    settlementGasOracle.address,
    keeperOracleImpl.address,
  )
  await StorkOracleFactory.initialize(oracleFactory.address)
  // KeeperFactory.updateParameter args: granularity, oracleFee, validFrom, validTo
  await StorkOracleFactory.updateParameter(1, 0, 4, 10)
  await oracleFactory.register(StorkOracleFactory.address)
  // TODO: register payoff?

  return StorkOracleFactory
}

export async function fundWallet(dsu: IERC20Metadata, wallet: SignerWithAddress): Promise<void> {
  const dsuMinter = await impersonate.impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await dsuMinter.sendTransaction({
    to: dsu.address,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [utils.parseEther('200000')]),
  })
  await dsu.connect(dsuMinter).transfer(wallet.address, utils.parseEther('200000'))
}

export async function createMarket(
  instanceVars: InstanceVars,
  riskParamOverrides?: Partial<RiskParameterStruct>,
  marketParamOverrides?: Partial<MarketParameterStruct>,
): Promise<Market> {
  const { owner, marketFactory, coordinator, oracle } = instanceVars

  const riskParameter = { ...STANDARD_RISK_PARAMETER, ...riskParamOverrides }
  const marketParameter = { ...STANDARD_MARKET_PARAMETER, ...marketParamOverrides }
  const marketAddress = await marketFactory.callStatic.create(oracle.address)
  await marketFactory.create(oracle.address)

  const market = Market__factory.connect(marketAddress, owner)
  await market.updateRiskParameter(riskParameter)
  await market.updateParameter(marketParameter)
  await market.updateCoordinator(coordinator.address)

  await oracle.register(market.address)

  return market
}

export async function settle(market: IMarket, account: SignerWithAddress): Promise<ContractTransaction> {
  return market.connect(account).settle(account.address)
}
