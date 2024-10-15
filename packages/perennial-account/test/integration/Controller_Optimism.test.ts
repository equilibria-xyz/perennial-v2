import { smock } from '@defi-wonderland/smock'
import { use } from 'chai'
import { CallOverrides } from 'ethers'
import HRE from 'hardhat'

import { ArbGasInfo, OptGasInfo } from '../../types/generated'
import {
  createFactoriesForChain,
  deployControllerOptimism,
  fundWalletDSU,
  fundWalletUSDC,
  getStablecoins,
} from '../helpers/baseHelpers'
import { createMarketBTC, createMarketETH } from '../helpers/setupHelpers'
import { DeploymentVars, RunIncentivizedTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory, IVerifier } from '../../types/generated'

async function deployProtocol(owner: SignerWithAddress, overrides?: CallOverrides): Promise<DeploymentVars> {
  console.log('createFactoriesForChain')
  const [oracleFactory, marketFactory, pythOracleFactory] = await createFactoriesForChain(owner)
  console.log('getStablecoins')
  const [dsu, usdc] = await getStablecoins(owner)
  console.log('createMarketETH')
  const [ethMarket, , ethKeeperOracle] = await createMarketETH(
    owner,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    dsu,
  )
  console.log('createMarketBTC')
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
  relayVerifier: IVerifier,
  overrides?: CallOverrides,
): Promise<Controller_Incentivized> {
  return deployControllerOptimism(owner, marketFactory, relayVerifier, overrides)
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

if (process.env.FORK_NETWORK === 'base')
  RunIncentivizedTests('Controller_Optimism', deployProtocol, deployInstance, mockGasInfo)
