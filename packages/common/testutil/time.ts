import '@nomiclabs/hardhat-ethers'
import { mine, mineUpTo, time } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'
import { HardhatConfig } from 'hardhat/types'
const { ethers } = HRE

export async function currentBlockTimestamp(): Promise<number> {
  const blockNumber = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNumber)
  return block.timestamp
}

export async function advanceBlock(): Promise<void> {
  await mine()
}

export async function advanceBlockTo(block: number): Promise<void> {
  await mineUpTo(block)
}

export async function increase(duration: number): Promise<void> {
  await time.increase(duration)
}

export async function increaseTo(timestamp: number): Promise<void> {
  const currentTimestamp = await currentBlockTimestamp()
  if (timestamp < currentTimestamp) {
    await ethers.provider.send('evm_increaseTime', [timestamp - currentTimestamp])
    await advanceBlock()
  } else {
    await time.increaseTo(timestamp)
  }
  const newTimestamp = await currentBlockTimestamp()
  if (timestamp != newTimestamp)
    console.log('[WARNING] increaseTo failed to reach timestamp (%s vs %s)', timestamp, newTimestamp)
}

export async function reset(config: HardhatConfig): Promise<void> {
  await ethers.provider.send('hardhat_reset', [
    {
      forking: {
        jsonRpcUrl: config.networks?.hardhat?.forking?.url,
        blockNumber: config.networks?.hardhat?.forking?.blockNumber,
      },
    },
  ])
}
