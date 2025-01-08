import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

export const solidityOverrides = {
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
                  // 'dhfoDgvulfnTUtnIf [xa[r]scLM cCTUtTOntnfDIul Lcul Vcul [j] Tpeul xa[rul] xa[r]cL gvif CTUca[r]LsTOtfDnca[r]Iulc] jmul[jul] VcTOcul jmul', // https://github.com/compound-finance/comet/blob/main/hardhat.config.ts#L176C11-L180C13
                  'dhfoDgvulfnTUtnIf[xa[r]EscLMcCTUtTOntnfDIulLculVcul [j]Tpeulxa[rul]xa[r]cLgvifCTUca[r]LSsTOtfDnca[r]Iulc]jmul[jul] VcTOcul jmul', // https://github.com/ProjectOpenSea/seaport/blob/main/hardhat.config.ts#L60C10-L60C137
              },
            }
          : {},
      },
      viaIR: OPTIMIZER_ENABLED,
    },
  },
}

const config = defaultConfig({
  solidityOverrides,
  dependencyPaths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol',
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol',
    '@openzeppelin/contracts/interfaces/IERC1271.sol',
    '@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol',
  ],
})

export default config
