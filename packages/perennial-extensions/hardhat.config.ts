import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2-oracle/contracts/interfaces/IPythOracle.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/PowerTwo.sol',
  ],
})

export default config
