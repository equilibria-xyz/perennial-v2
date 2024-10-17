import HRE from 'hardhat'
import { smock } from '@defi-wonderland/smock'
import { CallOverrides } from 'ethers'

import { AccountVerifier__factory, AggregatorV3Interface, IAccountVerifier, OptGasInfo } from '../../types/generated'
import {
  createFactoriesForChain,
  deployControllerOptimism,
  fundWalletDSU,
  fundWalletUSDC,
  getDSUReserve,
  getStablecoins,
} from '../helpers/baseHelpers'
import {
  createMarketBTC as setupMarketBTC,
  createMarketETH as setupMarketETH,
  DeploymentVars,
} from '../helpers/setupHelpers'
import { RunIncentivizedTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory } from '../../types/generated'
import { RunAccountTests } from './Account.test'
import { RunControllerBaseTests } from './Controller.test'

const { ethers } = HRE

async function deployProtocol(
  owner: SignerWithAddress,
  createMarketETH = false,
  createMarketBTC = false,
  overrides?: CallOverrides,
): Promise<DeploymentVars> {
  const [oracleFactory, marketFactory, pythOracleFactory, chainlinkKeptFeed] = await createFactoriesForChain(owner)
  const [dsu, usdc] = await getStablecoins(owner)

  const deployment: DeploymentVars = {
    dsu,
    usdc,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    ethMarket: undefined, // TODO: style: inlining these was difficult to read; set below
    btcMarket: undefined,
    chainlinkKeptFeed,
    dsuReserve: getDSUReserve(owner),
    fundWalletDSU,
    fundWalletUSDC,
  }

  if (createMarketETH) {
    deployment.ethMarket = await setupMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)
  }

  if (createMarketBTC) {
    deployment.btcMarket = await setupMarketBTC(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)
  }

  return deployment
}

async function deployInstance(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  chainlinkKeptFeed: AggregatorV3Interface,
  overrides?: CallOverrides,
): Promise<[Controller_Incentivized, IAccountVerifier]> {
  // FIXME: erroring with "trying to deploy a contract whose code is too large" when I pass empty overrides
  const controller = await deployControllerOptimism(owner, marketFactory /*, overrides ?? {}*/)

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 0, // buffer for handling the keeper fee
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 2_000_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  const keepConfigWithdrawal = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 1_500_000,
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }

  const accountVerifier = await new AccountVerifier__factory(owner).deploy(marketFactory.address, {
    maxFeePerGas: 100000000,
  })
  // chainlink feed is used by Kept for keeper compensation
  const KeepConfig = '(uint256,uint256,uint256,uint256)'
  await controller[`initialize(address,address,${KeepConfig},${KeepConfig},${KeepConfig})`](
    accountVerifier.address,
    chainlinkKeptFeed.address,
    keepConfig,
    keepConfigBuffered,
    keepConfigWithdrawal,
  )

  return [controller, accountVerifier]
}

async function mockGasInfo() {
  const gasInfo = await smock.fake<OptGasInfo>('OptGasInfo', {
    address: '0x420000000000000000000000000000000000000F',
  })
  gasInfo.getL1GasUsed.returns(2000)
  gasInfo.l1BaseFee.returns(3000000000)
  gasInfo.baseFeeScalar.returns(5214379)
  gasInfo.decimals.returns(6)
}

if (process.env.FORK_NETWORK === 'base') {
  // TODO: Would it be faster to deploy the protocol once with both markets, and let each test suite take their own snapshots?
  RunAccountTests(deployProtocol, deployInstance)
  RunControllerBaseTests(deployProtocol)
  RunIncentivizedTests('Controller_Optimism', deployProtocol, deployInstance, mockGasInfo)
}
