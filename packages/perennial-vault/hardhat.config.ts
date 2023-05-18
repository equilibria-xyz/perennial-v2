import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2-oracle/contracts/oracle/ChainlinkOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/test/PassthroughChainlinkFeed.sol',
    '@equilibria/perennial-v2/contracts/Market.sol',
  ],
})

export default config
