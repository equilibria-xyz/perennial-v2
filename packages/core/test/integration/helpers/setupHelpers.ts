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
} from '@perennial/v2-oracle/types/generated'
const { deployments, ethers } = HRE

export const USDC_HOLDER = '0x47c031236e19d024b42f8ae6780e44a573170703'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

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
  payoff: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  oracle: IOracleProvider
  marketImpl: Market
  verifier: Verifier
}

export async function deployProtocol(chainlinkContext?: ChainlinkContext): Promise<InstanceVars> {
  const [owner, pauser, user, userB, userC, userD, beneficiaryB, coordinator] = await ethers.getSigners()

  const payoff = IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)

  const chainlink =
    chainlinkContext ??
    (await new ChainlinkContext(
      CHAINLINK_CUSTOM_CURRENCIES.ETH,
      CHAINLINK_CUSTOM_CURRENCIES.USD,
      { provider: payoff, decimals: -5 },
      1,
    ).init(BigNumber.from(0), BigNumber.from(0)))

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const oracleImpl = await new Oracle__factory(owner).deploy()

  const oracleFactoryImpl = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
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
  ).deploy(verifierProxy.address)

  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactory.address,
    verifierProxy.address,
    marketImpl.address,
  )

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

  // Params
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
    maxStaleAfter: 172800, // 2 days
  })
  await oracleFactory.connect(owner).register(chainlink.oracleFactory.address)
  await oracleFactory.connect(owner).updateParameter({
    maxGranularity: 10000,
    maxSettlementFee: parse6decimal('1000'),
    maxOracleFee: parse6decimal('0.5'),
  })
  const oracle = IOracle__factory.connect(
    await oracleFactory.connect(owner).callStatic.create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD'),
    owner,
  )
  await oracleFactory.connect(owner).create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD')

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
  }
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
  oracleOverride?: IOracleProvider,
  riskParamOverrides?: Partial<RiskParameterStruct>,
  marketParamOverrides?: Partial<MarketParameterStruct>,
): Promise<Market> {
  const { owner, marketFactory, coordinator, beneficiaryB, oracle, dsu } = instanceVars

  const definition = {
    token: dsu.address,
    oracle: (oracleOverride ?? oracle).address,
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
  await marketFactory.create(definition)

  const market = Market__factory.connect(marketAddress, owner)
  await market.updateRiskParameter(riskParameter)
  await market.updateBeneficiary(beneficiaryB.address)
  await market.updateParameter(marketParameter)
  await market.updateCoordinator(coordinator.address)

  await oracle.register(market.address)

  return market
}

export async function settle(market: IMarket, account: SignerWithAddress): Promise<ContractTransaction> {
  return market.connect(account).settle(account.address)
}
