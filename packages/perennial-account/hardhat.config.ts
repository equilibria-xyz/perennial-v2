import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const controllerOverrides = {
  version: SOLIDITY_VERSION,
  settings: {
    optimizer: {
      enabled: OPTIMIZER_ENABLED,
      runs: 80000,
    },
    viaIR: OPTIMIZER_ENABLED,
  },
}

export const solidityOverrides = {
  'contracts/Controller_Arbitrum.sol': controllerOverrides,
}

const config = defaultConfig({
  solidityOverrides,
  dependencyPaths: [
    '@perennial/core/contracts/MarketFactory.sol',
    '@perennial/core/contracts/Market.sol',
    '@perennial/verifier/contracts/interfaces/IVerifier.sol',
  ],
})

export default config
