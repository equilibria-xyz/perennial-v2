import defaultConfig from '../common/hardhat.default.config'
import { solidityOverrides } from '@equilibria/perennial-v2/hardhat.config'

const config = defaultConfig({
  solidityOverrides,
  dependencyPaths: ['import "@equilibria/root/attribute/interfaces/IOracle.sol";'],
})

export default config
