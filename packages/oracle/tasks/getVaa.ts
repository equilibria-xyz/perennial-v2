import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js'

const PYTH_ENDPOINT = 'https://hermes.pyth.network'

// task helps retrieve VAAs for integration/validation testing purposes
export default task('get-vaa', 'Retrieves and decodes a Pyth Validator Action Approval (VAA)')
  .addParam(
    'priceFeed',
    'Identifies the Pyth feed from which data is desired; see https://pyth.network/developers/price-feed-ids',
  )
  .addOptionalParam(
    'timestamp',
    'Unix UTC timestamp to request; should be at least a few seconds old; defaults to 15 seconds ago',
  )
  .setAction(async (args: TaskArguments) => {
    // choose/validate timestamp to request
    let timestamp: number
    const currentTimestamp = Math.floor(Date.now() / 1000)
    if (args.timestamp === undefined) {
      timestamp = currentTimestamp - 15 // 15 seconds ago; current time generates 404 response
    } else if (args.timestamp >= currentTimestamp) {
      throw new Error('Timestamp must preceed current time')
    } else {
      timestamp = args.timestamp
    }

    const pyth = new EvmPriceServiceConnection(PYTH_ENDPOINT, { priceFeedRequestConfig: { binary: true } })
    const pythPriceFeed = await pyth.getPriceFeed(args.priceFeed, timestamp)
    console.log(pythPriceFeed)
    const encodedVaa = await pythPriceFeed.getVAA()
    if (!encodedVaa) throw new Error('Failed to retrieve VAA')

    console.log('vaa for timestamp', timestamp)
    console.log(`0x${Buffer.from(encodedVaa, 'base64').toString('hex')}`)
  })
