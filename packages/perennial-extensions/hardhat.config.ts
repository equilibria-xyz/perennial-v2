import defaultConfig, { SOLIDITY_VERSION, OPTIMIZER_ENABLED } from '../common/hardhat.default.config'

export const solidityOverrides = {
  'contracts/MultiInvoker.sol': {
    version: SOLIDITY_VERSION,
    settings: {
      optimizer: {
        enabled: true,
        runs: 1650,
      },
      viaIR: true,
    },
  },
}

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2-vault/contracts/Vault.sol',
    '@equilibria/perennial-v2-vault/contracts/VaultFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/interfaces/IPythOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/Oracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/OracleFactory.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/PowerTwo.sol',
    '@equilibria/perennial-v2-payoff/contracts/PayoffFactory.sol',
    '@equilibria/root/attribute/Kept/Kept.sol',
  ],
})

export default config
