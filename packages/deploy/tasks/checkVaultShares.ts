import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IVault } from '../types/generated'
import { isArbitrum } from '../../common/testutil/network'
import { constants, utils } from 'ethers'
import { MulticallABI } from './multicallUtils'

const QueryPageSize = 1000
const SharesReadSize = 500
const MultiCallAddress = '0xcA11bde05977b3631167028862bE2a173976CA11'

export default task('check-vault-shares', 'Check the share counts of all vaults').setAction(
  async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { getNetworkName },
    } = HRE

    const graphURL = process.env.ARBITRUM_GRAPH_URL
    if (!graphURL || !isArbitrum(getNetworkName())) {
      console.log('Invalid Network.')
      return
    }
    const vaultFactory = await ethers.getContractAt(
      'IVaultFactory',
      (
        await HRE.deployments.get('VaultFactory')
      ).address,
    )
    const vaults = await vaultFactory.queryFilter(vaultFactory.filters.InstanceRegistered(), 0, 'latest')

    for (const vaultEvent of vaults) {
      const vaultAddress = vaultEvent.args.instance
      console.log('-------------------')
      console.log('Checking vault:', vaultAddress)
      const vaultUsers = Array.from(new Set(await getVaultUsers(vaultAddress, graphURL)))
      console.log(`${vaultAddress}: Found ${vaultUsers.length} users. Checking for shares match...`)

      const vault = await ethers.getContractAt('IVault', vaultAddress)
      const multicallPayload = vaultUsers.map(account => settleAndReadSharesPayload(vault, account)).flat()
      const multicall = new ethers.Contract(MultiCallAddress, MulticallABI, ethers.provider)

      let offset = 0
      let results: { success: boolean; returnData: string }[] = []
      while (offset < multicallPayload.length) {
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload.slice(offset, offset + SharesReadSize),
        )
        results = [...results, ...result]
        offset += SharesReadSize
      }

      const decoded = results
        .map(r => {
          try {
            return vault.interface.decodeFunctionResult('accounts', r.returnData)
          } catch (e) {
            return undefined
          }
        })
        .filter(r => r !== undefined)
      const shares: bigint[] = decoded.map(r => r?.at(0)?.shares.toBigInt() ?? 0n)
      const vaultShares = shares.reduce((acc, s) => acc + s, 0n)
      console.log(`${vaultAddress}: Total user shares: ${utils.formatUnits(vaultShares, 6)}`)
      const [, vaultTotalSharesResult] = await multicall.callStatic.aggregate3(settleAndReadTotalSharesPayload(vault))
      const vaultTotalShares =
        vault.interface.decodeFunctionResult('totalShares', vaultTotalSharesResult.returnData).at(0)?.toBigInt() ?? 0n
      console.log(`${vaultAddress}: Total shares: ${utils.formatUnits(vaultTotalShares, 6)}`)
      const sharesDifference = vaultTotalShares - vaultShares
      console.log(`${vaultAddress}: Shares Delta: ${utils.formatUnits(sharesDifference, 6)}`)
    }
    console.log('-------------------')
  },
)

async function getVaultUsers(vault: string, graphURL: string): Promise<string[]> {
  const query = gql`
    query getVaultDeposits($vault: Bytes!, $first: Int!, $skip: Int!) {
      vaultUpdateds(
        first: $first
        skip: $skip
        where: { vault: $vault, depositAssets_gt: 0 }
        orderBy: blockNumber
        orderDirection: desc
      ) {
        account
      }
    }
  `

  let page = 0
  let res: { vaultUpdateds: { account: string }[] } = await request(graphURL, query, {
    vault: vault,
    first: QueryPageSize,
    skip: page * QueryPageSize,
  })
  const rawData = res
  while (res.vaultUpdateds.length === QueryPageSize) {
    page += 1
    res = await request(graphURL, query, {
      vault: vault,
      first: QueryPageSize,
      skip: page * QueryPageSize,
    })
    rawData.vaultUpdateds = [...rawData.vaultUpdateds, ...res.vaultUpdateds]
  }

  return rawData.vaultUpdateds.map(u => u.account)
}

function settleAndReadSharesPayload(
  vault: IVault,
  account: string,
): { callData: string; allowFailure: boolean; target: string }[] {
  const settle = vault.interface.encodeFunctionData('settle', [account])
  const accountRead = vault.interface.encodeFunctionData('accounts', [account])
  return [settle, accountRead].map(callData => ({ callData, allowFailure: true, target: vault.address }))
}

function settleAndReadTotalSharesPayload(vault: IVault): { callData: string; allowFailure: boolean; target: string }[] {
  const settle = vault.interface.encodeFunctionData('settle', [constants.AddressZero])
  const accountRead = vault.interface.encodeFunctionData('totalShares')
  return [settle, accountRead].map(callData => ({ callData, allowFailure: true, target: vault.address }))
}
