import { smock } from '@defi-wonderland/smock'
import { use } from 'chai'
import { CallOverrides } from 'ethers'
import HRE from 'hardhat'

import { AccountVerifier__factory, ArbGasInfo, IAccountVerifier } from '../../../../types/generated'
import {
  createFactoriesForChain,
  deployControllerArbitrum,
  fundWalletDSU,
  fundWalletUSDC,
  getDSUReserve,
  getStablecoins,
} from '../../../helpers/arbitrumHelpers'
import { createMarketBTC as setupMarketBTC, createMarketETH as setupMarketETH } from '../../../helpers/setupHelpers'
import { RunIncentivizedTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory } from '../../../../types/generated'
import { RunAccountTests } from './Account.test'
import { AggregatorV3Interface } from '@perennial/v2-oracle/types/generated'
import { RunControllerBaseTests } from './Controller.test'
import { DeploymentVars } from './setupTypes'

const { ethers } = HRE

use(smock.matchers)

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
    ethMarket: createMarketETH
      ? await setupMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu, overrides)
      : undefined,
    btcMarket: createMarketBTC
      ? await setupMarketBTC(owner, oracleFactory, pythOracleFactory, marketFactory, dsu, overrides)
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
  const controller = await deployControllerArbitrum(owner, marketFactory, overrides ?? {})

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 385_000, // buffer for handling the keeper fee
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1.08'),
    bufferBase: 2_000_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1.08'),
    bufferCalldata: 35_200,
  }
  const keepConfigWithdrawal = {
    multiplierBase: ethers.utils.parseEther('1.05'),
    bufferBase: 2_000_000,
    multiplierCalldata: ethers.utils.parseEther('1.05'),
    bufferCalldata: 35_200,
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
  // Hardhat fork does not support Arbitrum built-ins; Kept produces "invalid opcode" error without this
  const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
    address: '0x000000000000000000000000000000000000006C',
  })
  gasInfo.getL1BaseFeeEstimate.returns(1)
}

if (process.env.FORK_NETWORK === 'arbitrum') {
  RunAccountTests(deployProtocol, deployController)
  RunControllerBaseTests(deployProtocol)
  RunIncentivizedTests('Controller_Arbitrum', deployProtocol, deployController, mockGasInfo)
}
