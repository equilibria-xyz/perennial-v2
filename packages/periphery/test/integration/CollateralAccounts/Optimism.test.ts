import { smock } from '@defi-wonderland/smock'
import { CallOverrides, constants } from 'ethers'
import HRE from 'hardhat'

import {
  AccountVerifier__factory,
  AggregatorV3Interface,
  IAccountVerifier,
  IMargin,
  IMarket__factory,
  OptGasInfo,
} from '../../../types/generated'
import {
  createFactoriesForChain,
  deployControllerOptimism,
  fundWalletDSU,
  fundWalletUSDC,
  getDSUReserve,
  getStablecoins,
} from '../../helpers/baseHelpers'
import { createMarketBTC as setupMarketBTC, createMarketETH as setupMarketETH } from '../../helpers/setupHelpers'
import { RunIncentivizedTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory } from '../../../types/generated'
import { RunAccountTests } from './Account.test'
import { RunControllerBaseTests } from './Controller.test'
import { DeploymentVars } from './setupTypes'
import { IMargin__factory, IMarket } from '@perennial/v2-oracle/types/generated'

const { ethers } = HRE

async function deployProtocol(
  owner: SignerWithAddress,
  createMarketETH = false,
  createMarketBTC = false,
  overrides?: CallOverrides,
): Promise<DeploymentVars> {
  const [oracleFactory, marketFactory, pythOracleFactory, chainlinkKeptFeed] = await createFactoriesForChain(owner)
  const [dsu, usdc] = await getStablecoins(owner)
  const marketImpl: IMarket = IMarket__factory.connect(await marketFactory.implementation(), owner)
  const margin: IMargin = IMargin__factory.connect(await marketImpl.margin(), owner)

  const deployment: DeploymentVars = {
    dsu,
    usdc,
    oracleFactory,
    pythOracleFactory,
    margin,
    marketFactory,
    ethMarket: createMarketETH
      ? await setupMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, overrides)
      : undefined,
    btcMarket: createMarketBTC
      ? await setupMarketBTC(owner, oracleFactory, pythOracleFactory, marketFactory, overrides)
      : undefined,
    chainlinkKeptFeed,
    dsuReserve: getDSUReserve(owner),
    fundWalletDSU,
    fundWalletUSDC,
  }

  return deployment
}

async function deployController(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  chainlinkKeptFeed: AggregatorV3Interface,
  overrides?: CallOverrides,
): Promise<[Controller_Incentivized, IAccountVerifier]> {
  const controller = await deployControllerOptimism(owner, marketFactory, overrides ?? {})

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 350_000, // buffer for handling the keeper fee
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 1_375_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 500,
  }
  const keepConfigWithdrawal = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 750_000,
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 2000,
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
  gasInfo.getL1GasUsed.returns(440)
  gasInfo.l1BaseFee.returns(2640000000)
  gasInfo.baseFeeScalar.returns(5214379)
  gasInfo.decimals.returns(6)
}

if (process.env.FORK_NETWORK === 'base') {
  RunAccountTests(deployProtocol, deployController)
  RunControllerBaseTests(deployProtocol)
  RunIncentivizedTests('Controller_Optimism', deployProtocol, deployController, mockGasInfo)
}
