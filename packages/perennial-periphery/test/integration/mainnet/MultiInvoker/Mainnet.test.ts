import { ethers } from 'hardhat'
import { constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { IERC20Metadata__factory, MultiInvoker, VaultFactory } from '../../../../types/generated'

import { RunInvokerTests } from './Invoke.test'
import { RunOrderTests } from './Orders.test'
import { RunPythOracleTests } from './Pyth.test'
import { createInvoker, deployProtocol, InstanceVars } from './setupHelpers'

// TODO: move these to new mainnetHelpers.ts common helper
const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DSU_MINTER_ADDRESS = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'
const DSU_BATCHER_ADDRESS = '0xAEf566ca7E84d1E736f999765a804687f39D9094'
const DSU_RESERVE_ADDRESS = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

const fixture = async (): Promise<InstanceVars> => {
  const [owner] = await ethers.getSigners()
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  return deployProtocol(dsu, usdc, DSU_MINTER_ADDRESS, DSU_BATCHER_ADDRESS, DSU_RESERVE_ADDRESS)
}

async function getFixture(): Promise<InstanceVars> {
  const vars = loadFixture(fixture)
  return vars
}

/*async function createInvoker(instanceVars: InstanceVars, vaultFactory?: VaultFactory, withBatcher = false): Promise<MultiInvoker> {
  return deployInvoker(instanceVars, vaultFactory, withBatcher)
}*/

if (process.env.FORK_NETWORK === undefined) {
  RunInvokerTests(getFixture, createInvoker)
  RunOrderTests(getFixture, createInvoker)
  RunPythOracleTests(getFixture, createInvoker)
}
