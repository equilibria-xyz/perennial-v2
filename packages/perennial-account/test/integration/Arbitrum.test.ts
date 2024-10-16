import { smock } from '@defi-wonderland/smock'
import { use } from 'chai'
import { CallOverrides } from 'ethers'

import { ArbGasInfo } from '../../types/generated'
import {
  createFactoriesForChain,
  deployControllerArbitrum,
  fundWalletDSU,
  fundWalletUSDC,
  getStablecoins,
} from '../helpers/arbitrumHelpers'
import { createMarketBTC, createMarketETH, DeploymentVars } from '../helpers/setupHelpers'
import { RunIncentivizedTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory } from '../../types/generated'
import { RunAccountTests } from './Account.test'

use(smock.matchers)

// TODO: Seems inelegant using this same implementation to call methods from a chain-specific helper library.
// But the helpers are destined to move to a common folder shareable across extensions.
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
  return deployControllerArbitrum(owner, marketFactory, overrides)
}

async function mockGasInfo() {
  // Hardhat fork does not support Arbitrum built-ins; Kept produces "invalid opcode" error without this
  const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
    address: '0x000000000000000000000000000000000000006C',
  })
  gasInfo.getL1BaseFeeEstimate.returns(0)
}

if (process.env.FORK_NETWORK === 'arbitrum') {
  RunAccountTests(deployProtocol, deployInstance)
  RunIncentivizedTests('Controller_Arbitrum', deployProtocol, deployInstance, mockGasInfo)
}
