// retrieve (private) subgraph URL used to query data for the desired chain
export function getSubgraphUrlFromEnvironment(networkName: string): string {
  switch (networkName) {
    case 'arbitrum':
      return process.env.ARBITRUM_GRAPH_URL_NEW ?? ''
    case 'arbitrumSepolia':
      return process.env.ARBITRUM_SEPOLIA_GRAPH_URL_NEW ?? ''
    case 'hardhat':
    case 'localhost':
      // caller must have FORK_NETWORK set for this to avoid fallback to default chain
      return getSubgraphUrlFromEnvironment(process.env.FORK_NETWORK ?? 'arbitrum')
  }

  throw new Error(`Unsupported network: ${networkName}`)
}
