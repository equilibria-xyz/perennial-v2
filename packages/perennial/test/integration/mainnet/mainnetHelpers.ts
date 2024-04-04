import { deployProtocol } from '../helpers/setupHelpers'
import { ChainlinkContext } from '../helpers/chainlinkHelpers'

const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

export const mainnetProtcocolFixture = async (chainlinkContext?: ChainlinkContext) => {
  const instanceVars = await deployProtocol(DSU_MINTER, chainlinkContext)
  return instanceVars
}
