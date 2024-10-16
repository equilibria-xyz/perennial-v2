import { smock } from '@defi-wonderland/smock'
import { CallOverrides } from 'ethers'

import { OptGasInfo } from '../../types/generated'
import {
  createFactoriesForChain,
  deployControllerOptimism,
  fundWalletDSU,
  fundWalletUSDC,
  getStablecoins,
} from '../helpers/baseHelpers'
import { createMarketBTC, createMarketETH, DeploymentVars } from '../helpers/setupHelpers'
import { RunIncentivizedTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory } from '../../types/generated'
import { RunAccountTests } from './Account.test'

async function deployProtocol(owner: SignerWithAddress, overrides?: CallOverrides): Promise<DeploymentVars> {
  const [oracleFactory, marketFactory, pythOracleFactory] = await createFactoriesForChain(owner)
  const [dsu, usdc] = await getStablecoins(owner)
  const [ethMarket, , ethKeeperOracle] = await createMarketETH(
    owner,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    dsu,
  )
  const [btcMarket, , btcKeeperOracle] = await createMarketBTC(
    owner,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    dsu,
    overrides,
  )
  return {
    dsu,
    usdc,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    ethMarket,
    btcMarket,
    ethKeeperOracle,
    btcKeeperOracle,
    fundWalletDSU,
    fundWalletUSDC,
  }
}

async function deployInstance(
  owner: SignerWithAddress,
  marketFactory: IMarketFactory,
  overrides?: CallOverrides,
): Promise<Controller_Incentivized> {
  return deployControllerOptimism(owner, marketFactory, overrides)
}

async function mockGasInfo() {
  const gasInfo = await smock.fake<OptGasInfo>('OptGasInfo', {
    address: '0x420000000000000000000000000000000000000F',
  })
  gasInfo.getL1GasUsed.returns(0)
  gasInfo.getL1GasUsed.returns(0)
  gasInfo.l1BaseFee.returns(0)
  gasInfo.baseFeeScalar.returns(684000)
  gasInfo.decimals.returns(6)
}

if (process.env.FORK_NETWORK === 'base') {
  RunAccountTests(deployProtocol, deployInstance)
  RunIncentivizedTests('Controller_Optimism', deployProtocol, deployInstance, mockGasInfo)
}
