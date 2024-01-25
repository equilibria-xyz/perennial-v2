import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'path'
dotenvConfig({ path: resolve(__dirname, '../../.env') })

import { HardhatUserConfig, NetworkUserConfig, SolcUserConfig } from 'hardhat/types'

import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-contract-sizer'
import 'hardhat-deploy'
import 'hardhat-dependency-compiler'
import 'hardhat-tracer'
import 'solidity-coverage'

import { getChainId, isArbitrum, isBase, isBlast, SupportedChain } from './testutil/network'

import { utils } from 'ethers'
utils.Logger.setLogLevel(utils.Logger.levels.ERROR) // turn off duplicate definition warnings

export const SOLIDITY_VERSION = '0.8.19'

const PRIVATE_KEY_MAINNET = process.env.PRIVATE_KEY_MAINNET || ''
const PRIVATE_KEY_TESTNET = process.env.PRIVATE_KEY_TESTNET || ''

const ETHERSCAN_API_KEY_ARBITRUM = process.env.ETHERSCAN_API_KEY_ARBITRUM || ''
const ETHERSCAN_API_KEY_BASE = process.env.ETHERSCAN_API_KEY_BASE || ''
const ETHERSCAN_API_KEY_BLAST = process.env.ETHERSCAN_API_KEY_BLAST || ''

const ARBITRUM_NODE_URL = process.env.ARBITRUM_NODE_URL || ''
const BASE_NODE_URL = process.env.BASE_NODE_URL || ''
const ARBITRUM_SEPOLIA_NODE_URL = process.env.ARBITRUM_SEPOLIA_NODE_URL || ''
const BLAST_SEPOLIA_NODE_URL = process.env.BLAST_SEPOLIA_NODE_URL || ''

const FORK_ENABLED = process.env.FORK_ENABLED === 'true' || false
const FORK_NETWORK = process.env.FORK_NETWORK || 'mainnet'
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined
const FORK_USE_REAL_DEPLOYS = process.env.FORK_USE_REAL_DEPLOYS === 'true' || false

const NODE_INTERVAL_MINING = process.env.NODE_INTERVAL_MINING ? parseInt(process.env.NODE_INTERVAL_MINING) : undefined

const MOCHA_PARALLEL = process.env.MOCHA_PARALLEL === 'true' || false
const MOCHA_REPORTER = process.env.MOCHA_REPORTER || 'spec'
const MOCHA_RETRY_COUNT = process.env.MOCHA_RETRY_COUNT || 0

export const OPTIMIZER_ENABLED = process.env.OPTIMIZER_ENABLED === 'true' || false

function getUrl(networkName: SupportedChain): string {
  switch (networkName) {
    case 'arbitrum':
      return ARBITRUM_NODE_URL
    case 'base':
      return BASE_NODE_URL
    case 'arbitrumSepolia':
      return ARBITRUM_SEPOLIA_NODE_URL
    case 'blastSepolia':
      return BLAST_SEPOLIA_NODE_URL
    default:
      return ''
  }
}

function getEtherscanApiConfig(networkName: SupportedChain): { apiKey: string; apiUrl?: string } {
  if (isArbitrum(networkName)) return { apiKey: ETHERSCAN_API_KEY_ARBITRUM }
  if (isBase(networkName)) return { apiKey: ETHERSCAN_API_KEY_BASE }
  if (isBlast(networkName)) return { apiKey: ETHERSCAN_API_KEY_BLAST }

  return { apiKey: '' }
}

function createNetworkConfig(network: SupportedChain): NetworkUserConfig {
  const cfg = {
    accounts: PRIVATE_KEY_TESTNET ? [PRIVATE_KEY_TESTNET] : [],
    chainId: getChainId(network),
    url: getUrl(network),
    verify: {
      etherscan: getEtherscanApiConfig(network),
    },
  }

  if (network === 'mainnet') {
    cfg.accounts = PRIVATE_KEY_MAINNET ? [PRIVATE_KEY_MAINNET] : []
  }

  return cfg
}
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
type configOverrides = {
  solidityOverrides?: Record<string, SolcUserConfig>
  externalDeployments?: { [networkName: string]: string[] }
  dependencyPaths?: string[]
}

