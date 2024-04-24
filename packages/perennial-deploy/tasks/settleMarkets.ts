import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { constants, BigNumber } from 'ethers'

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

    const graphURL = getSubgraphUrlFromEnvironment(getNetworkName())
    if (!graphURL) {
      console.log('Subgraph URL environment variable unknown for this network')
      return
    }

    const marketUsers = await getMarketUsers(graphURL)
    console.log('marketUsers', marketUsers)
    let marketUserCount = 0

    for (const marketAddress in marketUsers) {
      const users = marketUsers[marketAddress]
      marketUserCount += users.size

      // TODO: find current id and run getPendingPositions multicall to determine which users actually need settlement

      if (args.dry) {
        console.log('found', users.size, 'users in market', marketAddress)
      } else {
        console.log('settling', users.size, 'users in market', marketAddress)
        const market = await ethers.getContractAt('IMarket', marketAddress)
        const multicallPayload = settleMarketUsersPayload(market, [...users.values()])
        console.log('payload', multicallPayload)
        const multicall = new ethers.Contract(MultiCallAddress, MultiCallABI, ethers.provider)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )
        console.log('result', result)
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
    // console.log('rawData', user)
    if (raw.market in result) result[raw.market].add(raw.account)
    else result[raw.market] = new Set([raw.account])
  }
  return result
}

function getPendingPositions(market: IMarket, users: string[], versionId: BigNumber): MulticallPayload[] {
  const pendingPositions = users.map(user => market.interface.encodeFunctionData('pendingPositions', [user, versionId]))
  return pendingPositions.map(callData => ({ callData, allowFailure: true, target: market.address }))
}

function settleMarketUsersPayload(market: IMarket, users: string[]): MulticallPayload[] {
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
