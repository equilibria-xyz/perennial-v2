import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { constants } from 'ethers'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'

const QueryPageSize = 1000

export default task('settle-markets', 'Settles users across all markets')
  .addFlag('dry', 'Print list of unsettled users')
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

    for (const marketAddress in marketUsers) {
      const users = [...marketUsers[marketAddress].values()]
      marketUserCount += users.length

      const market = await ethers.getContractAt('IMarket', marketAddress)

      if (args.dry) {
        console.log('found', users.length, 'users to settle in market', marketAddress)
      } else {
        console.log('settling', users.length, 'users to settle in market', marketAddress)

        // TODO: might need to batch this into 100 users at a time
        // Run on arbitrum fork instead of arbSeb to experiment.  Should be around 3507 total calls,
        // with 1930 users in the largest market.
        const multicallPayload = settleMarketUsersPayload(market, users)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )

        console.log('settle result', result)
      }
    }

    console.log('-------------------')
    console.log(`Total settlement calls: ${marketUserCount}`)
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
    first: QueryPageSize,
    skip: page * QueryPageSize,
  })
  const rawData = res
  while (res.updateds.length === QueryPageSize) {
    page += 1
    res = await request(graphURL, query, {
      first: QueryPageSize,
      skip: page * QueryPageSize,
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
  // FIXME: despite deploying 2.1.1 contracts to fork, markets still don't have 'settle' method here.
  const settles = users.map(user =>
    market.interface.encodeFunctionData('update', [
      user,
      constants.MaxUint256,
      constants.MaxUint256,
      constants.MaxUint256,
      0,
      false,
    ]),
  )
  return settles.map(callData => ({ callData, allowFailure: false, target: market.address }))
}
