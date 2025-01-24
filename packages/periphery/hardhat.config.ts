import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const controllerOverrides = {
  version: SOLIDITY_VERSION,
  settings: {
    optimizer: {
      enabled: OPTIMIZER_ENABLED,
      runs: 80000,
    },
    viaIR: OPTIMIZER_ENABLED,
  },
}

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
  'contracts/Controller_Arbitrum.sol': controllerOverrides,
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
    '@perennial/v2-core/contracts/MarketFactory.sol',
    '@perennial/v2-core/contracts/Market.sol',
    '@perennial/v2-vault/contracts/MakerVault.sol',
    '@perennial/v2-vault/contracts/SolverVault.sol',
    '@perennial/v2-vault/contracts/VaultFactory.sol',
    '@perennial/v2-oracle/contracts/interfaces/IKeeperOracle.sol',
    '@perennial/v2-oracle/contracts/keeper/KeeperOracle.sol',
    '@perennial/v2-oracle/contracts/pyth/PythFactory.sol',
    '@perennial/v2-oracle/contracts/Oracle.sol',
    '@perennial/v2-oracle/contracts/OracleFactory.sol',
    '@perennial/v2-oracle/contracts/payoff/PowerTwo.sol',
    '@equilibria/root/attribute/Kept/Kept.sol',
  ],
})

export default config
