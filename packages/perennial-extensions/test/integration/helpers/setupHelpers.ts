import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { BigNumber, utils, ContractTransaction } from 'ethers'

import { time, impersonate } from '../../../../common/testutil'

// extensions types
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
  IOracleProvider,
  MultiInvoker,
  MultiInvoker__factory,
  IBatcher,
  IBatcher__factory,
  IEmptySetReserve,
  IEmptySetReserve__factory,
  Market,
  Market__factory,
  PowerTwo__factory,
  IMarket,
  IMarket__factory,
  IVault,
  IVaultFactory,
  IVaultFactory__factory,
  IVault__factory,
  Vault,
  VaultFactory,
  VaultFactory__factory,
  Vault__factory,
  OracleFactory,
  Oracle__factory,
  OracleFactory__factory,
  IOracle__factory,
  PayoffFactory__factory,
  PayoffFactory,
} from '../../../types/generated'

// v2 core types
import {
  Factory,
  Factory__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  IOracleProvider__factory,
} from '@equilibria/perennial-v2/types/generated'

import { ChainlinkContext } from '@equilibria/perennial-v2/test/integration/helpers/chainlinkHelpers'

import { parse6decimal } from '../../../../common/testutil/types'
import { buildChainlinkRoundId } from '@equilibria/perennial-v2-oracle/util/buildChainlinkRoundId'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { currentBlockTimestamp } from '../../../../common/testutil/time'

import { MarketFactory } from '@equilibria/perennial-v2/types/generated/contracts'

import {
  MarketParameterStruct,
  RiskParameterStruct,
} from '../../../types/generated/@equilibria/perennial-v2/contracts/Market'
import { MarketFactory__factory } from '@equilibria/perennial-v2/types/generated'

const { config, deployments, ethers } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const INITIAL_VERSION = 2472 // registry's phase 1 starts at aggregatorRoundID 7528

export const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

// @todo fix external deployment deps
export const BATCHER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'
export const RESERVE = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'
export const ETH_ORACLE = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // chainlink eth oracle
export const CHAINLINK_REGISTRY = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'
export const DSU = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

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
  payoffFactory: PayoffFactory
  marketFactory: MarketFactory
  payoff: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  oracle: IOracleProvider
  marketImpl: Market
  rewardToken: ERC20PresetMinterPauser
}

export async function deployProtocol(chainlinkContext?: ChainlinkContext): Promise<InstanceVars> {
  const [owner, pauser, user, userB, userC, userD, beneficiaryB] = await ethers.getSigners()

  const payoff = IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)
  const dsu = IERC20Metadata__factory.connect(DSU, owner)
  const usdc = IERC20Metadata__factory.connect(USDC, owner)

  const chainlink =
    chainlinkContext ??
    (await new ChainlinkContext(CHAINLINK_CUSTOM_CURRENCIES.ETH, CHAINLINK_CUSTOM_CURRENCIES.USD, 1).init())

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

  const payoffFactoryImpl = await new PayoffFactory__factory(owner).deploy()
  const payoffFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    payoffFactoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const payoffFactory = new PayoffFactory__factory(owner).attach(payoffFactoryProxy.address)

  const marketImpl = await new Market__factory(owner).deploy()

  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactory.address,
    payoffFactory.address,
    marketImpl.address,
  )

  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )

  const marketFactory = new MarketFactory__factory(owner).attach(factoryProxy.address)

  // Init
  await oracleFactory.connect(owner).initialize(dsu.address)
  await payoffFactory.connect(owner).initialize()
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
  await payoffFactory.connect(owner).register(payoff.address)
  await oracleFactory.connect(owner).register(chainlink.oracleFactory.address)
  await oracleFactory.connect(owner).authorize(marketFactory.address)
  const oracle = IOracle__factory.connect(
    await oracleFactory.connect(owner).callStatic.create(chainlink.id, chainlink.oracleFactory.address),
    owner,
  )
  await oracleFactory.connect(owner).create(chainlink.id, chainlink.oracleFactory.address)

  // Set state
  await fundWallet(dsu, usdc, user)
  await fundWallet(dsu, usdc, userB)
  await fundWallet(dsu, usdc, userC)
  await fundWallet(dsu, usdc, userD)
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await fundWalletUSDC(usdc, user)

  const rewardToken = await new ERC20PresetMinterPauser__factory(owner).deploy('Incentive Token', 'ITKN')

  return {
    owner,
    pauser,
    user,
    userB,
    userC,
    userD,
    beneficiaryB,
    proxyAdmin,
    oracleFactory,
    payoffFactory,
    marketFactory,
    chainlink,
    payoff,
    dsu,
    usdc,
    usdcHolder,
    oracle,
    marketImpl,
    rewardToken,
  }
}

