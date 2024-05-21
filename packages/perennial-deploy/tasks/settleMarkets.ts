import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'

const GRAPHQL_QUERY_PAGE_SIZE = 1000
const SETTLE_MULTICALL_BATCH_SIZE = 150

export default task('settle-markets', 'Settles users across all markets')
  .addFlag('dry', 'Count number of users and transactions required to settle')
  .addFlag('prevabi', 'Use previous ABIs for contract interaction')
  .addOptionalParam('batchsize', 'The multicall batch size', SETTLE_MULTICALL_BATCH_SIZE, types.int)
  .addOptionalParam('buffergas', 'The buffer gas to add to the estimate', 1, types.int)
  .addOptionalParam('timestamp', 'Timestamp to commit prices for', undefined, types.int)
  .addOptionalParam('factoryaddress', 'Address of the PythFactory contract', undefined, types.string)
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Settle Markets] Running Settle Markets Task')
    const {
      ethers,
      deployments: { get, getNetworkName },
      run,
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

    const pythFactory = await ethers.getContractAt(
      'PythFactory',
      args.factoryaddress ?? (await get('PythFactory')).address,
    )
    const oracles = await pythFactory.queryFilter(pythFactory.filters.OracleCreated())
    const underlyingIds = [
      ...new Set(await Promise.all(oracles.map(async oracle => pythFactory.toUnderlyingId(oracle.args.id)))),
    ]

    console.log(
      '[Settle Markets] Committing prices for underlying ids',
      underlyingIds.join(','),
      'timestamp:',
      args.timestamp,
    )
    await run('commit-price', {
      priceids: underlyingIds.join(','),
      dry: args.dry,
      timestamp: args.timestamp,
      factoryaddress: args.factoryaddress,
    })

    console.log('[Settle Markets]  Fetching Users to Settle')
    const requireSettles: { market: string; address: string }[] = await run('verify-ids', { prevabi: args.prevabi })
    const marketUsers = requireSettles.reduce((acc, { market, address }) => {
      if (acc[market]) acc[market].add(address)
      else acc[market] = new Set([address])
      return acc
    }, {} as { [key: string]: Set<string> })

    let marketUserCount = 0
    let txCount = 0

    for (const marketAddress in marketUsers) {
      if (args.markets && !args.markets.toLowerCase().split(',').includes(marketAddress.toLowerCase())) {
        console.log('[Settle Markets]    Skipping market', marketAddress)
        continue
      }

      const users = [...marketUsers[marketAddress].values()].slice(args.offset)
      marketUserCount += users.length

      const market = await ethers.getContractAt('IMarket', marketAddress)

      console.log('[Settle Markets]    Settling', users.length, 'users to settle in market', marketAddress)

      let batchedUsers
      while (users.length > 0) {
        // batch multicalls to handle markets with large numbers of users
        batchedUsers = users.splice(0, batchSize)
        console.log(
          '[Settle Markets]      batch contains',
          batchedUsers.length,
          'users',
          users.length,
          'users remaining',
        )

        const multicallPayload = settleMarketUsersPayload(market, batchedUsers)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )
        const gasUsage = await multicall.estimateGas.aggregate3(multicallPayload)

        const successfulSettleCalls = result.reduce((a, c) => (c.success ? a + 1 : a), 0)
        console.log(
          `[Settle Markets]        ${successfulSettleCalls} successful settle calls. gas: ${gasUsage.toString()}`,
        )

        if (successfulSettleCalls === batchedUsers.length) {
          if (!args.dry) {
            process.stdout.write('[Settle Markets]        Sending Transaction...')
            const tx = await multicall.aggregate3(multicallPayload, { gasLimit: gasUsage.mul(args.buffergas) })
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
    console.log(`[Settle Markets] ${actionString} settle on ${marketUserCount} users in ${txCount} transactions`) // 3507 total calls on Arbitrum
    console.log('[Settle Markets] Done.')
  })

export async function getAllMarketUsers(
  graphURL: string,
): Promise<{ result: { [key: string]: Set<string> }; numQueries: number }> {
  const query = gql`
    query getAllUsers($first: Int!, $skip: Int!) {
      marketAccountPositions(first: $first, skip: $skip) {
        market
        account
      }
    }
  `

  let numQueries = 0
  let page = 0
  let res: { marketAccountPositions: { market: string; account: string }[] } = await request(graphURL, query, {
    first: GRAPHQL_QUERY_PAGE_SIZE,
    skip: page * GRAPHQL_QUERY_PAGE_SIZE,
  })
  const rawData = res
  while (res.marketAccountPositions.length === GRAPHQL_QUERY_PAGE_SIZE) {
    page += 1
    res = await request(graphURL, query, {
      first: GRAPHQL_QUERY_PAGE_SIZE,
      skip: page * GRAPHQL_QUERY_PAGE_SIZE,
    })
    rawData.marketAccountPositions = [...rawData.marketAccountPositions, ...res.marketAccountPositions]
    numQueries += 1
  }

  const result: { [key: string]: Set<string> } = {}
  for (const raw of rawData.marketAccountPositions) {
    if (raw.market in result) result[raw.market].add(raw.account)
    else result[raw.market] = new Set([raw.account])
  }

  return { result, numQueries }
}

// prepares calldata to settle multiple users
function settleMarketUsersPayload(market: IMarket, users: string[]): MulticallPayload[] {
  const settles = users.map(user => market.interface.encodeFunctionData('settle', [user]))
  return settles.map(callData => ({ callData, allowFailure: false, target: market.address }))
}
