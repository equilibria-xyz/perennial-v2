import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { PopulatedTransaction } from 'ethers'
import { ChainMarkets, MarketMetadata, SupportedChainId, SupportedMarket } from '@perennial/sdk'
import { forkNetwork, isFork, getChainId } from '../../../common/testutil/network'

export default task(
  '03_v2_3_associate_market_to_oracle',
  'Sets up the oracle and market associations for v2.3 migration',
)
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[v2.3 Associate Market to Oracle] Running Associate Market to Oracles Task')
    const {
      ethers,
      deployments: { get, getNetworkName },
    } = HRE

    const chainId = getChainId(isFork() ? forkNetwork() : getNetworkName()) as SupportedChainId
    const marketFactoryAddress = (await get('MarketFactory')).address
    const marketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)
    const owner = await marketFactory.owner()
    const ownerSigner = await ethers.getSigner(owner)

    const oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
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

    // TODO: Do we want to enable the MultiInvoker extension?
    addPayload(
      async () => marketFactory.populateTransaction.updateExtension((await get('MultiInvoker')).address, true),
      'Enable MultiInvoker Extension',
    )

    // Update oracle names and IDs, register markets
    const oracles = await oracleFactory.queryFilter(oracleFactory.filters.OracleCreated())
    for (const oracle of oracles) {
      await addPayload(
        () => oracleFactory.populateTransaction.updateId(oracle.args.oracle, oracle.args.id),
        `Update Oracle ID ${oracle.args.oracle} ${oracle.args.id}`,
      )
      const oracleContract = await ethers.getContractAt('IOracle', oracle.args.oracle)
      const asscociatedMarketMetadata = Object.entries(MarketMetadata).find(
        ([, metadata]) => metadata.providerId === oracle.args.id,
      )
      if (!asscociatedMarketMetadata) throw new Error(`No associated market data for ${oracle.args.id}`)
      const [name] = asscociatedMarketMetadata
      await addPayload(
        () => oracleContract.populateTransaction.updateName(name),
        `Associate ${oracle.args.id} to ${name}`,
      )
      const marketAddress = ChainMarkets[chainId][name as SupportedMarket]
      if (!marketAddress) {
        console.warn(`No market address for ${name}. Skipping...`)
        continue
      }

      await addPayload(() => oracleContract.populateTransaction.register(marketAddress), `Register ${name} with Oracle`)
    }

    if (args.timelock) {
      console.log('[v2.3 Associate Market to Oracle]  Timelock payload:')
      const timelockPayloads = {
        targets: txPayloads.map(tx => tx.to),
        values: txPayloads.map(tx => (tx.value ?? 0).toString()),
        payloads: txPayloads.map(tx => tx.data),
        predecessor: ethers.constants.HashZero,
        salt: ethers.utils.id(Math.random().toString()),
      }
      console.log(`[v2.3 Associate Market to Oracle]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    } else if (args.dry) {
      for (const payload of txPayloads) {
        console.log('[v2.3 Associate Market to Oracle]    Dry run:', payload.info)
        await ethers.provider.call(payload)
      }
      console.log('[v2.3 Associate Market to Oracle]  Dry run successful')
    } else {
      console.log('[v2.3 Associate Market to Oracle]   Sending Transactions')
      for (const payload of txPayloads) {
        process.stdout.write(`[v2.3 Associate Market to Oracle]     Sending Transaction: ${payload.info}...`)
        const tx = await ownerSigner.sendTransaction({ to: payload.to, value: payload.value, data: payload.data })
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }
    console.log('[v2.3 Associate Market to Oracle] Done.')
  })
