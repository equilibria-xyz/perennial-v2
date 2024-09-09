import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { PopulatedTransaction } from 'ethers'
import { KeeperFactoryParameter } from '../../util/constants'

export default task('02_v2_3_setup-oracles', 'Sets up the new oracles for v2.3 Migration')
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[v2.3 Setup Oracles] Running Setup Oracles Task')
    const {
      ethers,
      deployments: { get, getOrNull },
    } = HRE

    const marketFactoryAddress = (await get('MarketFactory')).address
    const marketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)
    const owner = await marketFactory.owner()
    const ownerSigner = await ethers.getSigner(owner)

    const proxyAdmin = (await ethers.getContractAt('ProxyAdmin', (await get('ProxyAdmin')).address)).connect(
      ownerSigner,
    )
    const oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
      ownerSigner,
    )
    const pythFactory = (await ethers.getContractAt('PythFactory', (await get('PythFactory')).address)).connect(
      ownerSigner,
    )
    const previousPythFactory = (
      await ethers.getContractAt('PythFactory', (await get('PreviousPythFactory')).address)
    ).connect(ownerSigner)

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

    await addPayload(
      () => oracleFactory.populateTransaction.register(pythFactory.address),
      'Register PythFactory with OracleFactory',
    )

    await addPayload(
      () =>
        oracleFactory.populateTransaction.updateParameter({
          maxGranularity: 60,
          maxOracleFee: ethers.utils.parseUnits('0.10', 6),
          maxSettlementFee: ethers.utils.parseUnits('25', 6),
        }),
      'Update OracleFactory parameter',
    )

    await addPayload(
      () =>
        pythFactory.populateTransaction.updateParameter(
          KeeperFactoryParameter.granularity,
          KeeperFactoryParameter.oracleFee,
          KeeperFactoryParameter.validFrom,
          KeeperFactoryParameter.validTo,
        ),
      'Update PythFactory parameter',
    )

    // Update existing oracles to use new PythFactory
    const oracles = await pythFactory.queryFilter(pythFactory.filters.OracleCreated())
    for (const oracle of oracles) {
      if ((await oracleFactory.oracles(oracle.args.id)) === pythFactory.address) continue
      if ((await oracleFactory.oracles(oracle.args.id)) === ethers.constants.AddressZero) continue
      await addPayload(
        () => oracleFactory.populateTransaction.update(oracle.args.id, pythFactory.address),
        `Update Pyth Oracle ${oracle.args.id}`,
      )
    }

    if (await getOrNull('CryptexFactory')) {
      const cryptexFactory = await ethers.getContractAt('IMetaQuantsFactory', (await get('CryptexFactory')).address)
      await addPayload(
        () => oracleFactory.populateTransaction.register(cryptexFactory.address),
        'Register CryptexFactory with OracleFactory',
      )

      const cryptexOracles = await cryptexFactory.queryFilter(cryptexFactory.filters.OracleCreated())
      for (const oracles of cryptexOracles) {
        if ((await oracleFactory.oracles(oracles.args.id)) === cryptexFactory.address) continue
        if ((await oracleFactory.oracles(oracles.args.id)) === ethers.constants.AddressZero) continue
        await addPayload(
          () => oracleFactory.populateTransaction.update(oracles.args.id, cryptexFactory.address),
          `Update Cryptex Oracle ${oracles.args.id}`,
        )
      }
    }

    await addPayload(
      async () =>
        proxyAdmin.populateTransaction.upgrade(
          previousPythFactory.address,
          (
            await get('PythFactoryMigrationImpl')
          ).address,
        ),
      `Upgrade previousPythFactory`,
    )

    if (args.timelock) {
      console.log('[v2.3 Setup Oracles]  Timelock payload:')
      const timelockPayloads = {
        targets: txPayloads.map(tx => tx.to),
        values: txPayloads.map(tx => (tx.value ?? 0).toString()),
        payloads: txPayloads.map(tx => tx.data),
        predecessor: ethers.constants.HashZero,
        salt: ethers.utils.id(Math.random().toString()),
      }
      console.log(`[v2.3 Setup Oracles]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    } else if (args.dry) {
      for (const payload of txPayloads) {
        console.log('[v2.3 Setup Oracles]    Dry run:', payload.info)
        await ethers.provider.call(payload)
      }
      console.log('[v2.3 Setup Oracles]  Dry run successful')
    } else {
      console.log('[v2.3 Setup Oracles]   Sending Transactions')
      for (const payload of txPayloads) {
        process.stdout.write(`[v2.3 Setup Oracles]     Sending Transaction: ${payload.info}...`)
        const tx = await ownerSigner.sendTransaction({ to: payload.to, value: payload.value, data: payload.data })
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }
    console.log('[v2.3 Setup Oracles] Done.')
  })