import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: ['@openzeppelin/contracts/interfaces/IERC1271.sol'],
})

export default config
