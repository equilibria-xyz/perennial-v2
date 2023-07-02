import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { utils } from 'ethers'

import { time, impersonate } from '../../../../common/testutil'
import {
  IERC20Metadata,
  Market,
  IERC20Metadata__factory,
  MarketFactory__factory,
  Market__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
  MarketFactory,
  IOracleProvider,
  IMarket,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { buildChainlinkRoundId } from '@equilibria/perennial-v2-oracle/util/buildChainlinkRoundId'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import {
  PayoffFactory,
  PayoffFactory__factory,
  PowerTwo__factory,
} from '@equilibria/perennial-v2-payoff/types/generated'
import {
  IOracle__factory,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
const { config, deployments, ethers } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const INITIAL_VERSION = 2472 // registry's phase 1 starts at aggregatorRoundID 7528
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

export interface InstanceVars {
  owner: SignerWithAddress
  pauser: SignerWithAddress
  user: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  treasuryA: SignerWithAddress
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

export async function deployProtocol(): Promise<InstanceVars> {
  await time.reset(config)
  const [owner, pauser, user, userB, userC, userD, treasuryA, beneficiaryB] = await ethers.getSigners()

  const payoff = await IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)
  const dsu = await IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = await IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)

  // Deploy external deps
  const initialRoundId = buildChainlinkRoundId(INITIAL_PHASE_ID, INITIAL_AGGREGATOR_ROUND_ID)
  const chainlink = await new ChainlinkContext(
    CHAINLINK_CUSTOM_CURRENCIES.ETH,
    CHAINLINK_CUSTOM_CURRENCIES.USD,
    initialRoundId,
    1,
  ).init()

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const oracleImpl = await new Oracle__factory(owner).deploy()

  const oracleFactoryImpl = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
  const oracleFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    oracleFactoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const oracleFactory = await new OracleFactory__factory(owner).attach(oracleFactoryProxy.address)

  const payoffFactoryImpl = await new PayoffFactory__factory(owner).deploy()
  const payoffFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    payoffFactoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const payoffFactory = await new PayoffFactory__factory(owner).attach(payoffFactoryProxy.address)

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

  const marketFactory = await new MarketFactory__factory(owner).attach(factoryProxy.address)

  // Init
  await oracleFactory.connect(owner).initialize(dsu.address)
  await payoffFactory.connect(owner).initialize()
  await marketFactory.connect(owner).initialize()

  // Params
  await marketFactory.updatePauser(pauser.address)
  await marketFactory.updateTreasury(treasuryA.address)
  await marketFactory.updateParameter({
    protocolFee: parse6decimal('0.50'),
    liquidationFee: parse6decimal('0.50'),
    maxLiquidationFee: parse6decimal('1000'),
    minCollateral: parse6decimal('500'),
    settlementFee: parse6decimal('0.00'),
    maxPendingIds: 8,
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
  await fundWallet(dsu, user)
  await fundWallet(dsu, userB)
  await fundWallet(dsu, userC)
  await fundWallet(dsu, userD)
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))

  const rewardToken = await new ERC20PresetMinterPauser__factory(owner).deploy('Incentive Token', 'ITKN')

  return {
    owner,
    pauser,
    user,
    userB,
    userC,
    userD,
    treasuryA,
    beneficiaryB,
    chainlink,
    payoff,
    dsu,
    usdc,
    usdcHolder,
    proxyAdmin,
    oracleFactory,
    payoffFactory,
    marketFactory,
    oracle,
    marketImpl,
    rewardToken,
  }
}

export async function fundWallet(dsu: IERC20Metadata, wallet: SignerWithAddress) {
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
  name?: string,
  symbol?: string,
  oracleOverride?: IOracleProvider,
  payoff?: IPayoffProvider,
): Promise<Market> {
  const { owner, marketFactory, beneficiaryB, oracle, rewardToken, dsu } = instanceVars

  const definition = {
    name: name ?? 'Squeeth',
    symbol: symbol ?? 'SQTH',
    token: dsu.address,
    reward: rewardToken.address,
    oracle: (oracleOverride ?? oracle).address,
    payoff: (payoff ?? instanceVars.payoff).address,
  }
  const riskParameter = {
    maintenance: parse6decimal('0.3'),
    takerFee: 0,
    takerSkewFee: 0,
    takerImpactFee: 0,
    makerFee: 0,
    makerSkewFee: 0,
    makerImpactFee: 0,
    makerLiquidity: parse6decimal('0.2'),
    makerLimit: parse6decimal('1000'),
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
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
    makerReceiveOnly: false,
  }
  const marketParameter = {
    fundingFee: parse6decimal('0.1'),
    interestFee: parse6decimal('0.1'),
    oracleFee: 0,
    riskFee: 0,
    positionFee: 0,
    closed: false,
  }
  const marketAddress = await marketFactory.callStatic.create(definition, riskParameter)
  await marketFactory.create(definition, riskParameter)

  const market = Market__factory.connect(marketAddress, owner)
  await market.updateParameter(marketParameter)
  await market.updateBeneficiary(beneficiaryB.address)

  return market
}

export async function settle(market: IMarket, account: SignerWithAddress) {
  const local = await market.locals(account.address)
  const currentPosition = await market.pendingPositions(account.address, local.currentId)
  await market
    .connect(account)
    .update(account.address, currentPosition.maker, currentPosition.long, currentPosition.short, 0, false)
}
