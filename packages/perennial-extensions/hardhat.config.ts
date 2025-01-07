import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const multiInvokerOverrides = {
  version: SOLIDITY_VERSION,
  settings: {
    optimizer: {
      enabled: OPTIMIZER_ENABLED,
      runs: 27500,
    },
    viaIR: OPTIMIZER_ENABLED,
  },
}

export const solidityOverrides = {
  'contracts/MultiInvoker.sol': multiInvokerOverrides,
  'contracts/MultiInvoker_Arbitrum.sol': multiInvokerOverrides,
  'contracts/MultiInvoker_Optimism.sol': {
    ...multiInvokerOverrides,
    settings: {
      ...multiInvokerOverrides.settings,
      optimizer: {
        ...multiInvokerOverrides.settings.optimizer,
        runs: 3250,
      },
    },
  },
}
const config = defaultConfig({
  solidityOverrides,
  dependencyPaths: [
    '@perennial/core/contracts/MarketFactory.sol',
    '@perennial/core/contracts/Market.sol',
    '@perennial/vault/contracts/MakerVault.sol',
    '@perennial/vault/contracts/VaultFactory.sol',
    '@perennial/oracle/contracts/interfaces/IKeeperOracle.sol',
    '@perennial/oracle/contracts/keeper/KeeperOracle.sol',
    '@perennial/oracle/contracts/pyth/PythFactory.sol',
    '@perennial/oracle/contracts/Oracle.sol',
    '@perennial/oracle/contracts/OracleFactory.sol',
    '@perennial/oracle/contracts/payoff/PowerTwo.sol',
    '@equilibria/root/attribute/Kept/Kept.sol',
  ],
})

export default config
