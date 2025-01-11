import defaultConfig, { SOLIDITY_VERSION, OPTIMIZER_ENABLED } from '../common/hardhat.default.config'

export const solidityOverrides = {
  'contracts/MakerVault.sol': {
    version: SOLIDITY_VERSION,
    settings: {
      optimizer: {
        enabled: OPTIMIZER_ENABLED,
        runs: 1000000,
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
  dependencyPaths: ['@perennial/v2-oracle/contracts/interfaces/IOracleFactory.sol'],
  solidityOverrides,
})

export default config
