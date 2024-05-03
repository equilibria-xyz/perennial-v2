import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'

const GRAPHQL_QUERY_PAGE_SIZE = 1000
const SETTLE_MULTICALL_BATCH_SIZE = 100

export default task('settle-markets', 'Settles users across all markets')
  .addFlag('dry', 'Count number of users and transactions required to settle')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { getNetworkName },
    } = HRE

    const networkName = getNetworkName()
    const graphURL = getSubgraphUrlFromEnvironment(networkName)
    if (!graphURL) {
      console.error('Subgraph URL environment variable unknown for this network')
      return 1
    }

    const multicall = new ethers.Contract(MulticallAddress, MulticallABI, ethers.provider)

    const marketUsers = await getMarketUsers(graphURL)
    let marketUserCount = 0
    let txCount = 0

    for (const marketAddress in marketUsers) {
      const users = [...marketUsers[marketAddress].values()]
      marketUserCount += users.length

      const market = await ethers.getContractAt('IMarket', marketAddress)

      // Commit VAA for market?

      console.log('settling', users.length, 'users to settle in market', marketAddress)

      let batchedUsers
      while (users.length > 0) {
        // batch multicalls to handle markets with large numbers of users
        batchedUsers = users.splice(0, SETTLE_MULTICALL_BATCH_SIZE)
        console.log('  batch contains', batchedUsers.length, 'users', users.length, 'users remaining')

        const multicallPayload = settleMarketUsersPayload(market, batchedUsers)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )
        const gasUsage = await multicall.estimateGas.aggregate3(multicallPayload)

        const successfulSettleCalls = result.reduce((a, c) => (c.success ? a + 1 : a), 0)
        console.log(`    ${successfulSettleCalls} successful settle calls. gas: ${gasUsage.toString()}`)

        if (successfulSettleCalls === batchedUsers.length) {
          if (!args.dry) {
            process.stdout.write('    Sending Transaction...')
            const tx = await multicall.aggregate3(multicallPayload)
            await tx.wait()
            console.log('done. Hash:', tx.hash)
          }
          txCount += 1
        } else {
          console.error('failed to settle all users:', result)
          return 1
        }
      }
    }

    console.log('-------------------')
    const actionString = args.dry ? 'Need to call' : 'Called'
    console.log(`${actionString} settle on ${marketUserCount} users in ${txCount} transactions`) // 3507 total calls on Arbitrum
  })

// maps market addresses to a list of users who deposited into that market
async function getMarketUsers(graphURL: string): Promise<{ [key: string]: Set<string> }> {
  // TODO: Ensure this query captures everyone.  Do liquidators with no position need to be settled to claim fee?
  const query = gql`
    query getUserDeposits($first: Int!, $skip: Int!) {
      updateds(first: $first, skip: $skip, where: { collateral_not: 0 }) {
        market
        account
        blockTimestamp
      }
    }
  `

  let page = 0
  let res: { updateds: { market: string; account: string }[] } = await request(graphURL, query, {
    first: GRAPHQL_QUERY_PAGE_SIZE,
    skip: page * GRAPHQL_QUERY_PAGE_SIZE,
  })
  const rawData = res
  while (res.updateds.length === GRAPHQL_QUERY_PAGE_SIZE) {
    page += 1
    res = await request(graphURL, query, {
      first: GRAPHQL_QUERY_PAGE_SIZE,
      skip: page * GRAPHQL_QUERY_PAGE_SIZE,
    })
    rawData.updateds = [...rawData.updateds, ...res.updateds]
  }

  const result: { [key: string]: Set<string> } = {}
  for (const raw of rawData.updateds) {
    if (raw.market in result) result[raw.market].add(raw.account)
    else result[raw.market] = new Set([raw.account])
  }
  return result
}

// prepares calldata to settle multiple users
function settleMarketUsersPayload(market: IMarket, users: string[]): MulticallPayload[] {
  const settles = users.map(user => market.interface.encodeFunctionData('settle', [user]))
  return settles.map(callData => ({ callData, allowFailure: false, target: market.address }))
}
