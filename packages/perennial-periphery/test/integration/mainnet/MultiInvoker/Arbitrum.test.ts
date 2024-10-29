import { ethers } from 'hardhat'
import { constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { IERC20Metadata__factory } from '../../../../types/generated'

import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'
import { DSU_ADDRESS, DSU_RESERVE, USDC_ADDRESS } from '../../../helpers/arbitrumHelpers'

const fixture = async (): Promise<InstanceVars> => {
  const [owner] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  return deployProtocol(dsu, usdc, constants.AddressZero, DSU_RESERVE)
}

async function getFixture(): Promise<InstanceVars> {
  const vars = loadFixture(fixture)
  return vars
}

if (process.env.FORK_NETWORK === 'arbitrum') {
  RunInvokerTests(getFixture, createInvoker)
  RunOrderTests(getFixture, createInvoker)
  RunPythOracleTests(getFixture, createInvoker)
}
