import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol',
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol',
    '@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol',
  ],
})

export default config
