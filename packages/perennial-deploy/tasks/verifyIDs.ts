import '@nomiclabs/hardhat-ethers'
import { BigNumber } from 'ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'
import { getAllMarketUsers } from './settleMarkets'
import { IMarket } from '../types/generated'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'

const DEFAULT_BATCH_SIZE = 500

export default task('verify-ids', 'Verifies that all markets and users have equal latest and current IDs')
  .addFlag('prevabi', 'Use previous ABIs for contract interaction')
  .addFlag('outputmismatch', 'Output mismatched addresses')
  .addOptionalParam('batchsize', 'The multicall batch size', DEFAULT_BATCH_SIZE, types.int)
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Verify IDs] Running Verify IDs Task')
    const {
      ethers,
      deployments: { getNetworkName, getArtifact },
    } = HRE

    const graphURL = getSubgraphUrlFromEnvironment(getNetworkName())
    if (!graphURL) {
      console.error('Subgraph URL environment variable unknown for this network')
      return 1
    }

    const multicall = new ethers.Contract(MulticallAddress, MulticallABI, ethers.provider).connect(
      (await ethers.getSigners())[0],
    )

    const { result: marketUsers } = await getAllMarketUsers(graphURL)
    const requireSettles: { market: string; address: string }[] = []

    for (const marketAddress in marketUsers) {
      const market = args.prevabi
        ? ((await ethers.getContractAt((await getArtifact('MarketV2_2')).abi, marketAddress)) as IMarket)
        : await ethers.getContractAt('IMarket', marketAddress)

      console.log('[Verify IDs] Verifying IDs for market', marketAddress)
      const global = await market.global()
      const users = [...marketUsers[marketAddress].values()]
      const allLocals: { address: string; latestId: BigNumber; currentId: BigNumber }[] = []

      while (users.length > 0) {
        // batch multicalls to handle markets with large numbers of users
        const batchedUsers = users.splice(0, args.batchsize)

        const multicallPayload = readLocalsPayload(market, batchedUsers)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )

        const locals = result
          .map(({ returnData }) => market.interface.decodeFunctionResult('locals', returnData))
          .map((local, i) => ({
            address: batchedUsers[i],
            latestId: local[0].latestId,
            currentId: local[0].currentId,
          }))
        allLocals.push(...locals)
      }

      let hasMismatch = false
      for (const { address, latestId, currentId } of allLocals) {
        if (!latestId.eq(currentId)) {
          hasMismatch = true
          requireSettles.push({ market: marketAddress, address })
          if (args.outputmismatch)
            console.error(
              `[Verify IDs]    Market ${marketAddress} user ${address}: latestId ${latestId}, currentId ${currentId}`,
            )
        }
      }

      if (!global.latestId.eq(global.currentId))
        requireSettles.push({ market: marketAddress, address: ethers.constants.AddressZero })

      console.log(
        `[Verify IDs]  Market ${marketAddress}: Globals Match: ${global.latestId.eq(
          global.currentId,
        )}. Locals Match: ${!hasMismatch}`,
      )
    }

    console.log('[Verify IDs] Done.')
    return requireSettles
  })

function readLocalsPayload(market: IMarket, users: string[]): MulticallPayload[] {
  const locals = users.map(user => market.interface.encodeFunctionData('locals', [user]))
  return locals.map(callData => ({ callData, allowFailure: false, target: market.address }))
}
