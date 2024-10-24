import defaultConfig from '../common/hardhat.default.config'
import './tasks'

const config = defaultConfig({
  dependencyPaths: [
    '@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol',
    '@equilibria/root/attribute/Kept/Kept_Arbitrum.sol',
    '@perennial/core/contracts/interfaces/IMarketFactory.sol',
    '@perennial/core/contracts/MarketFactory.sol',
    '@perennial/core/contracts/Market.sol',
    '@perennial/core/contracts/types/MarketParameter.sol',
    '@perennial/core/contracts/types/RiskParameter.sol',
  ],
})

export default config
