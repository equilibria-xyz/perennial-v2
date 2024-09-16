import defaultConfig, { AUTO_IMPERSONATE } from '../common/hardhat.default.config'
import { solidityOverrides as coreOverrides } from '@equilibria/perennial-v2/hardhat.config'
import { solidityOverrides as vaultOverrides } from '@equilibria/perennial-v2-vault/hardhat.config'
import './tasks'
import { extendEnvironment } from 'hardhat/config'
import { HardhatRuntimeEnvironment, HttpNetworkUserConfig } from 'hardhat/types'

const config = defaultConfig({
  dependencyPaths: [
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/interfaces/IERC20.sol',
    '@equilibria/perennial-v2-oracle/contracts/payoff/PowerHalf.sol',
    '@equilibria/perennial-v2-oracle/contracts/payoff/PowerTwo.sol',
    '@equilibria/perennial-v2-oracle/contracts/payoff/Inverse.sol',
    '@equilibria/perennial-v2-oracle/contracts/Oracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/OracleFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/keeper/KeeperFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/keeper/KeeperOracle.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory_Arbitrum.sol',
    '@equilibria/perennial-v2-oracle/contracts/pyth/PythFactory_Optimism.sol',
    '@equilibria/perennial-v2-oracle/contracts/metaquants/MetaQuantsFactory.sol',
    '@equilibria/perennial-v2-oracle/contracts/metaquants/MetaQuantsFactory_Arbitrum.sol',
    '@equilibria/perennial-v2-oracle/contracts/metaquants/MetaQuantsFactory_Optimism.sol',
    '@equilibria/perennial-v2/contracts/Market.sol',
    '@equilibria/perennial-v2/contracts/MarketFactory.sol',
    '@equilibria/perennial-v2-vault/contracts/Vault.sol',
    '@equilibria/perennial-v2-vault/contracts/VaultFactory.sol',
    '@equilibria/perennial-v2-extensions/contracts/MultiInvoker.sol',
    '@equilibria/perennial-v2-extensions/contracts/MultiInvoker_Arbitrum.sol',
    '@equilibria/perennial-v2-extensions/contracts/MultiInvoker_Optimism.sol',
    '@equilibria/perennial-v2-extensions/contracts/Coordinator.sol',
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

// Needed to allow impersonation of accounts for testing against virtual networks
if (AUTO_IMPERSONATE)
  extendEnvironment((hre: HardhatRuntimeEnvironment) => {
    const config = hre.network.config as HttpNetworkUserConfig
    if (config?.url) {
      hre.ethers.provider = new hre.ethers.providers.JsonRpcProvider(config.url)
    }
  })

export default config
