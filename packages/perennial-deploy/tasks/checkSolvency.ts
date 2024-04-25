import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { constants } from 'ethers'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'

const QueryPageSize = 1000

export default task('check-solvency', 'Check the solvency of the given market').setAction(
  async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { getNetworkName },
    } = HRE

    const graphURL = getSubgraphUrlFromEnvironment(getNetworkName())
    if (!graphURL) {
      console.error('Invalid Network.')
      return 1
    }
    const marketFactory = await ethers.getContractAt(
      'IMarketFactory',
      (
        await HRE.deployments.get('MarketFactory')
      ).address,
    )
    const markets = await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered(), 0, 'latest')
    let totalShortfall = 0

    for (const marketEvent of markets) {
      const marketAddress = marketEvent.args.instance
      console.log('-------------------')
      console.log('Checking market:', marketAddress)
      const liquidations = Array.from(new Set(await getLiquidations(marketAddress, graphURL)))
      console.log(`${marketAddress}: Found ${liquidations.length} liquidations. Checking for shortfalls...`)

      const market = await ethers.getContractAt('IMarket', marketAddress)
      const multicallPayload = liquidations.map(account => settleAndReadLocalsMulticallPayload(market, account)).flat()
      const multicall = new ethers.Contract(MulticallAddress, MulticallABI, ethers.provider)

      const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(multicallPayload)
      const decoded = result
        .map(r => {
          try {
            return market.interface.decodeFunctionResult('locals', r.returnData)
          } catch (e) {
            return undefined
          }
        })
        .filter(r => r !== undefined)
      const shortfalls = decoded
        .map((r, i) => ({ result: r, account: liquidations[i] }))
        .filter(r => BigInt(r.result?.at(0).collateral) < 0n)
        .map(r => ({ account: r.account, shortfall: Number(r.result?.at(0).collateral) / 1e6 }))
      const marketShortfall = shortfalls.reduce((acc, s) => acc + s.shortfall, 0)
      console.log(
        `${marketAddress}: Found ${shortfalls.length} accounts with shortfalls totalling ${marketShortfall} USD`,
      )
      console.log('Shortfalls:', JSON.stringify(shortfalls, null, 2))
      totalShortfall += marketShortfall
    }
    console.log('-------------------')
    console.log(`Total shortfall: ${totalShortfall} USD`)
  },
)

async function getLiquidations(market: string, graphURL: string): Promise<string[]> {
  const query = gql`
    query getLiqudations($market: Bytes!, $first: Int!, $skip: Int!) {
      updateds(
        first: $first
        skip: $skip
        where: { market: $market, protect: true }
        orderBy: blockNumber
        orderDirection: desc
      ) {
        account
      }
    }
  `

  let page = 0
  let res: { updateds: { account: string }[] } = await request(graphURL, query, {
    market: market,
    first: QueryPageSize,
    skip: page * QueryPageSize,
  })
  const rawData = res
  while (res.updateds.length === QueryPageSize) {
    page += 1
    res = await request(graphURL, query, {
      market: market,
      first: QueryPageSize,
      skip: page * QueryPageSize,
    })
    rawData.updateds = [...rawData.updateds, ...res.updateds]
  }

  return rawData.updateds.map(u => u.account)
}

function settleAndReadLocalsMulticallPayload(market: IMarket, account: string): MulticallPayload[] {
  const settle = market.interface.encodeFunctionData('update', [
    account,
    constants.MaxUint256,
    constants.MaxUint256,
    constants.MaxUint256,
    0,
    false,
  ])
  const locals = market.interface.encodeFunctionData('locals', [account])
  return [settle, locals].map(callData => ({ callData, allowFailure: true, target: market.address }))
}
