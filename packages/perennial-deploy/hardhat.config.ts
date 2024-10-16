import defaultConfig, { AUTO_IMPERSONATE } from '../common/hardhat.default.config'
import { solidityOverrides as coreOverrides } from '@perennial/core/hardhat.config'
import { solidityOverrides as vaultOverrides } from '@perennial/vault/hardhat.config'
import './tasks'
import { extendEnvironment } from 'hardhat/config'
import { HardhatRuntimeEnvironment, HttpNetworkUserConfig } from 'hardhat/types'

const config = defaultConfig({
  dependencyPaths: [
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/interfaces/IERC20.sol',
    '@equilibria/root/gas/GasOracle.sol',
    '@equilibria/root/gas/GasOracle_Arbitrum.sol',
    '@equilibria/root/gas/GasOracle_Optimism.sol',
    '@perennial/oracle/contracts/payoff/PowerHalf.sol',
    '@perennial/oracle/contracts/payoff/PowerTwo.sol',
    '@perennial/oracle/contracts/payoff/Inverse.sol',
    '@perennial/oracle/contracts/Oracle.sol',
    '@perennial/oracle/contracts/OracleFactory.sol',
    '@perennial/oracle/contracts/keeper/KeeperFactory.sol',
    '@perennial/oracle/contracts/keeper/KeeperOracle.sol',
    '@perennial/oracle/contracts/keeper/KeeperOracle_Migration.sol',
    '@perennial/oracle/contracts/pyth/PythFactory.sol',
    '@perennial/oracle/contracts/metaquants/MetaQuantsFactory.sol',
    '@perennial/core/contracts/Market.sol',
    '@perennial/core/contracts/MarketFactory.sol',
    '@perennial/vault/contracts/Vault.sol',
    '@perennial/vault/contracts/VaultFactory.sol',
    '@perennial/extensions/contracts/MultiInvoker.sol',
    '@perennial/extensions/contracts/MultiInvoker_Arbitrum.sol',
    '@perennial/extensions/contracts/MultiInvoker_Optimism.sol',
    '@perennial/extensions/contracts/Coordinator.sol',
    '@perennial/verifier/contracts/Verifier.sol',
    '@perennial/account/contracts/Account.sol',
    '@perennial/account/contracts/AccountVerifier.sol',
    '@perennial/account/contracts/Controller_Arbitrum.sol',
    '@perennial/order/contracts/OrderVerifier.sol',
    '@perennial/order/contracts/Manager_Arbitrum.sol',
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

// Needed to allow impersonation of accounts for testing against virtual networks
if (AUTO_IMPERSONATE)
  extendEnvironment((hre: HardhatRuntimeEnvironment) => {
    const config = hre.network.config as HttpNetworkUserConfig
    if (config?.url) {
      hre.ethers.provider = new hre.ethers.providers.JsonRpcProvider(config.url)
    }
  })

export default config
