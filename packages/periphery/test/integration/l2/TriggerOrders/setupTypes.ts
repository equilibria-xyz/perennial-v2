import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  IController,
  IEmptySetReserve,
  IERC20Metadata,
  IKeeperOracle,
  IManager,
  IMarket,
  IMarketFactory,
  IOracleProvider,
  IOrderVerifier,
} from '../../../../types/generated'

export interface FixtureVars {
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  reserve: IEmptySetReserve
  keeperOracle: IKeeperOracle
  manager: IManager
  marketFactory: IMarketFactory
  market: IMarket
  oracle: IOracleProvider
  verifier: IOrderVerifier
  controller: IController
  owner: SignerWithAddress
  userA: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  keeper: SignerWithAddress
  oracleFeeReceiver: SignerWithAddress
}
