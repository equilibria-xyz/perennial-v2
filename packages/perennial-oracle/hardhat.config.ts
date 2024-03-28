import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol',
    '@equilibria/perennial-v2/contracts/MarketFactory.sol',
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2/contracts/types/MarketParameter.sol',
    '@equilibria/perennial-v2/contracts/types/RiskParameter.sol',
  ],
})

export default config
