// retrieve (private) subgraph URL used to query data for the desired chain
export function getSubgraphUrlFromEnvironment(networkName: string) {
  switch (networkName) {
    case 'arbitrum':
      return process.env.ARBITRUM_GRAPH_URL
    case 'arbitrumSepolia':
      return process.env.ARBITRUMSEPOLIA_GRAPH_URL
    case 'localhost':
      // caller must have FORK_NETWORK set for this to avoid fallback to default chain
      return getSubgraphUrlFromEnvironment(process.env.FORK_NETWORK ?? 'arbitrum')
  }
}
