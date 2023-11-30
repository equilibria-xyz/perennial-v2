import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js'
import { utils } from 'ethers'

const PYTH_ENDPOINT = 'https://hermes.pyth.network'

export default task('commit-price', 'Commits a price for the given price ids')
  .addParam('priceids', 'The price ids to commit (comma separated)', '', types.string)
  .addFlag('dry', 'Do not commit prices, print out calldata instead')
  .setAction(async ({ priceids: priceIds_, dry }: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    if (!priceIds_) throw new Error('No Price ID provided')
    const priceIds = priceIds_.split(',')
    if (!priceIds.length) throw new Error('No Price ID provided')

    const {
      ethers,
      deployments: { get },
    } = HRE

    const commitments: { action: number; args: string }[] = []

    for (const priceId of priceIds) {
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

      commitments.push(
        buildCommitPrice({
          ...vaa[0],
          oracle: pythProvider.address,
          value: 1n,
          index: versionListLength.toBigInt(),
          revertOnFailure: false,
        }),
      )
    }

    const multiInvoker = await ethers.getContractAt('IMultiInvoker', (await get('MultiInvoker')).address)

    if (dry) {
      console.log('Dry run, not committing. Calldata')
      console.log(multiInvoker.interface.encodeFunctionData('invoke', [commitments]))
    } else {
      console.log('Committing VAAs')
      const { hash } = await multiInvoker.invoke(commitments, { value: commitments.length })
      console.log('VAA committed. Hash:', hash)
    }
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

const buildCommitPrice = ({
  oracle,
  version,
  value,
  index,
  vaa,
  revertOnFailure,
}: {
  oracle: string
  version: bigint
  value: bigint
  index: bigint
  vaa: string
  revertOnFailure: boolean
}): { action: number; args: string } => ({
  action: 6,
  args: utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'uint256', 'uint256', 'bytes', 'bool'],
    [oracle, value, index, version, vaa, revertOnFailure],
  ),
})
