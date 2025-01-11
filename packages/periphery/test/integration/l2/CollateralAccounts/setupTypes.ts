import { BigNumber, CallOverrides } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  AggregatorV3Interface,
  IEmptySetReserve,
  IERC20Metadata,
  IMarketFactory,
  IOracleFactory,
  PythFactory,
} from '../../../../types/generated'
import { MarketWithOracle } from '../../../helpers/setupHelpers'

export interface DeploymentVars {
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  oracleFactory: IOracleFactory
  pythOracleFactory: PythFactory
  marketFactory: IMarketFactory
  ethMarket: MarketWithOracle | undefined
  btcMarket: MarketWithOracle | undefined
  chainlinkKeptFeed: AggregatorV3Interface
  dsuReserve: IEmptySetReserve
  fundWalletDSU(wallet: SignerWithAddress, amount: BigNumber, overrides?: CallOverrides): Promise<undefined>
  fundWalletUSDC(wallet: SignerWithAddress, amount: BigNumber, overrides?: CallOverrides): Promise<undefined>
}