export default function defaultConfig({
  solidityOverrides,
  externalDeployments,
  dependencyPaths,
}: configOverrides = {}): HardhatUserConfig {
  return {
    defaultNetwork: 'hardhat',
    networks: {
      hardhat: {
        forking: {
          url: getUrl(FORK_NETWORK as SupportedChain),
          enabled: FORK_ENABLED,
          blockNumber: FORK_BLOCK_NUMBER,
        },
        chainId: getChainId('hardhat'),
        allowUnlimitedContractSize: true,
        mining: NODE_INTERVAL_MINING
          ? {
              interval: NODE_INTERVAL_MINING,
            }
          : undefined,
      },
      arbitrumSepolia: createNetworkConfig('arbitrumSepolia'),
      arbitrum: createNetworkConfig('arbitrum'),
      base: createNetworkConfig('base'),
      blastSepolia: createNetworkConfig('blastSepolia'),
    },
    solidity: {
      compilers: [
        {
          version: SOLIDITY_VERSION,
          settings: {
            optimizer: {
              enabled: OPTIMIZER_ENABLED,
              runs: 1000000, // Max allowed by Etherscan verify
            },
            outputSelection: OPTIMIZER_ENABLED
              ? {}
              : {
                  '*': {
                    '*': ['storageLayout'], // This is needed by Smock for mocking functions
                  },
                },
            viaIR: OPTIMIZER_ENABLED,
          },
        },
      ],
      overrides: solidityOverrides,
    },
    dependencyCompiler: {
      paths: dependencyPaths || [],
    },
    namedAccounts: {
      deployer: 0,
    },
    etherscan: {
      apiKey: {
        arbitrumOne: getEtherscanApiConfig('arbitrum').apiKey,
        base: getEtherscanApiConfig('base').apiKey,
        arbitrumSepolia: getEtherscanApiConfig('arbitrumSepolia').apiKey,
        blastSepolia: getEtherscanApiConfig('blastSepolia').apiKey,
        // baseGoerli: getEtherscanApiConfig('baseGoerli').apiKey,
      },
      customChains: [
        {
          network: 'arbitrumSepolia',
          chainId: 421614,
          urls: {
            apiURL: 'https://api-sepolia.arbiscan.io/api',
            browserURL: 'https://sepolia.arbiscan.io',
          },
        },
        {
          network: 'base',
          chainId: getChainId('base'),
          urls: {
            apiURL: 'https://api.basescan.org/api',
            browserURL: 'https://basescan.io',
          },
        },
        {
          network: 'blastSepolia',
          chainId: getChainId('blastSepolia'),
          urls: {
            apiURL: 'https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan',
            browserURL: 'https://testnet.blastscan.io',
          },
        },
      ],
    },
    gasReporter: {
      currency: 'USD',
      gasPrice: 100,
      enabled: process.env.REPORT_GAS ? true : false,
    },
    typechain: {
      outDir: 'types/generated',
      target: 'ethers-v5',
    },
    mocha: {
      parallel: MOCHA_PARALLEL,
      reporter: MOCHA_REPORTER,
      slow: 1000,
      timeout: 480000,
      retries: Number(MOCHA_RETRY_COUNT),
    },
    contractSizer: {
      alphaSort: true,
      disambiguatePaths: false,
      runOnCompile: true,
      strict: false,
    },
    external: {
      contracts: [{ artifacts: 'external/contracts' }],
      deployments: {
        arbitrumSepolia: ['external/deployments/arbitrumSepolia', ...(externalDeployments?.arbitrumSepolia || [])],
        arbitrum: ['external/deployments/arbitrum', ...(externalDeployments?.arbitrum || [])],
        base: ['external/deployments/base', ...(externalDeployments?.base || [])],
        blastSepolia: ['external/deployments/blastSepolia', ...(externalDeployments?.blastSepolia || [])],
        hardhat: [
          FORK_ENABLED ? `external/deployments/${FORK_NETWORK}` : '',
          FORK_ENABLED && FORK_USE_REAL_DEPLOYS ? `deployments/${FORK_NETWORK}` : '',
          ...(externalDeployments?.hardhat || []),
        ],
        localhost: [
          FORK_ENABLED ? `external/deployments/${FORK_NETWORK}` : '',
          FORK_ENABLED && FORK_USE_REAL_DEPLOYS ? `deployments/${FORK_NETWORK}` : '',
          ...(externalDeployments?.localhost || []),
        ],
      },
    },
  }
}
