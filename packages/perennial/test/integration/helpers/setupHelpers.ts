import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { utils } from 'ethers'

import { time, impersonate } from '../../../../common/testutil'
import {
  Factory,
  IERC20Metadata,
  ChainlinkOracle,
  Market,
  IERC20Metadata__factory,
  Factory__factory,
  ChainlinkOracle__factory,
  Market__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { buildChainlinkRoundId } from '@equilibria/perennial-v2-oracle/util/buildChainlinkRoundId'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { PayoffStruct } from '../../../types/generated/contracts/Factory'
import { Squared__factory } from '@equilibria/perennial-v2-payoff/types/generated'
const { config, deployments, ethers } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const INITIAL_VERSION = 2472 // registry's phase 1 starts at aggregatorRoundID 7528
export const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

export interface InstanceVars {
  owner: SignerWithAddress
  pauser: SignerWithAddress
  user: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  treasuryA: SignerWithAddress
  treasuryB: SignerWithAddress
  proxyAdmin: ProxyAdmin
  factory: Factory
  payoffProvider: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  dsuHolder: SignerWithAddress
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  chainlinkOracle: ChainlinkOracle
  marketImpl: Market
  rewardToken: ERC20PresetMinterPauser
}

export async function deployProtocol(): Promise<InstanceVars> {
  await time.reset(config)
  const [owner, pauser, user, userB, userC, userD, treasuryA, treasuryB] = await ethers.getSigners()

  // Deploy external deps
  const initialRoundId = buildChainlinkRoundId(INITIAL_PHASE_ID, INITIAL_AGGREGATOR_ROUND_ID)
  const chainlink = await new ChainlinkContext(
    CHAINLINK_CUSTOM_CURRENCIES.ETH,
    CHAINLINK_CUSTOM_CURRENCIES.USD,
    initialRoundId,
  ).init()
  const chainlinkOracle = await new ChainlinkOracle__factory(owner).deploy(
    chainlink.feedRegistry.address,
    CHAINLINK_CUSTOM_CURRENCIES.ETH,
    CHAINLINK_CUSTOM_CURRENCIES.USD,
    1,
  )
  const payoffProvider = await IPayoffProvider__factory.connect(
    (
      await new Squared__factory(owner).deploy()
    ).address,
    owner,
  )
  const dsu = await IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = await IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const marketImpl = await new Market__factory(owner).deploy()

  const factoryImpl = await new Factory__factory(owner).deploy(marketImpl.address)

  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )

  const factory = await new Factory__factory(owner).attach(factoryProxy.address)

  // Init
  await factory.initialize()

  // Params
  await factory.updatePauser(pauser.address)
  await factory.updateTreasury(treasuryA.address)
  await factory.updateParameter({
    protocolFee: parse6decimal('0.50'),
    minFundingFee: parse6decimal('0.10'),
    liquidationFee: parse6decimal('0.50'),
    minCollateral: parse6decimal('500'),
    minSpread: parse6decimal('0.20'),
    maxPendingIds: 8,
    paused: false,
  })

  // Set state
  const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
  await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userB.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userC.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userD.address, utils.parseEther('20000'))
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await chainlinkOracle.sync()

  const rewardToken = await new ERC20PresetMinterPauser__factory(owner).deploy('Incentive Token', 'ITKN')

  return {
    owner,
    pauser,
    user,
    userB,
    userC,
    userD,
    treasuryA,
    treasuryB,
    dsuHolder,
    chainlink,
    chainlinkOracle,
    payoffProvider,
    dsu,
    usdc,
    usdcHolder,
    proxyAdmin,
    factory,
    marketImpl,
    rewardToken,
  }
}

export async function createMarket(
  instanceVars: InstanceVars,
  name?: string,
  symbol?: string,
  oracle?: ChainlinkOracle,
  payoff?: PayoffStruct,
): Promise<Market> {
  const { owner, factory, treasuryB, chainlinkOracle, rewardToken, dsu } = instanceVars
  if (!payoff) {
    payoff = {
      provider: instanceVars.payoffProvider.address,
      short: false,
    }
  }
  if (!oracle) {
    oracle = chainlinkOracle
  }
  if (!name) {
    name = 'Squeeth'
  }
  if (!symbol) {
    symbol = 'SQTH'
  }

  const definition = {
    name,
    symbol,
    token: dsu.address,
    reward: rewardToken.address,
  }
  const parameter = {
    maintenance: parse6decimal('0.3'),
    fundingFee: parse6decimal('0.1'),
    takerFee: 0,
    makerFee: 0,
    positionFee: 0,
    makerLiquidity: parse6decimal('0.2'),
    makerLimit: parse6decimal('1000'),
    closed: false,
    utilizationCurve: {
      minRate: 0,
      maxRate: parse6decimal('5.00'),
      targetRate: parse6decimal('0.80'),
      targetUtilization: parse6decimal('0.80'),
    },
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
    oracle: oracle.address,
    payoff: payoff,
  }
  const marketAddress = await factory.callStatic.createMarket(definition, parameter)
  await factory.createMarket(definition, parameter)

  const market = Market__factory.connect(marketAddress, owner)
  await market.acceptOwner()
  await market.updateTreasury(treasuryB.address)

  return market
}
