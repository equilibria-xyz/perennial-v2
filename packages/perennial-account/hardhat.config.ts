import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2/contracts/MarketFactory.sol',
    '@equilibria/perennial-v2/contracts/Market.sol',
  ],
})

export default config
