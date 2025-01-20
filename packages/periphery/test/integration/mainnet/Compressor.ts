import { expect } from 'chai'

import {
  IVault,
  IVaultFactory,
  Market,
  MultiInvoker,
  IOracleProvider,
  VaultFactory,
  Compressor,
  KeeperOracle,
  PythFactory,
  Manager,
  Controller,
  Controller_Incentivized,
  Manager__factory,
  Manager_Optimism__factory,
  OrderVerifier__factory,
  MarketFactory,
  IERC20Metadata,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { InstanceVars, createVault } from './MultiInvoker/setupHelpers'
import { BigNumber, utils } from 'ethers'

import { OracleReceipt } from '../../../../common/testutil/types'
import { use } from 'chai'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { createMarket } from '../../helpers/marketHelpers'
import { OracleVersionStruct } from '@perennial/v2-oracle/types/generated/contracts/Oracle'
import { deployController } from '../l2/CollateralAccounts/Optimism.test'
import { CHAINLINK_ETH_USD_FEED, createFactoriesForChain, PYTH_ADDRESS } from '../../helpers/baseHelpers'
import { deployPythOracleFactory } from '../../helpers/setupHelpers'
import { Address } from 'hardhat-deploy/dist/types'

use(smock.matchers)

const LEGACY_ORACLE_DELAY = 3600
export function RunCompressorTests(
  getFixture: () => Promise<InstanceVars>,
  createCompressor: (
    instanceVars: InstanceVars,
    multiInvoker: MultiInvoker,
    pythOracleFactory: PythFactory,
    controller: Controller_Incentivized,
    manager: Manager,
  ) => Promise<Compressor>,
  createInvoker: (
    instanceVars: InstanceVars,
    vaultFactory?: VaultFactory,
    withBatcher?: boolean,
  ) => Promise<MultiInvoker>,
  getManager: (dsu: IERC20Metadata, marketFactory: MarketFactory) => Promise<Manager>,
  fundWalletDSU: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  fundWalletUSDC: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  advanceToPrice: () => Promise<void>,
  initialOracleVersionEth: OracleVersionStruct,
  initialOracleVersionBtc: OracleVersionStruct,
): void {
  describe('placeOrderBundle', () => {
    let instanceVars: InstanceVars
    let multiInvoker: MultiInvoker
    let market: Market
    let vaultFactory: IVaultFactory
    let vault: IVault
    let ethSubOracle: FakeContract<IOracleProvider>
    let btcSubOracle: FakeContract<IOracleProvider>
    let compressor: Compressor
    let pythOracleFactory: PythFactory
    let controller: Controller_Incentivized
    let manager: Manager
    let referrer: SignerWithAddress
    let nextOrderId = BigNumber.from(0)

    const fixture = async () => {
      instanceVars = await getFixture()
      referrer = instanceVars.referrer
      ;[vault, vaultFactory, ethSubOracle, btcSubOracle] = await createVault(
        instanceVars,
        initialOracleVersionEth,
        initialOracleVersionBtc,
      )
      multiInvoker = await createInvoker(instanceVars, vaultFactory, true)
      market = await createMarket(instanceVars.owner, instanceVars.marketFactory, instanceVars.dsu, instanceVars.oracle)
      await instanceVars.oracle.register(market.address)
      pythOracleFactory = await deployPythOracleFactory(
        instanceVars.owner,
        instanceVars.oracleFactory,
        PYTH_ADDRESS,
        CHAINLINK_ETH_USD_FEED,
      )
      manager = await getManager(instanceVars.dsu, instanceVars.marketFactory)
      ;[controller] = await deployController(
        instanceVars.owner,
        instanceVars.marketFactory,
        instanceVars.chainlinkKeptFeed,
      )
      compressor = await createCompressor(instanceVars, multiInvoker, pythOracleFactory, controller, manager)
    }

    function advanceOrderId(): BigNumber {
      return (nextOrderId = nextOrderId.add(BigNumber.from(1)))
    }

    // create a default action for the specified user with reasonable fee and expiry
    const createCAAction = async (
      userAddress: Address,
      nonce: BigNumber,
      group: BigNumber,
      expiresInSeconds: BigNumber,
      signerAddress = userAddress,
      maxFee = utils.parseEther('0.3'),
    ) => {
      return {
        action: {
          maxFee: maxFee,
          common: {
            account: userAddress,
            signer: signerAddress,
            domain: controller.address,
            nonce: nonce,
            group: group,
            expiry: expiresInSeconds,
          },
        },
      }
    }

    const createTOAction = async (
      marketAddress: Address,
      nonce: BigNumber,
      group: BigNumber,
      userAddress: Address,
      expiresInSeconds: BigNumber,
      signerAddress = userAddress,
      maxFee = utils.parseEther('0.3'),
    ) => {
      return {
        action: {
          market: marketAddress,
          orderId: nextOrderId,
          maxFee: maxFee,
          common: {
            account: userAddress,
            signer: signerAddress,
            domain: manager.address,
            nonce: nonce,
            group: group,
            expiry: expiresInSeconds,
          },
        },
      }
    }

    const createTakeOrder = async (
      marketAddress: Address,
      nonce: BigNumber,
      group: BigNumber,
      userAddress: Address,
      expiresInSeconds: BigNumber,
      amount: BigNumber,
      signerAddress = userAddress,
    ) => {
      return {
        amount: amount,
        referrer: referrer.address,
        common: {
          account: userAddress,
          signer: signerAddress,
          domain: marketAddress,
          nonce: nonce,
          group: group,
          expiry: expiresInSeconds,
        },
      }
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })
  })
}
