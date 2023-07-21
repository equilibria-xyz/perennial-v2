import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const config = defaultConfig({
  solidityOverrides: {
    'contracts/Market.sol': {
      version: SOLIDITY_VERSION,
      settings: {
        optimizer: {
          enabled: OPTIMIZER_ENABLED,
          runs: 1,
          details: OPTIMIZER_ENABLED
            ? {
                yulDetails: {
                  optimizerSteps:
                    // 'dhfoDgvulfnTUtnIf [xa[r]scLM cCTUtTOntnfDIul Lcul Vcul [j] Tpeul xa[rul] xa[r]cL gvif CTUca[r]LsTOtfDnca[r]Iulc] jmul[jul] VcTOcul jmul', // Compound Steps (confirmed safe)
                    'dhfoDgvulfnTUtnIf[xa[r]EscLMcCTUtTOntnfDIulLculVcul [j]Tpeulxa[rul]xa[r]cLgvifCTUca[r]LSsTOtfDnca[r]Iulc]jmul[jul] VcTOcul jmul', // Seaport Steps (unconfirmed)
                },
              }
            : {},
        },
        viaIR: OPTIMIZER_ENABLED,
      },
    },
  },
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
