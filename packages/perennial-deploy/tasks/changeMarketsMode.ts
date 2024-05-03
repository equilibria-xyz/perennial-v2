import '@nomiclabs/hardhat-ethers'
import { ethers } from 'hardhat'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { IMarket, IMarketFactory } from '../types/generated'
import { MarketParameterStruct } from '../types/generated/@equilibria/perennial-v2/contracts/Market'

export default task('change-markets-mode', 'Opens or closes all markets; must be run as owner of market factory')
  .addFlag('dry', 'Print list of markets')
  .addFlag('open', 'Update market parameters to set closed=false and settle=false')
  .addFlag('settleOnly', 'Update market parameters to set closed=false and settle=true')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { getNetworkName },
    } = HRE

    const marketFactoryAddress = (await HRE.deployments.get('MarketFactory')).address
    const marketFactory: IMarketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)

    if (args.open && args.settleOnly) {
      console.error('Markets may either be opened or closed; not both')
      return 1
    }

    let txCount = 0

    const markets = await getMarketList(marketFactory)
    for (const marketAddress of markets) {
      const market: IMarket = await ethers.getContractAt('IMarket', marketAddress)
      const [beneficiary, coordinator] = await getMarketBeneficiaryAndCoordinator(market)

      let parameter: MarketParameterStruct = await market.parameter()
      console.log(
        'found market',
        marketAddress,
        'beneficiary',
        beneficiary,
        'coordinator',
        coordinator /*, 'with parameter', parameter*/,
      )

      // TODO: test this bit somehow
      if (args.open && (parameter.closed || parameter.settle)) {
        txCount += 1
        console.log('  market is closed and will be opened')
        if (!args.dry) {
          parameter = { ...parameter, closed: false, settle: false }
          await market.updateParameter(beneficiary, coordinator, parameter)
        }
      } else if (args.settleOnly && !parameter.settle) {
        txCount += 1
        console.log('  market is open and will be put into settle-only mode')
        if (!args.dry) {
          parameter = { ...parameter, closed: false, settle: true }
          console.log('calling updateParameter on', market.address, 'with args', beneficiary, coordinator, parameter)
          await market.updateParameter(beneficiary, coordinator, parameter)
        }
      }
    }
  })

// retrieves market creation events from the market factory to get a list of market addresses
async function getMarketList(marketFactory: IMarketFactory): Promise<string[]> {
  return (await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered(), 0, 'latest')).map(
    event => event.args.instance,
  )
}

async function getMarketBeneficiaryAndCoordinator(market: IMarket): Promise<[any, any]> {
  const beneficiary = (await market.queryFilter(market.filters.BeneficiaryUpdated(), 0, 'latest')).map(
    event => event.args.newBeneficiary,
  )
  const coordinator = (await market.queryFilter(market.filters.CoordinatorUpdated(), 0, 'latest')).map(
    event => event.args.newCoordinator,
  )
  return [beneficiary, coordinator]
}
