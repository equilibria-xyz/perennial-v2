import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IVault } from '../types/generated'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'

const GRAPHQL_QUERY_PAGE_SIZE = 1000
const SETTLE_MULTICALL_BATCH_SIZE = 100

export default task('settle-vaults', 'Settles users across all vaults')
  .addFlag('dry', 'Count number of users and transactions required to settle')
  .addOptionalParam('batchsize', 'The multicall batch size', SETTLE_MULTICALL_BATCH_SIZE, types.int)
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Settle Vaults] Running Settle Vaults Task')
    const {
      ethers,
      deployments: { getNetworkName },
    } = HRE

    const batchSize = args.batchsize
    const networkName = getNetworkName()
    const graphURL = getSubgraphUrlFromEnvironment(networkName)
    if (!graphURL) {
      console.error('Subgraph URL environment variable unknown for this network')
      return 1
    }

    const multicall = new ethers.Contract(MulticallAddress, MulticallABI, ethers.provider).connect(
      (await ethers.getSigners())[0],
    )

    const vaultUsers = await getVaultUsers(graphURL)
    let vaultUserCount = 0
    let txCount = 0

    for (const vaultAddress in vaultUsers) {
      const users = [...vaultUsers[vaultAddress].values()]
      vaultUserCount += users.length

      const vault = await ethers.getContractAt('IVault', vaultAddress)

      // Commit VAA for vault?

      console.log('[Settle Vaults]    Settling', users.length, 'users to settle in vault', vaultAddress)

      let batchedUsers
      while (users.length > 0) {
        // batch multicalls to handle vaults with large numbers of users
        batchedUsers = users.splice(0, batchSize)
        console.log(
          '[Settle Vaults]      batch contains',
          batchedUsers.length,
          'users',
          users.length,
          'users remaining',
        )

        const multicallPayload = settleVaultUsersPayload(vault, batchedUsers)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )
        const gasUsage = await multicall.estimateGas.aggregate3(multicallPayload)

        const successfulSettleCalls = result.reduce((a, c) => (c.success ? a + 1 : a), 0)
        console.log(
          `[Settle Vaults]        ${successfulSettleCalls} successful settle calls. gas: ${gasUsage.toString()}`,
        )

        if (successfulSettleCalls === batchedUsers.length) {
          if (!args.dry) {
            process.stdout.write('[Settle Vaults]        Sending Transaction...')
            const tx = await multicall.aggregate3(multicallPayload)
            await tx.wait()
            process.stdout.write(`done. Hash: ${tx.hash}\n`)
          }
          txCount += 1
        } else {
          console.error('failed to settle all users:', result)
          return 1
        }
      }
    }

    const actionString = args.dry ? 'Need to call' : 'Called'
    console.log(`[Settle Vaults] ${actionString} settle on ${vaultUserCount} users in ${txCount} transactions`) // 3507 total calls on Arbitrum
    console.log('[Settle Vaults] Done.')
  })

// maps vault addresses to a list of users who deposited into that vault
async function getVaultUsers(graphURL: string): Promise<{ [key: string]: Set<string> }> {
  console.log('[Settle Vaults]  Fetching All Vault Users')
  const query = gql`
    query getUserDeposits($first: Int!, $skip: Int!) {
      vaultUpdateds(first: $first, skip: $skip) {
        vault
        account
        blockTimestamp
      }
    }
  `

  let numQueries = 0
  let page = 0
  let res: { vaultUpdateds: { vault: string; account: string }[] } = await request(graphURL, query, {
    first: GRAPHQL_QUERY_PAGE_SIZE,
    skip: page * GRAPHQL_QUERY_PAGE_SIZE,
  })
  const rawData = res
  while (res.vaultUpdateds.length === GRAPHQL_QUERY_PAGE_SIZE) {
    page += 1
    res = await request(graphURL, query, {
      first: GRAPHQL_QUERY_PAGE_SIZE,
      skip: page * GRAPHQL_QUERY_PAGE_SIZE,
    })
    rawData.vaultUpdateds = [...rawData.vaultUpdateds, ...res.vaultUpdateds]
    numQueries += 1
  }

  const result: { [key: string]: Set<string> } = {}
  for (const raw of rawData.vaultUpdateds) {
    if (raw.vault in result) result[raw.vault].add(raw.account)
    else result[raw.vault] = new Set([raw.account])
  }
  console.log('[Settle Vaults]  Fetched all users in', numQueries, 'queries')
  return result
}

// prepares calldata to settle multiple users
function settleVaultUsersPayload(vault: IVault, users: string[]): MulticallPayload[] {
  const settles = users.map(user => vault.interface.encodeFunctionData('settle', [user]))
  return settles.map(callData => ({ callData, allowFailure: false, target: vault.address }))
}
