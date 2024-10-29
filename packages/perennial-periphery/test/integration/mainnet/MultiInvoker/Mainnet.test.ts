import { ethers } from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { parse6decimal } from '../../../../../common/testutil/types'

import { IERC20Metadata__factory } from '../../../../types/generated'
import { OracleVersionStruct } from '@perennial/oracle/types/generated/contracts/Oracle'

import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_BATCHER,
  DSU_RESERVE,
  fundWalletDSU,
  fundWalletUSDC,
  USDC_ADDRESS,
} from '../../../helpers/mainnetHelpers'

const ORACLE_STARTING_TIMESTAMP = BigNumber.from(1646456563)

const INITIAL_ORACLE_VERSION_ETH: OracleVersionStruct = {
  timestamp: ORACLE_STARTING_TIMESTAMP,
  price: BigNumber.from('2620237388'),
  valid: true,
}

const INITIAL_ORACLE_VERSION_BTC = {
  timestamp: ORACLE_STARTING_TIMESTAMP,
  price: BigNumber.from('38838362695'),
  valid: true,
}

const fixture = async (): Promise<InstanceVars> => {
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  const vars = await deployProtocol(dsu, usdc, DSU_BATCHER, DSU_RESERVE, CHAINLINK_ETH_USD_FEED)

  await fundWalletDSU(dsu, usdc, user)
  await fundWalletDSU(dsu, usdc, userB)
  await fundWalletDSU(dsu, usdc, userC)
  await fundWalletDSU(dsu, usdc, userD)
  await fundWalletUSDC(usdc, user)
  await fundWalletDSU(dsu, usdc, liquidator)
  await fundWalletDSU(dsu, usdc, perennialUser, parse6decimal('14000000'))

  return vars
}

async function getFixture(): Promise<InstanceVars> {
  return loadFixture(fixture)
}

if (process.env.FORK_NETWORK === undefined) {
  RunInvokerTests(
    getFixture,
    createInvoker,
    fundWalletDSU,
    fundWalletUSDC,
    INITIAL_ORACLE_VERSION_ETH,
    INITIAL_ORACLE_VERSION_BTC,
  )
  RunOrderTests(getFixture, createInvoker)
  RunPythOracleTests(getFixture, createInvoker)
}
