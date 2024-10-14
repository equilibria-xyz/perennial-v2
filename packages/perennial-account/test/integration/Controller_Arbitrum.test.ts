import { smock } from '@defi-wonderland/smock'
import { use } from 'chai'
import { CallOverrides, Signer } from 'ethers'

import { ArbGasInfo } from '../../../types/generated'
import {
  createMarketBTC,
  createMarketETH,
  createFactories,
  deployControllerArbitrum,
  fundWalletDSU,
  fundWalletUSDC,
  getStablecoins,
} from '../helpers/arbitrumHelpers'
import { DeploymentVars, RunCollateralAccountTests } from './Controller_Incentivized.test'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Controller_Incentivized, IMarketFactory, IVerifier } from '../../types/generated'

use(smock.matchers)

async function deployProtocol(owner: SignerWithAddress, overrides?: CallOverrides): Promise<DeploymentVars> {
  const [oracleFactory, marketFactory, pythOracleFactory] = await createFactories(owner)
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
  relayVerifier: IVerifier,
  overrides?: CallOverrides,
): Promise<Controller_Incentivized> {
  return deployControllerArbitrum(owner, marketFactory, relayVerifier, overrides)
}

async function mockGasInfo() {
  // Hardhat fork does not support Arbitrum built-ins; Kept produces "invalid opcode" error without this
  const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
    address: '0x000000000000000000000000000000000000006C',
  })
  gasInfo.getL1BaseFeeEstimate.returns(0)
}

RunCollateralAccountTests('Controller_Arbitrum', deployProtocol, deployInstance, mockGasInfo)
