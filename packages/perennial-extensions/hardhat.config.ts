import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const config = defaultConfig({
  // solidityOverrides: {
  //     'contracts/': {
  //         version: SOLIDITY_VERSION,
  //         settings: {
  //           optimizer: {
  //             enabled: OPTIMIZER_ENABLED,
  //             runs: 1900,
  //           },
  //           viaIR: true,
  //         },
  //     },
  // },
  dependencyPaths: ['@equilibria/perennial-v2/contracts/Market.sol'],
})

export default config
