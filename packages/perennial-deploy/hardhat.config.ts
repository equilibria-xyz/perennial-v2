import defaultConfig from '../common/hardhat.default.config'
import { solidityOverrides as coreOverrides } from '@equilibria/perennial-v2/hardhat.config'
import { solidityOverrides as vaultOverrides } from '@equilibria/perennial-v2-vault/hardhat.config'
import './tasks'

const config = defaultConfig({
  dependencyPaths: [
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/interfaces/IERC20.sol',
    '@equilibria/perennial-v2-oracle/contracts/payoff/PowerHalf.sol',
    '@equilibria/perennial-v2-oracle/contracts/payoff/PowerTwo.sol',
    '@equilibria/perennial-v2-oracle/contracts/Oracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/OracleFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/keeper/KeeperOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory_Arbitrum.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory_Optimism.sol',
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2/contracts/MarketFactory.sol',
    '@equilibria/perennial-v2-vault/contracts/Vault.sol',
    '@equilibria/perennial-v2-vault/contracts/VaultFactory.sol',
    '@equilibria/perennial-v2-extensions/contracts/MultiInvoker.sol',
    '@equilibria/perennial-v2-extensions/contracts/MultiInvoker_Arbitrum.sol',
    '@equilibria/perennial-v2-extensions/contracts/MultiInvoker_Optimism.sol',
  ],
  solidityOverrides: {
    '@equilibria/perennial-v2/contracts/Market.sol': {
      ...coreOverrides['contracts/Market.sol'],
    },
    '@equilibria/perennial-v2-vault/contracts/Vault.sol': {
      ...vaultOverrides['contracts/Vault.sol'],
    },
  },
})

export default config
