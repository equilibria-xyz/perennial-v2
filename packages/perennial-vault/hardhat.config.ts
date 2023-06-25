import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: ['@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleFactory.sol'],
})

export default config
