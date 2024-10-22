import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: ['@perennial/core/contracts/Market.sol', '@perennial/core/contracts/MarketFactory.sol'],
})

export default config
