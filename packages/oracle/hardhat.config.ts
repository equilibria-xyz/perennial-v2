import { dirname } from 'path'
import defaultConfig from '../common/hardhat.default.config'
import './tasks'

const FORK_NETWORK = process.env.FORK_NETWORK || 'mainnet'

const deployPackageDir = dirname(require.resolve('@perennial/v2-deploy/package.json'))
const config = defaultConfig({
  externalDeployments: {
    hardhat: [`${deployPackageDir}/external/deployments/${FORK_NETWORK}`],
  },
  dependencyPaths: [
    '@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol',
    '@equilibria/root/attribute/Kept/Kept_Arbitrum.sol',
    '@perennial/v2-core/contracts/interfaces/IMarketFactory.sol',
    '@perennial/v2-core/contracts/MarketFactory.sol',
    '@perennial/v2-core/contracts/Market.sol',
    '@perennial/v2-core/contracts/types/MarketParameter.sol',
    '@perennial/v2-core/contracts/types/RiskParameter.sol',
  ],
})

export default config
