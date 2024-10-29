import { ethers } from 'hardhat'
import { constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { IERC20Metadata__factory } from '../../../../types/generated'

import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'
import {
  DSU_ADDRESS,
  DSU_BATCHER,
  DSU_RESERVE,
  fundWalletDSU,
  fundWalletUSDC,
  USDC_ADDRESS,
} from '../../../helpers/mainnetHelpers'
import { parse6decimal } from '../../../../../common/testutil/types'

const fixture = async (): Promise<InstanceVars> => {
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  const vars = await deployProtocol(dsu, usdc, DSU_BATCHER, DSU_RESERVE)

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
  RunInvokerTests(getFixture, createInvoker, fundWalletDSU, fundWalletUSDC)
  RunOrderTests(getFixture, createInvoker)
  RunPythOracleTests(getFixture, createInvoker)
}
