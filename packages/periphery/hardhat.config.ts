import { dirname } from 'path'
import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const FORK_NETWORK = process.env.FORK_NETWORK || 'mainnet'

const controllerOverrides = {
  version: SOLIDITY_VERSION,
  settings: {
    optimizer: {
      enabled: OPTIMIZER_ENABLED,
      runs: 1,
    },
    viaIR: OPTIMIZER_ENABLED,
  },
}

const multiInvokerOverrides = {
  version: SOLIDITY_VERSION,
  settings: {
    optimizer: {
      enabled: OPTIMIZER_ENABLED,
      runs: 1,
    },
    viaIR: OPTIMIZER_ENABLED,
  },
}

export const solidityOverrides = {
  'contracts/Controller_Optimism.sol': controllerOverrides,
  'contracts/MultiInvoker.sol': multiInvokerOverrides,
}

const deployPackageDir = dirname(require.resolve('@perennial/v2-deploy/package.json'))
const config = defaultConfig({
  solidityOverrides,
  externalDeployments: {
    hardhat: [`${deployPackageDir}/external/deployments/${FORK_NETWORK}`],
  },
  dependencyPaths: [
    '@openzeppelin/contracts/token/ERC20/ERC20.sol',
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
