import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js'

const PYTH_ENDPOINT = 'https://hermes.pyth.network'

export default task('commit-price', 'Commits a price for the given price id')
  .addParam('priceid', 'The price id to commit', '', types.string)
  .setAction(async ({ priceid: priceId }: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    if (!priceId) throw new Error('No Price ID provided')
    const {
      ethers,
      deployments: { get },
    } = HRE

    const oracleFactory = await ethers.getContractAt('IOracleFactory', (await get('OracleFactory')).address)
    const oracle = await ethers.getContractAt('Oracle', await oracleFactory.oracles(priceId))
    const oracleGlobal = await oracle.callStatic.global()
    const pythProvider = await ethers.getContractAt(
      'IPythOracle',
      (
        await oracle.callStatic.oracles(oracleGlobal.current)
      ).provider,
    )

    const pyth = new EvmPriceServiceConnection(PYTH_ENDPOINT, { priceFeedRequestConfig: { binary: true } })
    const [minValidTime, versionListLength] = await Promise.all([
      pythProvider.callStatic.MIN_VALID_TIME_AFTER_VERSION(),
      pythProvider.callStatic.versionListLength(),
    ])

    const vaa = await getRecentVaa({
      pyth,
      feedIds: [{ providerId: priceId, minValidTime: minValidTime.toBigInt() }],
    })

    console.log('Committing VAA')
    const { hash } = await pythProvider.commit(versionListLength, vaa[0].version, vaa[0].vaa, { value: 1n })
    console.log('VAA committed. Hash:', hash)
  })

const getRecentVaa = async ({
  pyth,
  feedIds,
}: {
  pyth: EvmPriceServiceConnection
  feedIds: { providerId: string; minValidTime: bigint }[]
}) => {
  const priceFeeds = await pyth.getLatestPriceFeeds(feedIds.map(({ providerId }) => providerId))
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
