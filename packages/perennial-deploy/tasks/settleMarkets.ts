import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { constants, BigNumber } from 'ethers'
import { PositionStruct } from '../types/generated/@equilibria/perennial-v2/contracts/Market'

const QueryPageSize = 1000

function getSubgraphUrlFromEnvironment(networkName: string) {
  switch (networkName) {
    case 'arbitrum':
      return process.env.ARBITRUM_GRAPH_URL
    case 'arbitrumSepolia':
    case 'localhost':
      return process.env.ARBITRUMSEPOLIA_GRAPH_URL
  }
}

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

    const multicall = new ethers.Contract(MultiCallAddress, MultiCallABI, ethers.provider)

    const marketUsers = await getMarketUsers(graphURL)
    // console.log('marketUsers', marketUsers)
    let marketUserCount = 0

    for (const marketAddress in marketUsers) {
      const users = [...marketUsers[marketAddress].values()]
      marketUserCount += users.length

      const market = await ethers.getContractAt('IMarket', marketAddress)

      // prune already-settled users from the list
      // FIXME: pendingPositions calls do not work on a fork for some reason
      let unsettledUsers: string[]
      if (networkName === 'localhost') {
        // just settle all users as workaround
        unsettledUsers = users
      } else {
        // TODO: suspect this logic is incorrect
        unsettledUsers = []
        const latestId: BigNumber = (await market.global()).latestId
        console.log('querying', market.address, 'pending positions for', users.length, 'users from id', latestId)
        const multicallPayload = getPendingPositionsPayload(market, users, latestId)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )
        const decoded = result.map(r => {
          return market.interface.decodeFunctionResult('pendingPositions', r.returnData)
        })
        if (users.length !== decoded.length) {
          console.error('Failed to query pending positions for users')
          return 1
        }
        for (let i = 0; i < decoded.length; ++i) {
          const user = users[i]
          const position: PositionStruct = decoded[i][0]
          if (position.maker != 0 || position.long != 0 || position.short != 0) {
            console.log('user', user, 'has pending position', position)
            unsettledUsers.push(user)
          }
        }
      }

      if (args.dry) {
        console.log('found', unsettledUsers.length, 'users to settle in market', marketAddress)
      } else {
        console.log('settling', unsettledUsers.length, 'users to settle in market', marketAddress)

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

function getPendingPositionsPayload(market: IMarket, users: string[], latestId: BigNumber): MulticallPayload[] {
  const pendingPositions = users.map(user => market.interface.encodeFunctionData('pendingPositions', [user, latestId]))
  return pendingPositions.map(callData => ({ callData, allowFailure: true, target: market.address }))
}

function settleMarketUsersPayload(market: IMarket, users: string[]): MulticallPayload[] {
  // FIXME: despite deploying 2.1.1 contracts to fork, markets still don't have 'settle' method here.
  // Perhaps implementation was deployed but not updated.
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

// TODO: move these to a multicall utils module to share with check-solvency task

// valid and both Arbitrum and ArbitrumSepolia
const MultiCallAddress = '0xcA11bde05977b3631167028862bE2a173976CA11'

interface MulticallPayload {
  callData: string
  allowFailure: boolean
  target: string
}

const MultiCallABI = [
  'function aggregate(tuple(address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)',
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function blockAndAggregate(tuple(address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes32 blockHash, tuple(bool success, bytes returnData)[] returnData)',
  'function getBasefee() view returns (uint256 basefee)',
  'function getBlockHash(uint256 blockNumber) view returns (bytes32 blockHash)',
  'function getBlockNumber() view returns (uint256 blockNumber)',
  'function getChainId() view returns (uint256 chainid)',
  'function getCurrentBlockCoinbase() view returns (address coinbase)',
  'function getCurrentBlockDifficulty() view returns (uint256 difficulty)',
  'function getCurrentBlockGasLimit() view returns (uint256 gaslimit)',
  'function getCurrentBlockTimestamp() view returns (uint256 timestamp)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
  'function getLastBlockHash() view returns (bytes32 blockHash)',
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function tryBlockAndAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes32 blockHash, tuple(bool success, bytes returnData)[] returnData)',
]
