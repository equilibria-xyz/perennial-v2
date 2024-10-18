import { BigNumber, CallOverrides } from 'ethers'
import { IKeeperOracle } from '@equilibria/perennial-v2-oracle/types/generated'
import {
  IEmptySetReserve,
  IERC20Metadata,
  IMarket,
  IMarketFactory,
  IOracleProvider,
  IOrderVerifier,
  Manager_Arbitrum,
} from '../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export interface FixtureVars {
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  reserve: IEmptySetReserve
  keeperOracle: IKeeperOracle
  manager: Manager_Arbitrum
  marketFactory: IMarketFactory
  market: IMarket
  oracle: IOracleProvider
  verifier: IOrderVerifier
  owner: SignerWithAddress
  userA: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  keeper: SignerWithAddress
  oracleFeeReceiver: SignerWithAddress
}
