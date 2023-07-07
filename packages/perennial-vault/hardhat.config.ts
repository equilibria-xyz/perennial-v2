import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: ['@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleFactory.sol'],
})

export default config
