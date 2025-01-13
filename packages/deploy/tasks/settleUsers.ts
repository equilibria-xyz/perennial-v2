import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { MulticallABI, MulticallAddress } from './multicallUtils'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'
import { getAllMarketUsers, settleMarketUsersPayload } from './settleMarkets'

const SETTLE_MULTICALL_BATCH_SIZE = 150

export default task('settle-users', 'Settles all users across all markets')
  .addFlag('dry', 'Count number of users and transactions required to settle')
  .addFlag('prevabi', 'Use previous ABIs for contract interaction')
  .addOptionalParam('batchsize', 'The multicall batch size', SETTLE_MULTICALL_BATCH_SIZE, types.int)
  .addOptionalParam('buffergas', 'The buffer gas to add to the estimate', 1, types.int)
  .addOptionalParam('timestamp', 'Timestamp to commit prices for', undefined, types.int)
  .addOptionalParam('factoryaddress', 'Address of the PythFactory contract', undefined, types.string)
  .addOptionalParam('commitgaslimit', 'The gas limit for the transaction', undefined, types.int)
  .addOptionalParam('wait', 'Wait for each transaction to be confirmed', 1, types.int)
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

    const factoryAddresses = args.factoryaddress?.split(',') ?? [
      (await get('PythFactory')).address,
      (await get('CryptexFactory')).address,
    ]
    for (const factoryAddress of factoryAddresses) {
      const keeperFactory = await ethers.getContractAt('IKeeperFactory', factoryAddress)
      const oracles = await keeperFactory.queryFilter(keeperFactory.filters.OracleCreated())
      const idsToCommit = oracles.map(oracle => oracle.args.id)

      console.log('[Settle Markets] Committing prices for all oracle ids at timestamp:', args.timestamp)
      await run('commit-price', {
        priceids: idsToCommit.join(','),
        dry: args.dry,
        timestamp: args.timestamp,
        factoryaddress: keeperFactory.address,
        prevabi: args.prevabi,
        gaslimit: args.commitgaslimit,
      })
    }

    console.log('[Settle Markets]  Fetching Users to Settle')
    const { result: marketUsers } = await getAllMarketUsers(graphURL)

    let marketUserCount = 0
    let txCount = 0

    for (const marketAddress in marketUsers) {
      if (args.markets && !args.markets.toLowerCase().split(',').includes(marketAddress.toLowerCase())) {
        console.log('[Settle Markets]    Skipping market', marketAddress)
        continue
      }

      const users = [...marketUsers[marketAddress].values()].slice(args.offset)

      const unMigratedUsers = await getUnmigratedUsers(marketAddress, users, ethers)
      marketUserCount += unMigratedUsers.length

      const market = await ethers.getContractAt('IMarket', marketAddress)

      console.log('[Settle Markets]    Settling', unMigratedUsers.length, 'users to settle in market', marketAddress)

      let batchedUsers
      while (unMigratedUsers.length > 0) {
        // batch multicalls to handle markets with large numbers of users
        batchedUsers = unMigratedUsers.splice(0, batchSize)
        console.log(
          '[Settle Markets]      batch contains',
          batchedUsers.length,
          'users',
          unMigratedUsers.length,
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
            await tx.wait(Number(args.wait))
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

const getUnmigratedUsers = async (marketAddress: string, users: string[], ethers: any) => {
  const unMigratedUsers = []
  for (const user in users) {
    const userPositionsMappingSlot = 17
    const userPositionSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [user, userPositionsMappingSlot]),
    )
    const userPositionData = await ethers.provider.getStorageAt(marketAddress, userPositionSlot)

    // check if user has migrated
    if (parseInt(userPositionData.slice(0, 4), 16) == 0) {
      // if layout is 0
      unMigratedUsers.push(user)
    }
  }
  return unMigratedUsers
}
