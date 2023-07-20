import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2-oracle/contracts/interfaces/IPythOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/PowerTwo.sol',
    '@equilibria/root-v2/contracts/UKept.sol',
  ],
})

export default config
