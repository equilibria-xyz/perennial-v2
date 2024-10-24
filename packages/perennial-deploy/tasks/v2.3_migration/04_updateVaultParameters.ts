import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { PopulatedTransaction } from 'ethers'
import { VaultMinimumDeposit } from '../multisig_ops/constants'
import { BigNumber } from 'ethers'

export default task('04_v2_3_update-vault-parameters', 'Updates vault parameters for v2.3 Migration')
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[v2.3 Update Vault Parameters] Running Update Vault Parameters Task')
    const {
      ethers,
      deployments: { get, getArtifact },
    } = HRE

    const marketFactory = await ethers.getContractAt('IMarketFactory', (await get('MarketFactory')).address)
    const owner = await marketFactory.owner()
    const ownerSigner = await ethers.getSigner(owner)
    const vaultFactory = (await ethers.getContractAt('VaultFactory', (await get('VaultFactory')).address)).connect(
      ownerSigner,
    )

    const txPayloads: { to?: string; value?: string; data?: string; info: string }[] = []
    const addPayload = async (populateTx: () => Promise<PopulatedTransaction>, info: string) => {
      const txResult = await populateTx()
      txPayloads.push({
        to: txResult.to,
        value: txResult.value?.toString(),
        data: txResult.data,
        info,
      })
    }

    const vaultAddrs = (await vaultFactory.queryFilter(vaultFactory.filters['InstanceRegistered(address)']())).map(
      e => e.args.instance,
    )
    const vaults = await Promise.all(vaultAddrs.map(a => ethers.getContractAt('IVault', a)))
    for (const vault of vaults) {
      await addPayload(async () => {
        const v2_2Vault = await ethers.getContractAt((await getArtifact('VaultV2_2')).abi, vault.address)
        const v2_2Param = (await v2_2Vault.callStatic.parameter()) as { cap: BigNumber }
        return vault.populateTransaction.updateParameter({
          maxDeposit: v2_2Param.cap,
          minDeposit: VaultMinimumDeposit,
        })
      }, `Update Vault ${vault.address} Parameter`)
    }

    if (args.timelock) {
      console.log('[v2.3 Update Vault Parameters]  Timelock payload:')
      const timelockPayloads = {
        targets: txPayloads.map(tx => tx.to),
        values: txPayloads.map(tx => (tx.value ?? 0).toString()),
        payloads: txPayloads.map(tx => tx.data),
        predecessor: ethers.constants.HashZero,
        salt: ethers.utils.id(Math.random().toString()),
      }
      console.log(`[v2.3 Update Vault Parameters]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    } else if (args.dry) {
      for (const payload of txPayloads) {
        console.log('[v2.3 Update Vault Parameters]    Dry run:', payload.info)
        await ethers.provider.call(payload)
      }
      console.log('[v2.3 Update Vault Parameters]   Dry run successful!')
    } else {
      console.log('[v2.3 Update Vault Parameters]   Sending Transactions')
      for (const payload of txPayloads) {
        process.stdout.write(`[v2.3 Update Vault Parameters]     Sending Transaction: ${payload.info}...`)
        const tx = await ownerSigner.sendTransaction({ to: payload.to, value: payload.value, data: payload.data })
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }
    console.log('[v2.3 Update Vault Parameters] Done.')
  })
