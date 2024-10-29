import '@nomiclabs/hardhat-ethers'
import { mine, mineUpTo, time } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'
import { reset as hhReset } from '@nomicfoundation/hardhat-network-helpers'
const { ethers, config } = HRE

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

export async function setNextBlockTimestamp(timestamp: number): Promise<void> {
  await time.setNextBlockTimestamp(timestamp)
}

export async function includeAt(func: () => Promise<any>, timestamp: number): Promise<any> {
  await ethers.provider.send('evm_setAutomine', [false])
  await ethers.provider.send('evm_setIntervalMining', [0])

  await time.setNextBlockTimestamp(timestamp)
  const result = await func()

  await ethers.provider.send('evm_mine', [])
  await ethers.provider.send('evm_setAutomine', [true])

  return result
}

export async function increaseTo(timestamp: number): Promise<void> {
  const currentTimestamp = await currentBlockTimestamp()
  if (timestamp < currentTimestamp) {
    throw new Error('Attempting to create a block with timestamp earlier than the previous block')
  } else {
    await time.increaseTo(timestamp)
  }
  const newTimestamp = await currentBlockTimestamp()
  if (timestamp != newTimestamp)
    console.log('[WARNING] increaseTo failed to reach timestamp (%s vs %s)', timestamp, newTimestamp)
}

export async function reset(blockNumber?: number): Promise<void> {
  const url = config.networks.hardhat.forking?.url
  const bn = blockNumber || config.networks.hardhat.forking?.blockNumber
  await hhReset(url, bn)
}
