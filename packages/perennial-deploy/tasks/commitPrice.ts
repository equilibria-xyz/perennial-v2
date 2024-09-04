import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js'
import { utils } from 'ethers'

const PYTH_ENDPOINT = 'https://hermes.pyth.network'

export default task('commit-price', 'Commits a price for the given price ids')
  .addParam('priceids', 'The price ids to commit (comma separated)', '', types.string)
  .addFlag('dry', 'Do not commit prices, print out calldata instead')
  .addOptionalParam('timestamp', 'The timestamp to query for prices', undefined, types.int)
  .addOptionalParam('factoryaddress', 'The address of the keeper oracle factory', undefined, types.string)
  .addOptionalParam('gaslimit', 'The gas limit for the transaction', undefined, types.int)
  .setAction(
    async (
      { priceids: priceIds_, timestamp, dry, factoryaddress, gaslimit }: TaskArguments,
      HRE: HardhatRuntimeEnvironment,
    ) => {
      if (!priceIds_) throw new Error('No Price ID provided')
      const priceIds = priceIds_.split(',')
      if (!priceIds.length) throw new Error('No Price ID provided')

      const {
        ethers,
        deployments: { get },
      } = HRE

      const commitments: { action: number; args: string }[] = []

      console.log('Gathering commitments for priceIds:', priceIds.join(','), 'at timestamp', timestamp)
      const pythFactory = await ethers.getContractAt(
        'IKeeperFactory',
        factoryaddress ?? (await get('PythFactory')).address,
      )
      console.log('Using factory at:', pythFactory.address)
      const minValidTime = (await pythFactory.callStatic.parameter()).validFrom
      for (const priceId of priceIds) {
        const pyth = new EvmPriceServiceConnection(PYTH_ENDPOINT, { priceFeedRequestConfig: { binary: true } })
        const underlyingId = await pythFactory.callStatic.toUnderlyingId(priceId)

        const vaa = await getRecentVaa({
          pyth,
          feedIds: [{ providerId: underlyingId, minValidTime: minValidTime.toBigInt() }],
          timestamp,
        })

        commitments.push(
          buildCommitPrice({
            ...vaa[0],
            oracleProviderFactory: pythFactory.address,
            value: 1n,
            ids: [priceId],
            version: BigInt(vaa[0].publishTime) - minValidTime.toBigInt(),
            revertOnFailure: true,
          }),
        )
      }

      const multiInvoker = await ethers.getContractAt('IMultiInvoker', (await get('MultiInvoker')).address)

      if (dry) {
        console.log('Dry run, not committing. Calldata')
        console.log(multiInvoker.interface.encodeFunctionData('invoke((uint8,bytes)[])', [commitments]))
        return true
      } else {
        console.log('Committing VAAs')
        const { hash } = await multiInvoker['invoke((uint8,bytes)[])'](commitments, {
          value: commitments.length,
          gasLimit: gaslimit,
        })
        console.log('VAA committed. Hash:', hash)
        return hash
      }
    },
  )

const getRecentVaa = async ({
  pyth,
  feedIds,
  timestamp,
}: {
  pyth: EvmPriceServiceConnection
  feedIds: { providerId: string; minValidTime: bigint }[]
  timestamp?: number
}) => {
  if (timestamp && feedIds.length > 1) throw new Error('Cannot query multiple feeds with a timestamp')

  const priceFeeds = timestamp
    ? [await pyth.getPriceFeed(feedIds[0].providerId, timestamp)]
    : await pyth.getLatestPriceFeeds(feedIds.map(({ providerId }) => providerId))
  if (!priceFeeds) throw new Error('No price feeds found')

  return priceFeeds.map(priceFeed => {
    const vaa = priceFeed.getVAA()
    if (!vaa) throw new Error('No VAA found')

    const publishTime = priceFeed.getPriceUnchecked().publishTime
    const minValidTime = feedIds.find(({ providerId }) => `0x${providerId}` === priceFeed.id)?.minValidTime

    return {
      feedId: priceFeed.id,
      vaa: `0x${Buffer.from(vaa, 'base64').toString('hex')}`,
      publishTime,
      version: BigInt(publishTime) - (minValidTime ?? 4n),
    }
  })
}

const buildCommitPrice = ({
  oracleProviderFactory,
  version,
  value,
  ids,
  vaa,
  revertOnFailure,
}: {
  oracleProviderFactory: string
  version: bigint
  value: bigint
  ids: string[]
  vaa: string
  revertOnFailure: boolean
}): { action: number; args: string } => ({
  action: 6,
  args: utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
    [oracleProviderFactory, value, ids, version, vaa, revertOnFailure],
  ),
})
