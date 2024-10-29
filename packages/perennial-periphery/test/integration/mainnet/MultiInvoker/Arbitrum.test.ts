import { ethers, utils } from 'hardhat'
import { constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { IERC20Metadata__factory } from '../../../../types/generated'

import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'
import {
  CHAINLINK_ETH_USD_FEED,
  DSU_ADDRESS,
  DSU_RESERVE,
  fundWalletDSU,
  fundWalletUSDC,
  USDC_ADDRESS,
} from '../../../helpers/arbitrumHelpers'
import { parse6decimal } from '../../../../../common/testutil/types'

const fixture = async (): Promise<InstanceVars> => {
  // get users and token addresses
  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  // deploy perennial core factories
  const vars = await deployProtocol(dsu, usdc, constants.AddressZero, DSU_RESERVE, CHAINLINK_ETH_USD_FEED)

  // fund wallets used in the tests
  await fundWalletDSU(user, utils.parseEther('2000000'))
  await fundWalletDSU(userB, utils.parseEther('2000000'))
  await fundWalletDSU(userC, utils.parseEther('2000000'))
  await fundWalletDSU(userD, utils.parseEther('2000000'))
  await fundWalletUSDC(user, parse6decimal('1000'))
  await fundWalletDSU(liquidator, utils.parseEther('2000000'))
  await fundWalletDSU(perennialUser, utils.parseEther('14000000'))

  // TODO: deploy a Pyth oracle implementation and connect factories

  return vars
}

async function getFixture(): Promise<InstanceVars> {
  const vars = loadFixture(fixture)
  return vars
}

if (process.env.FORK_NETWORK === 'arbitrum') {
  // TODO: normalize fundWallet interface, sort out oracle deployment
  // RunInvokerTests(getFixture, createInvoker)
  RunOrderTests(getFixture, createInvoker)
  RunPythOracleTests(getFixture, createInvoker)
}
