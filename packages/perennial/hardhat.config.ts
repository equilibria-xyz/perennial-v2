import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const config = defaultConfig({
  solidityOverrides: {
    'contracts/Market.sol': {
      version: SOLIDITY_VERSION,
      settings: {
        optimizer: {
          enabled: OPTIMIZER_ENABLED,
          runs: 1900,
        },
        viaIR: true,
      },
    },
  },
  dependencyPaths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol',
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol',
    '@equilibria/perennial-v2-oracle/contracts/oracle/ReferenceKeeperOracle.sol',
    '@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol',
  ],
})

export default config