export async function fundWallet(dsu: IERC20Metadata, usdc: IERC20Metadata, wallet: SignerWithAddress) {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const dsuMinter = await impersonate.impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await usdc.connect(usdcHolder).approve(RESERVE, BigNumber.from('2000000000000'))
  await usdcHolder.sendTransaction({
    to: RESERVE,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [utils.parseEther('2000000')]),
  })
  await dsu.connect(usdcHolder).transfer(wallet.address, utils.parseEther('2000000'))
}

export async function fundWalletUSDC(usdc: IERC20Metadata, wallet: SignerWithAddress) {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await usdc.connect(usdcHolder).transfer(wallet.address, BigNumber.from('1000000000'))
}

export async function createMarket(
  instanceVars: InstanceVars,
  name?: string,
  symbol?: string,
  oracleOverride?: IOracleProvider,
  payoff?: IPayoffProvider,
  riskParamOverrides?: Partial<RiskParameterStruct>,
  marketParamOverrides?: Partial<MarketParameterStruct>,
): Promise<Market> {
  const { owner, marketFactory, beneficiaryB, oracle, rewardToken, dsu } = instanceVars

  const definition = {
    name: name ?? 'Squeeth',
    symbol: symbol ?? 'SQTH',
    token: dsu.address,
    oracle: (oracleOverride ?? oracle).address,
    payoff: (payoff ?? instanceVars.payoff).address,
  }
  const riskParameter = {
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
    minMaintenance: parse6decimal('500'),
    virtualTaker: 0,
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
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
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
  await market.updateBeneficiary(beneficiaryB.address)
  await market.updateReward(rewardToken.address)
  await market.updateParameter(marketParameter)

  return market
}

export async function settle(market: IMarket, account: SignerWithAddress): Promise<ContractTransaction> {
  const local = await market.locals(account.address)
  const currentPosition = await market.pendingPositions(account.address, local.currentId)
  return market
    .connect(account)
    .update(account.address, currentPosition.maker, currentPosition.long, currentPosition.short, 0, false)
}

export async function createVault(
  instanceVars: InstanceVars,
  market: Market,
  leverage?: BigNumber,
  maxCollateral?: BigNumber,
): Promise<[IVault, VaultFactory]> {
  const [, , user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()

  const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(instanceVars.owner).deploy(
    instanceVars.marketFactory.address, // dummy contract
    instanceVars.proxyAdmin.address,
    [],
  )

  const vaultImpl = await new Vault__factory(instanceVars.owner).deploy()
  const vaultFactoryImpl = await new VaultFactory__factory(instanceVars.owner).deploy(
    instanceVars.marketFactory.address,
    vaultImpl.address,
  )

  await instanceVars.proxyAdmin.upgrade(vaultFactoryProxy.address, vaultFactoryImpl.address)
  const vaultFactory = IVaultFactory__factory.connect(vaultFactoryProxy.address, instanceVars.owner)
  await vaultFactory.initialize()

  const vault = IVault__factory.connect(
    await vaultFactory.callStatic.create(instanceVars.dsu.address, market.address, 'Blue Chip'),
    instanceVars.owner,
  )

  await vaultFactory.create(instanceVars.dsu.address, market.address, 'Blue Chip')

  //await vault.connect(instanceVars.owner).register(market.address)

  await vault.updateMarket(0, 4, leverage ? leverage : parse6decimal('4.0'))
  await vault.updateParameter({
    cap: maxCollateral ? maxCollateral : parse6decimal('500000'),
  })

  return [vault, vaultFactory]
}

export async function createInvoker(instanceVars: InstanceVars, vaultFactory?: VaultFactory): Promise<MultiInvoker> {
  const { owner, user, userB, chainlink } = instanceVars

  const multiInvoker = await new MultiInvoker__factory(owner).deploy(
    USDC,
    DSU,
    instanceVars.marketFactory.address,
    vaultFactory ? vaultFactory.address : ethers.utils.hexZeroPad('0x', 20), // todo factory?
    BATCHER,
    DSU_MINTER,
    parse6decimal('1.5'),
  )

  await instanceVars.marketFactory.connect(user).updateOperator(multiInvoker.address, true)
  await instanceVars.marketFactory.connect(userB).updateOperator(multiInvoker.address, true)
  if (vaultFactory) {
    await vaultFactory.connect(user).updateOperator(multiInvoker.address, true)
    await vaultFactory.connect(userB).updateOperator(multiInvoker.address, true)
  }
  await multiInvoker.initialize(ETH_ORACLE)

  return multiInvoker
}
