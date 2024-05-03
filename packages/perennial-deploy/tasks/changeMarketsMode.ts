import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { IMarket, IMarketFactory } from '../types/generated'

export default task('change-markets-mode', 'Opens or closes all markets; must be run as owner of market factory')
  .addFlag('dry', 'print-calldata')
  .addFlag('open', 'Update market parameters to set closed=false and settle=false')
  .addFlag('settle', 'Update market parameters to set closed=false and settle=true')
  .addFlag('prevabi', 'Use v2.1.1 Market ABI')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
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

    let txCount = 0

    const markets = await getMarketList(marketFactory)
    for (const marketAddress of markets) {
      const market = args.prevabi
        ? ((await ethers.getContractAt((await getArtifact('MarketV2_1_1')).abi, marketAddress)) as IMarket)
        : await ethers.getContractAt('IMarket', marketAddress)
      const { beneficiary, coordinator } = await getMarketBeneficiaryAndCoordinator(market)

      let parameter = await market.parameter()
      console.log(
        `found market ${marketAddress} beneficiary ${beneficiary} coordinator ${coordinator}. Current state: closed: ${parameter.closed}, settle: ${parameter.settle}`,
      )

      console.log('Updating market parameter')

      parameter = { ...parameter, closed: false, settle: args.settle }
      if (args.dry) {
        await market.connect(owner).callStatic.updateParameter(beneficiary, coordinator, parameter)
        const txData = await market.populateTransaction.updateParameter(beneficiary, coordinator, parameter)
        console.log('')
        console.log(`    Dry run complete
            TX Data:
              ${JSON.stringify({ to: txData.to, data: txData.data, value: txData.value }, undefined, 2)}
        `)
      } else {
        process.stdout.write('    Sending Transaction...')
        const tx = await market.connect(signer).updateParameter(beneficiary, coordinator, parameter)
        await tx.wait()
        console.log('    Transaction complete. Hash:', tx.hash)
      }
      txCount += 1
    }

    console.log(`Updated ${markets.length} markets. Total txs: ${txCount}`)
  })

// retrieves market creation events from the market factory to get a list of market addresses
async function getMarketList(marketFactory: IMarketFactory) {
  return (await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered(), 0, 'latest')).map(
    event => event.args.instance,
  )
}

async function getMarketBeneficiaryAndCoordinator(market: IMarket) {
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
