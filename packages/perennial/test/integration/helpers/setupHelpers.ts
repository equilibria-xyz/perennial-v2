import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { utils } from 'ethers'

import { time, impersonate } from '../../../../common/testutil'
import {
  IERC20Metadata,
  Market,
  IERC20Metadata__factory,
  Factory__factory,
  Market__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
  Factory,
  IOracleProvider,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { buildChainlinkRoundId } from '@equilibria/perennial-v2-oracle/util/buildChainlinkRoundId'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@equilibria/perennial-v2-oracle/util/constants'
import { Squared__factory } from '@equilibria/perennial-v2-payoff/types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
const { config, deployments, ethers } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const INITIAL_VERSION = 2472 // registry's phase 1 starts at aggregatorRoundID 7528

export const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'
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
  treasuryB: SignerWithAddress
  proxyAdmin: ProxyAdmin
  factory: Factory
  payoff: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
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
    1,
  ).init()

  const payoff = await IPayoffProvider__factory.connect((await new Squared__factory(owner).deploy()).address, owner)
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
    liquidationFee: parse6decimal('0.50'),
    minCollateral: parse6decimal('500'),
    maxPendingIds: 8,
    paused: false,
  })

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
    treasuryB,
    chainlink,
    payoff,
    dsu,
    usdc,
    usdcHolder,
    proxyAdmin,
    factory,
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
  oracle?: IOracleProvider,
  payoff?: IPayoffProvider,
): Promise<Market> {
  const { owner, factory, treasuryB, chainlink, rewardToken, dsu } = instanceVars

  const definition = {
    name: name ?? 'Squeeth',
    symbol: symbol ?? 'SQTH',
    token: dsu.address,
    reward: rewardToken.address,
  }
  const parameter = {
    maintenance: parse6decimal('0.3'),
    fundingFee: parse6decimal('0.1'),
    interestFee: parse6decimal('0.1'),
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
    pController: {
      value: 0,
      _k: parse6decimal('40000'),
      _skew: 0,
      _max: parse6decimal('1.20'),
    },
    makerRewardRate: 0,
    longRewardRate: 0,
    shortRewardRate: 0,
    oracle: (oracle ?? chainlink.oracle).address,
    payoff: (payoff ?? instanceVars.payoff).address,
  }
  const marketAddress = await factory.callStatic.createMarket(definition, parameter)
  await factory.createMarket(definition, parameter)

  const market = Market__factory.connect(marketAddress, owner)
  await market.acceptOwner()
  await market.updateTreasury(treasuryB.address)

  return market
}
