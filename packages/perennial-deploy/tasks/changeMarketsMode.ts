import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { IMarket, IMarketFactory } from '../types/generated'

export default task('change-markets-mode', 'Opens or closes all markets; must be run as owner of market factory')
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('open', 'Update market parameters to set closed=false and settle=false')
  .addFlag('settle', 'Update market parameters to set closed=false and settle=true')
  .addFlag('prevabi', 'Use v2.2 Market ABI')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Change Markets Mode] Running Change Markets Mode Task')
    const {
      ethers,
      deployments: { get, getArtifact },
    } = HRE

    const marketFactoryAddress = (await get('MarketFactory')).address
    const marketFactory: IMarketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)
    const owner = await marketFactory.owner()
    const signer = await ethers.getSigner(owner)

    if (args.open && args.settle) {
      console.error('Markets may either be opened or closed; not both')
      return 1
    }

    const markets = await getMarketList(marketFactory)
    const timelockPayloads = {
      targets: [] as (string | undefined)[],
      values: [] as (string | undefined)[],
      payloads: [] as (string | undefined)[],
      predecessor: ethers.constants.HashZero,
      salt: ethers.utils.id(Math.random().toString()),
    }
    for (const marketAddress of markets) {
      const market = args.prevabi
        ? await ethers.getContractAt((await getArtifact('MarketV2_2')).abi, marketAddress)
        : await ethers.getContractAt('IMarket', marketAddress)

      let parameter = await market.parameter()
      console.log(
        `[Change Markets Mode]    Found market ${marketAddress}. Current state: closed: ${parameter.closed}, settle: ${parameter.settle}`,
      )

      console.log('[Change Markets Mode]    Updating market parameter')

      parameter = { ...parameter, closed: false, settle: args.settle }
      const updateArgs = args.prevabi
        ? [ethers.constants.AddressZero, ethers.constants.AddressZero, parameter]
        : [parameter]
      if (args.dry || args.timelock) {
        await market.connect(owner).callStatic.updateParameter.apply(null, updateArgs)
        console.log('[Change Markets Mode]  Dry run successful')
        const txData = await market.populateTransaction.updateParameter.apply(null, updateArgs)
        timelockPayloads.targets.push(txData.to)
        timelockPayloads.values.push(txData.value?.toString() ?? '0')
        timelockPayloads.payloads.push(txData.data)
      } else {
        process.stdout.write('[Change Markets Mode]    Sending Transaction...')
        const tx = await market.connect(signer).updateParameter.apply(null, updateArgs)
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }

    if (args.timelock) {
      console.log('[Change Markets Mode]  Timelock payload:')
      console.log(`[Change Markets Mode]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    }
    console.log('[Change Markets Mode] Done.')
  })

// retrieves market creation events from the market factory to get a list of market addresses
async function getMarketList(marketFactory: IMarketFactory) {
  return (await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered(), 0, 'latest')).map(
    event => event.args.instance,
  )
}

export async function getMarketBeneficiaryAndCoordinator(
  market: IMarket,
): Promise<{ beneficiary: string; coordinator: string }> {
  const beneficiary = (await market.queryFilter(market.filters.BeneficiaryUpdated(), 0, 'latest')).sort(
    (a, b) => b.blockNumber - a.blockNumber,
  )[0]
  const coordinator = (await market.queryFilter(market.filters.CoordinatorUpdated(), 0, 'latest')).sort(
    (a, b) => b.blockNumber - a.blockNumber,
  )[0]
  return {
    beneficiary: beneficiary.args.newBeneficiary,
    coordinator: coordinator.args.newCoordinator,
  }
}
