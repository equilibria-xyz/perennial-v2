import defaultConfig, { AUTO_IMPERSONATE } from '../common/hardhat.default.config'
import { solidityOverrides as coreOverrides } from '@perennial/v2-core/hardhat.config'
import { solidityOverrides as vaultOverrides } from '@perennial/v2-vault/hardhat.config'
import { solidityOverrides as peripheryOverrides } from '@perennial/v2-periphery/hardhat.config'
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
    '@perennial/v2-oracle/contracts/payoff/PowerHalf.sol',
    '@perennial/v2-oracle/contracts/payoff/PowerTwo.sol',
    '@perennial/v2-oracle/contracts/payoff/Inverse.sol',
    '@perennial/v2-oracle/contracts/Oracle.sol',
    '@perennial/v2-oracle/contracts/OracleFactory.sol',
    '@perennial/v2-oracle/contracts/keeper/KeeperFactory.sol',
    '@perennial/v2-oracle/contracts/keeper/KeeperOracle.sol',
    '@perennial/v2-oracle/contracts/pyth/PythFactory.sol',
    '@perennial/v2-oracle/contracts/metaquants/MetaQuantsFactory.sol',
    '@perennial/v2-core/contracts/Market.sol',
    '@perennial/v2-core/contracts/MarketFactory.sol',
    '@perennial/v2-vault/contracts/MakerVault.sol',
    '@perennial/v2-vault/contracts/VaultFactory.sol',
    '@perennial/v2-periphery/contracts/CollateralAccounts/Account.sol',
    '@perennial/v2-periphery/contracts/CollateralAccounts/AccountVerifier.sol',
    '@perennial/v2-periphery/contracts/CollateralAccounts/Controller_Arbitrum.sol',
    '@perennial/v2-periphery/contracts/Coordinator/Coordinator.sol',
    '@perennial/v2-periphery/contracts/MultiInvoker/MultiInvoker.sol',
    '@perennial/v2-periphery/contracts/MultiInvoker/MultiInvoker_Arbitrum.sol',
    '@perennial/v2-periphery/contracts/MultiInvoker/MultiInvoker_Optimism.sol',
    '@perennial/v2-periphery/contracts/TriggerOrders/OrderVerifier.sol',
    '@perennial/v2-periphery/contracts/TriggerOrders/Manager_Arbitrum.sol',
  ],
  solidityOverrides: {
    '@perennial/v2-core/contracts/Market.sol': {
      ...coreOverrides['contracts/Market.sol'],
    },
    '@perennial/v2-vault/contracts/MakerVault.sol': {
      ...vaultOverrides['contracts/MakerVault.sol'],
    },
    '@perennial/v2-periphery/contracts/MultiInvoker.sol': {
      ...peripheryOverrides['contracts/MultiInvoker.sol'],
    },
    '@perennial/v2-periphery/contracts/MultiInvoker_Arbitrum.sol': {
      ...peripheryOverrides['contracts/MultiInvoker_Arbitrum.sol'],
    },
    '@perennial/v2-periphery/contracts/MultiInvoker_Optimism.sol': {
      ...peripheryOverrides['contracts/MultiInvoker_Optimism.sol'],
    },
    '@perennial/v2-periphery/contracts/Controller_Arbitrum.sol': {
      ...peripheryOverrides['contracts/Controller_Arbitrum.sol'],
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
