import '@nomiclabs/hardhat-ethers'
import { Contract, BigNumber, constants } from 'ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { gql, request } from 'graphql-request'
import { IMarket } from '../types/generated'
import { utils } from 'ethers'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'
import { getAllMarketUsers } from './settleMarkets'
import { notEmpty } from './utils'

const QueryPageSize = 1000
const DefaultBatchSize = 500

export default task('check-solvency', 'Check the solvency of all markets')
  .addFlag('full', "Check that market's DSU balance matches total collateral")
  .addFlag('prevabi', 'Use previous ABIs for contract interaction')
  .addOptionalParam('block', 'The block number to check', undefined, types.int)
  .addOptionalParam('batchsize', 'The multicall batch size', DefaultBatchSize, types.int)
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { getNetworkName, getArtifact },
    } = HRE

    const block = args.block ? '0x' + Number(args.block).toString(16) : 'latest'
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
    const dsu = await ethers.getContractAt('IERC20', (await HRE.deployments.get('DSU')).address)
    const multicall = new ethers.Contract(MulticallAddress, MulticallABI, ethers.provider)

    const markets = await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered(), 0, 'latest')
    let totalShortfall = 0n

    const { result: allUsers } = args.full
      ? await getAllMarketUsers(graphURL)
      : { result: {} as { [key: string]: Set<string> } }

    for (const marketEvent of markets) {
      let totalClaimable = 0n
      const marketAddress = marketEvent.args.instance
      console.log('-------------------')
      console.log('Checking market:', marketAddress)
      const users = Array.from(
        args.full ? allUsers[marketAddress.toLowerCase()] : new Set(await getLiquidations(marketAddress, graphURL)),
      )
      console.log(`${marketAddress}: Found ${users.length} users. Checking for shortfalls...`)

      const market = args.prevabi
        ? ((await ethers.getContractAt((await getArtifact('MarketV2_2')).abi, marketAddress)) as IMarket)
        : await ethers.getContractAt('IMarket', marketAddress)
      const result = await readLocalsForUsers(multicall, market, users, args.batchsize, block)

      const totalCollateral = result.reduce((acc, r) => acc + r.collateral.toBigInt(), 0n)
      totalClaimable = totalClaimable + result.reduce((acc, r) => acc + r.claimable.toBigInt(), 0n)
      const shortfalls = result
        .filter(r => r.collateral.toBigInt() < 0n)
        .map(r => ({ account: r.address, shortfall: r.collateral.toBigInt() }))
      const marketShortfall = shortfalls.reduce((acc, s) => acc + s.shortfall, 0n)

      console.log(
        `${marketAddress}: Found ${shortfalls.length} accounts with shortfalls totalling ${utils.formatUnits(
          marketShortfall,
          6,
        )} USD`,
      )
      if (marketShortfall) {
        console.log(
          'Shortfalls:',
          JSON.stringify(
            shortfalls.map(s => ({ ...s, shortfall: utils.formatUnits(s.shortfall, 6) })),
            null,
            2,
          ),
        )
      }
      totalShortfall += marketShortfall

      if (args.full) {
        const marketBalance = await dsu.balanceOf(marketAddress, { blockTag: block })
        const globalReturn = await multicall.callStatic.aggregate3(settleAndReadGlobalMulticallPayload(market), {
          blockTag: block,
        })
        const [global] = market.interface.decodeFunctionResult('global', globalReturn[1].returnData)
        // DSU that can be taken from the market, remove these values from the DSU balance
        const globalFees = global.protocolFee
          .add(global.oracleFee)
          .add(global.riskFee)
          .add(global.exposure)
          .add(totalClaimable)
          .toBigInt()
        const marketBalance6 = marketBalance.toBigInt() / BigInt(1e12) - globalFees
        const marketCollateral = totalCollateral
        console.log(
          'Market collateral delta (marketDSU - marketFees - totalCollateral):',
          utils.formatUnits(marketBalance6 - marketCollateral, 6),
          'DSU',
          `\n\tBalance: ${utils.formatUnits(marketBalance6, 6)}, Collateral: ${utils.formatUnits(marketCollateral, 6)}`,
          `\n\t\tFees: ${utils.formatUnits(globalFees, 6)}, Exposure: ${utils.formatUnits(global.exposure, 6)}`,
          `\n\t\tClaimable: ${utils.formatUnits(totalClaimable, 6)}`,
        )
      }
    }
    console.log('-------------------')
    console.log(`Total shortfall: ${utils.formatUnits(totalShortfall, 6)} USD`)
  })

async function getLiquidations(market: string, graphURL: string): Promise<string[]> {
  const query = gql`
    query getLiqudations($market: Bytes!, $first: Int!, $skip: Int!) {
      orderCreateds(
        first: $first
        skip: $skip
        where: { market: $market, liquidation: true }
        orderBy: blockNumber
        orderDirection: desc
      ) {
        account {
          id
        }
      }
    }
  `

  let page = 0
  let res: { orderCreateds: { account: { id: string } }[] } = await request(graphURL, query, {
    market: market,
    first: QueryPageSize,
    skip: page * QueryPageSize,
  })
  const rawData = res
  while (res.orderCreateds.length === QueryPageSize) {
    page += 1
    res = await request(graphURL, query, {
      market: market,
      first: QueryPageSize,
      skip: page * QueryPageSize,
    })
    rawData.orderCreateds = [...rawData.orderCreateds, ...res.orderCreateds]
  }

  return rawData.orderCreateds.map(u => u.account.id)
}

function settleAndReadLocalsMulticallPayload(market: IMarket, account: string): MulticallPayload[] {
  const settle = market.interface.encodeFunctionData('settle', [account])
  const locals = market.interface.encodeFunctionData('locals', [account])
  return [settle, locals].map(callData => ({ callData, allowFailure: false, target: market.address }))
}

function settleAndReadGlobalMulticallPayload(market: IMarket): MulticallPayload[] {
  const settle = market.interface.encodeFunctionData('settle', [constants.AddressZero])
  const global = market.interface.encodeFunctionData('global')
  return [settle, global].map(callData => ({ callData, allowFailure: false, target: market.address }))
}

async function readLocalsForUsers(
  multicall: Contract,
  market: IMarket,
  users_: string[],
  batchsize: number,
  block: string,
) {
  const users = [...users_]
  const allLocals: {
    address: string
    latestId: BigNumber
    currentId: BigNumber
    collateral: BigNumber
    claimable: BigNumber
  }[] = []

  while (users.length > 0) {
    const batchedUsers = users.splice(0, batchsize)
    const multicallPayload = batchedUsers.flatMap(account => settleAndReadLocalsMulticallPayload(market, account))

    const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(multicallPayload, {
      blockTag: block,
    })

    const locals = result
      .map(({ returnData }, i) => {
        if (i % 2) return market.interface.decodeFunctionResult('locals', returnData)
        return undefined
      })
      .filter(notEmpty)
      .map(([local], i) => {
        return {
          address: batchedUsers[i],
          latestId: local.latestId,
          currentId: local.currentId,
          collateral: local.collateral,
          claimable: local.claimable ?? BigNumber.from(0),
        }
      })
    allLocals.push(...locals)
  }

  return allLocals
}
