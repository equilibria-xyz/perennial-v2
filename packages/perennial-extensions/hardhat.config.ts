import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@perennial/core/contracts/MarketFactory.sol',
    '@perennial/core/contracts/Market.sol',
    '@perennial/vault/contracts/Vault.sol',
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
