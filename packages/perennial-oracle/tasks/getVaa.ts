import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import fetch from 'isomorphic-fetch'

const HERMES_ENDPOINT = 'https://hermes.pyth.network/api/'

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
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    // choose/validate timestamp to request
    let timestamp: number
    const currentTimestamp = Math.floor(Date.now() / 1000)
    if (args.timestamp === undefined) {
      timestamp = currentTimestamp - 15 // 15 seconds ago; current time generates 404 response
    } else if (args.timestamp >= currentTimestamp) {
      console.error('Timestamp must preceed current time', currentTimestamp)
      return 1
    } else {
      timestamp = args.timestamp
    }

    // make a request to Pyth Hermes API
    const request = `${HERMES_ENDPOINT}get_vaa?id=${args.priceFeed}&publish_time=${timestamp}`
    const response = await fetch(request, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    let encodedVaa: string
    if (response.ok) {
      encodedVaa = (await response.json()).vaa
    } else {
      console.error('Hermes API request failed:', response.status)
      return 1
    }

    console.log('0x' + Buffer.from(encodedVaa, 'base64').toString('hex'))
  })
