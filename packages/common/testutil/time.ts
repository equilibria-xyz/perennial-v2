import '@nomiclabs/hardhat-ethers'
import HRE from 'hardhat'
import { HardhatConfig } from 'hardhat/types'
import { time } from './index'
const { ethers } = HRE

export async function currentBlockTimestamp(): Promise<number> {
  const blockNumber = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNumber)
  return block.timestamp
}

export async function advanceBlock(): Promise<void> {
  await ethers.provider.send('evm_mine', [])
}

export async function advanceBlockTo(block: number): Promise<void> {
  while ((await ethers.provider.getBlockNumber()) < block) {
    await ethers.provider.send('evm_mine', [])
  }
}

export async function increase(duration: number): Promise<void> {
  await ethers.provider.send('evm_increaseTime', [duration])
  await advanceBlock()
}

export async function increaseTo(timestamp: number): Promise<void> {
  console.log('increaseTo', timestamp)
  const currentTimestamp = await currentBlockTimestamp()
  await ethers.provider.send('evm_increaseTime', [timestamp - currentTimestamp])
  await advanceBlock()
  const newTimestamp = await currentBlockTimestamp()
  if (timestamp != newTimestamp)
    console.log('[WARNING] increaseTo failed to reach timestamp (%s vs %s)', timestamp, newTimestamp)
}
export async function freezeTime(): Promise<void> {
  await ethers.provider.send('evm_setNextBlockTimestamp', [await currentBlockTimestamp()])
}

export async function setNextTimestamp(timestamp: number): Promise<void> {
  await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
}

export async function pauseMining(): Promise<void> {
  await ethers.provider.send('evm_setAutomine', [false])
  await ethers.provider.send('evm_setIntervalMining', [0])
}

export async function resumeMining(): Promise<void> {
  await ethers.provider.send('evm_mine', [])
  await ethers.provider.send('evm_setAutomine', [true])
  await ethers.provider.send('evm_setIntervalMining', [1000])
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
