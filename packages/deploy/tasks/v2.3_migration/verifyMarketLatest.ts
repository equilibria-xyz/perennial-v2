import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'

export default task(
  'v2_3_verify-market-latest',
  "Verifies that the latest price from the new oracle is later than the market's oracle().latest().timestamp",
).setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
  console.log('[v2.3 Verify Market Latest] Running Verify Market Latest Task')
  const {
    ethers,
    deployments: { get },
  } = HRE

  const oracleFactory = await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)
  const oracleEvents = await oracleFactory.queryFilter(oracleFactory.filters.OracleCreated())

  const pythFactory = await ethers.getContractAt('PythFactory', (await get('PythFactory')).address)
  const cryptexFactory = await ethers.getContractAt('MetaQuantsFactory', (await get('CryptexFactory')).address)

  const earlierOracleIDs: string[] = []

  for (const oracleEvent of oracleEvents) {
    console.log(`[v2.3 Verify Market Latest]\tVerifying oracle ${oracleEvent.args.id}`)
    const oracleContract = await ethers.getContractAt('Oracle', oracleEvent.args.oracle)
    const latest = await oracleContract.latest()

    let newOracle = await pythFactory.oracles(oracleEvent.args.id)
    if (newOracle === ethers.constants.AddressZero) {
      newOracle = await cryptexFactory.oracles(oracleEvent.args.id)
    }
    if (newOracle === ethers.constants.AddressZero) {
      console.warn(`[v2.3 Verify Market Latest]\t\tOracle ${oracleEvent.args.id} has no new oracle`)
      continue
    }

    const newOracleContract = await ethers.getContractAt('Oracle', newOracle)
    const newLatest = await newOracleContract.latest()

    if (latest.timestamp >= newLatest.timestamp) {
      console.warn(
        `[v2.3 Verify Market Latest]\t\tOracle ${oracleEvent.args.id} has a new oracle with a timestamp earlier than the old oracle`,
      )
      earlierOracleIDs.push(oracleEvent.args.id)
    }
  }

  console.log(`[v2.3 Verify Market Latest]\tDone`)
  return earlierOracleIDs
})
