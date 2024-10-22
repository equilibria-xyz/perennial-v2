import defaultConfig from '../common/hardhat.default.config'
import { solidityOverrides as coreOverrides } from '@perennial/core/hardhat.config'
import { solidityOverrides as vaultOverrides } from '@perennial/vault/hardhat.config'
import './tasks'

const config = defaultConfig({
  dependencyPaths: [
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/interfaces/IERC20.sol',
    '@perennial/oracle/contracts/payoff/PowerHalf.sol',
    '@perennial/oracle/contracts/payoff/PowerTwo.sol',
    '@perennial/oracle/contracts/payoff/Inverse.sol',
    '@perennial/oracle/contracts/Oracle.sol',
    '@perennial/oracle/contracts/OracleFactory.sol',
    '@perennial/oracle/contracts/keeper/KeeperFactory.sol',
    '@perennial/oracle/contracts/keeper/KeeperOracle.sol',
    '@perennial/oracle/contracts/pyth/PythFactory.sol',
    '@perennial/core/contracts/Market.sol',
    '@perennial/core/contracts/MarketFactory.sol',
    '@perennial/vault/contracts/Vault.sol',
    '@perennial/vault/contracts/VaultFactory.sol',
    '@perennial/periphery/contracts/MultiInvoker.sol',
    '@perennial/periphery/contracts/MultiInvoker_Arbitrum.sol',
    '@perennial/periphery/contracts/MultiInvoker_Optimism.sol',
    '@perennial/periphery/contracts/Coordinator.sol',
  ],
  solidityOverrides: {
    '@perennial/core/contracts/Market.sol': {
      ...coreOverrides['contracts/Market.sol'],
    },
    '@perennial/vault/contracts/Vault.sol': {
      ...vaultOverrides['contracts/Vault.sol'],
    },
  },
})

export default config
