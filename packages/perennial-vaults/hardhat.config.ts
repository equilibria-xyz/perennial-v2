import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: ['@equilibria/perennial-v2-oracle/contracts/test/PassthroughChainlinkFeed.sol'],
})

export default config
