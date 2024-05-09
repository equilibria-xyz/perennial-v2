import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { PopulatedTransaction } from 'ethers'

export default task('2_2_update-vault-weights', 'Updates vault weights so that they sum to UFixed6.ONE')
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[v2.2 Update Vault Weights] Running Update Vault Weights Task')
    const {
      ethers,
      deployments: { get },
    } = HRE

    const vaultFactory = await ethers.getContractAt('IVaultFactory', (await get('VaultFactory')).address)
    const vaultAddresses = await vaultFactory.queryFilter(vaultFactory.filters.VaultCreated())
    const vaults = await Promise.all(
      vaultAddresses.map(async vault => ethers.getContractAt('IVault', vault.args.vault)),
    )
    const owner = await vaultFactory.owner()
    const ownerSigner = await ethers.getSigner(owner)

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

    for (const vault of vaults) {
      const totalMarkets = await vault.totalMarkets()
      const currentWeights = await Promise.all(
        Array.from({ length: totalMarkets.toNumber() }, async (_, i) => (await vault.registrations(i)).weight),
      )
      const totalWeight = currentWeights.reduce((acc, weight) => acc.add(weight), ethers.constants.Zero)
      const scaleFactor = ethers.BigNumber.from('1000000').div(totalWeight)
      const newWeights = currentWeights.map(weight => weight.mul(scaleFactor))
      console.log(
        `[v2.2 Update Vault Weights]  New Vault Weights for ${vault.address}:  ${newWeights
          .map(w => w.toString())
          .join(',')}`,
      )

      await addPayload(
        () => vault.populateTransaction.updateWeights(newWeights),
        `Update Vault Weights: ${vault.address} to ${newWeights.map(w => w.toString()).join(',')}`,
      )
    }

    if (args.timelock) {
      console.log('[v2.2 Update Vault Weights]  Timelock payload:')
      const timelockPayloads = {
        targets: txPayloads.map(tx => tx.to),
        values: txPayloads.map(tx => (tx.value ?? 0).toString()),
        payloads: txPayloads.map(tx => tx.data),
        predecessor: ethers.constants.HashZero,
        salt: ethers.utils.id(Math.random().toString()),
      }
      console.log(`[v2.2 Update Vault Weights]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    } else if (args.dry) {
      for (const payload of txPayloads) {
        console.log('[v2.2 Update Vault Weights]    Dry run:', payload.info)
        await ethers.provider.call(payload)
      }
      console.log('[v2.2 Update Vault Weights]  Dry run successful')
    } else {
      console.log('[v2.2 Update Vault Weights]   Sending Transactions')
      for (const payload of txPayloads) {
        process.stdout.write(`[v2.2 Update Vault Weights]     Sending Transaction: ${payload.info}...`)
        const tx = await ownerSigner.sendTransaction({ to: payload.to, value: payload.value, data: payload.data })
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }
    console.log('[v2.2 Update Vault Weights] Done.')
  })
