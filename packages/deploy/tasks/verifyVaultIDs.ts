import '@nomiclabs/hardhat-ethers'
import { BigNumber } from 'ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { getSubgraphUrlFromEnvironment } from './subgraphUtils'
import { IVault } from '../types/generated'
import { MulticallABI, MulticallAddress, MulticallPayload } from './multicallUtils'
import { getAllVaultUsers } from './settleVaults'

const DEFAULT_BATCH_SIZE = 500

export default task('verify-vault-ids', 'Verifies that all vault and users have equal latest and current IDs')
  .addFlag('prevabi', 'Use previous ABIs for contract interaction')
  .addFlag('outputmismatch', 'Output mismatched addresses')
  .addOptionalParam('batchsize', 'The multicall batch size', DEFAULT_BATCH_SIZE, types.int)
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Verify Vault IDs] Running Verify Vault IDs Task')
    const {
      ethers,
      deployments: { getNetworkName, getArtifact },
    } = HRE

    const graphURL = getSubgraphUrlFromEnvironment(getNetworkName())
    if (!graphURL) {
      console.error('Subgraph URL environment variable unknown for this network')
      return 1
    }

    const multicall = new ethers.Contract(MulticallAddress, MulticallABI, ethers.provider).connect(
      (await ethers.getSigners())[0],
    )

    const vaultUsers = await getAllVaultUsers(graphURL)
    const requireSettles: { vault: string; address: string }[] = []

    for (const vaultAddress in vaultUsers) {
      const vault = args.prevabi
        ? ((await ethers.getContractAt((await getArtifact('VaultV2_2')).abi, vaultAddress)) as IVault)
        : await ethers.getContractAt('IVault', vaultAddress)

      const global = await vault.accounts(ethers.constants.AddressZero)
      const users = [...vaultUsers[vaultAddress].values()]
      const allLocals: { address: string; latestId: BigNumber; currentId: BigNumber }[] = []

      console.log('[Verify Vault IDs] Verifying IDs for vault', vaultAddress)
      while (users.length > 0) {
        // batch multicalls to handle vaults with large numbers of users
        const batchedUsers = users.splice(0, args.batchsize)

        const multicallPayload = readAccountPayload(vault, batchedUsers)
        const result: { success: boolean; returnData: string }[] = await multicall.callStatic.aggregate3(
          multicallPayload,
        )

        const locals = result
          .map(({ returnData }) => vault.interface.decodeFunctionResult('accounts', returnData))
          .map((local, i) => ({
            address: batchedUsers[i],
            latestId: local[0].latest,
            currentId: local[0].current,
          }))
        allLocals.push(...locals)
      }

      let hasMismatch = false
      for (const { address, latestId, currentId } of allLocals) {
        if (!latestId.eq(currentId)) {
          hasMismatch = true
          requireSettles.push({ vault: vaultAddress, address })
          if (args.outputmismatch)
            console.error(
              `[Verify Vault IDs]    Vault ${vaultAddress} user ${address}: latestId ${latestId}, currentId ${currentId}`,
            )
        }
      }

      if (!global.latest.eq(global.current))
        requireSettles.push({ vault: vaultAddress, address: ethers.constants.AddressZero })

      console.log(
        `[Verify Vault IDs]  Vault ${vaultAddress}: Globals Match: ${global.latest.eq(
          global.current,
        )}. Locals Match: ${!hasMismatch}`,
      )
    }

    console.log('[Verify Vault IDs] Done.')
    return requireSettles
  })

function readAccountPayload(vault: IVault, users: string[]): MulticallPayload[] {
  const locals = users.map(user => vault.interface.encodeFunctionData('accounts', [user]))
  return locals.map(callData => ({ callData, allowFailure: false, target: vault.address }))
}
