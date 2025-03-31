export const ALL_CHAINS = [
  'mainnet',
  'arbitrum',
  'base',
  'perennial',
  'perennialSepolia',
  'hardhat',
  'localhost',
] as const

export type SupportedChains = typeof ALL_CHAINS
export type SupportedChain = SupportedChains[number]

export const MAINNETS: SupportedChain[] = ['mainnet', 'arbitrum', 'base', 'perennial']
export const TESTNETS: SupportedChain[] = ['perennialSepolia']
export const DEVNETS: SupportedChain[] = ['hardhat', 'localhost']
export const ETHEREUM_NETS: SupportedChain[] = ['mainnet']
export const ARBITRUM_NETS: SupportedChain[] = ['arbitrum']
export const BASE_NETS: SupportedChain[] = ['base']
export const PERENNIAL_NETS: SupportedChain[] = ['perennial']

export function isSupported(networkName: string): networkName is SupportedChain {
  return ALL_CHAINS.includes(networkName as SupportedChain)
}

export function getChainId(networkName: string): number {
  if (!isSupported(networkName)) throw 'Unsupported Network'
  switch (networkName) {
    case 'mainnet':
      return 1
    case 'perennial':
      return 1424
    case 'perennialSepolia':
      return 60850
    case 'arbitrum':
      return 42161
    case 'base':
      return 8453
    case 'hardhat':
      return 31337
    default:
      throw 'Unsupported Network'
  }
}

export function isEthereum(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  if (isLocalhost(networkName)) return isFork() && ETHEREUM_NETS.includes(forkNetwork() as SupportedChain)
  return ETHEREUM_NETS.includes(networkName)
}

export function isArbitrum(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  if (isLocalhost(networkName)) return isFork() && ARBITRUM_NETS.includes(forkNetwork() as SupportedChain)
  return ARBITRUM_NETS.includes(networkName)
}

export function isBase(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  if (isLocalhost(networkName)) return isFork() && BASE_NETS.includes(forkNetwork() as SupportedChain)
  return BASE_NETS.includes(networkName)
}

export function isPerennial(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  if (isLocalhost(networkName)) return isFork() && PERENNIAL_NETS.includes(forkNetwork() as SupportedChain)
  return PERENNIAL_NETS.includes(networkName)
}

export function isTestnet(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  if (isLocalhost(networkName)) return isFork() && TESTNETS.includes(forkNetwork() as SupportedChain)
  return TESTNETS.includes(networkName)
}

export function isMainnet(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  if (isLocalhost(networkName)) return isFork() && MAINNETS.includes(forkNetwork() as SupportedChain)
  return MAINNETS.includes(networkName)
}

export function isLocalhost(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'hardhat':
    case 'localhost':
      return true
    default:
      return false
  }
}

export function isFork(): boolean {
  return process.env.FORK_ENABLED === 'true'
}

export function forkNetwork(): string {
  if (!isFork()) throw 'Not forked'
  return process.env.FORK_NETWORK as string
}
