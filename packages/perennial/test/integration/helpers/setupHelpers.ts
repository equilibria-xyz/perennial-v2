import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { utils, ContractTransaction, constants } from 'ethers'

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
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { MarketParameterStruct, RiskParameterStruct } from '../../../types/generated/contracts/Market'
import {
  OracleFactory,
  Oracle__factory,
  OracleFactory__factory,
  IOracle__factory,
  PowerTwo__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
const { deployments, ethers } = HRE

export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

export interface InstanceVars {
  owner: SignerWithAddress
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
}

export async function deployProtocol(chainlinkContext?: ChainlinkContext): Promise<InstanceVars> {
  const [owner, pauser, user, userB, userC, userD, beneficiaryB] = await ethers.getSigners()

  const payoff = IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)

  const chainlink =
    chainlinkContext ??
    (await new ChainlinkContext(CHAINLINK_CUSTOM_CURRENCIES.ETH, CHAINLINK_CUSTOM_CURRENCIES.USD, payoff, 1).init())

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

  const marketImpl = await new Market__factory(owner).deploy()

  const factoryImpl = await new MarketFactory__factory(owner).deploy(oracleFactory.address, marketImpl.address)

  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )

  const marketFactory = new MarketFactory__factory(owner).attach(factoryProxy.address)

  // Init
  await oracleFactory.connect(owner).initialize(dsu.address)
  await marketFactory.connect(owner).initialize()

  // Params
  await marketFactory.updatePauser(pauser.address)
  await marketFactory.updateParameter({
    protocolFee: parse6decimal('0.50'),
    maxFee: parse6decimal('0.01'),
    maxFeeAbsolute: parse6decimal('1000'),
    maxCut: parse6decimal('0.50'),
    maxRate: parse6decimal('10.00'),
    minMaintenance: parse6decimal('0.01'),
    minEfficiency: parse6decimal('0.1'),
  })
  await oracleFactory.connect(owner).register(chainlink.oracleFactory.address)
  await oracleFactory.connect(owner).authorize(marketFactory.address)
  const oracle = IOracle__factory.connect(
    await oracleFactory.connect(owner).callStatic.create(chainlink.id, chainlink.oracleFactory.address),
    owner,
  )
  await oracleFactory.connect(owner).create(chainlink.id, chainlink.oracleFactory.address)

  // Set state
  await fundWallet(dsu, user)
  await fundWallet(dsu, userB)
  await fundWallet(dsu, userC)
  await fundWallet(dsu, userD)
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))

  return {
    owner,
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
  const { owner, marketFactory, beneficiaryB, oracle, dsu } = instanceVars

  const definition = {
    token: dsu.address,
    oracle: (oracleOverride ?? oracle).address,
  }
  const riskParameter = {
    margin: parse6decimal('0.3'),
    maintenance: parse6decimal('0.3'),
    takerFee: 0,
    takerSkewFee: 0,
    takerImpactFee: 0,
    makerFee: 0,
    makerImpactFee: 0,
    makerLimit: parse6decimal('1000'),
    efficiencyLimit: parse6decimal('0.2'),
    liquidationFee: parse6decimal('0.50'),
    minLiquidationFee: parse6decimal('0'),
    maxLiquidationFee: parse6decimal('1000'),
    utilizationCurve: {
      minRate: 0,
      maxRate: parse6decimal('5.00'),
      targetRate: parse6decimal('0.80'),
      targetUtilization: parse6decimal('0.80'),
    },
    pController: {
      k: parse6decimal('40000'),
      max: parse6decimal('1.20'),
    },
    minMargin: parse6decimal('500'),
    minMaintenance: parse6decimal('500'),
    skewScale: 0,
    staleAfter: 7200,
    makerReceiveOnly: false,
    ...riskParamOverrides,
  }
  const marketParameter = {
    fundingFee: parse6decimal('0.1'),
    interestFee: parse6decimal('0.1'),
    oracleFee: 0,
    riskFee: 0,
    positionFee: 0,
    maxPendingGlobal: 8,
    maxPendingLocal: 8,
    settlementFee: 0,
    makerCloseAlways: false,
    takerCloseAlways: false,
    closed: false,
    ...marketParamOverrides,
  }
  const marketAddress = await marketFactory.callStatic.create(definition)
  await marketFactory.create(definition)

  const market = Market__factory.connect(marketAddress, owner)
  await market.updateRiskParameter(riskParameter)
  await market.updateParameter(beneficiaryB.address, constants.AddressZero, marketParameter)

  return market
}

export async function settle(market: IMarket, account: SignerWithAddress): Promise<ContractTransaction> {
  const local = await market.locals(account.address)
  const currentPosition = await market.pendingPositions(account.address, local.currentId)
  return market
    .connect(account)
    .update(account.address, currentPosition.maker, currentPosition.long, currentPosition.short, 0, false)
}
