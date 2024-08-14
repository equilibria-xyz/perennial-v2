import { ethers } from 'hardhat'
import { ContractTransaction, utils } from 'ethers'

// Reads data from first event matching provided name.
// Since linter has an aversion to non-null assertions, raises error if not found.
export async function getEventArguments(tx: ContractTransaction, name: string): Promise<utils.Result> {
  const receipt = await tx.wait()
  if (!receipt.events) throw new Error('Transaction receipt had no events')
  const firstMatch = receipt.events.find(e => e.event === name)
  if (!firstMatch) throw new Error(`Transaction did not raise ${name} event`)
  const args = firstMatch.args
  if (!args) throw new Error(`${name} event had no arguments`)
  return args
}

export async function getTimestamp(tx: ContractTransaction) {
  return (await ethers.provider.getBlock(tx.blockNumber!)).timestamp
}
