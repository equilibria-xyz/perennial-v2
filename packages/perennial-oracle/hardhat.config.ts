import defaultConfig from '../common/hardhat.default.config'
import './tasks'

const config = defaultConfig({
  dependencyPaths: [
    '@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol',
    '@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol',
    '@equilibria/perennial-v2/contracts/MarketFactory.sol',
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2/contracts/types/MarketParameter.sol',
    '@equilibria/perennial-v2/contracts/types/RiskParameter.sol',
  ],
})

export default config
