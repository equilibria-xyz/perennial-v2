import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { isMainnet } from '../../../common/testutil/network'
import { cmsqETHOracleID, msqBTCOracleID } from '../../util/constants'
import { PopulatedTransaction } from 'ethers'

export default task('2_2_setup-oracles', 'Sets up the new oracles for v2.2 Migration')
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[v2.2 Setup Oracles] Running Setup Oracles Task')
    const {
      ethers,
      deployments: { get, getNetworkName },
    } = HRE

    const marketFactoryAddress = (await get('MarketFactory')).address
    const marketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)
    const owner = await marketFactory.owner()
    const ownerSigner = await ethers.getSigner(owner)

    const oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
      ownerSigner,
    )
    const pythFactory = (await ethers.getContractAt('PythFactory', (await get('PythFactory')).address)).connect(
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

    // Authorize OracleFactory to call new PythFactory
    await addPayload(() => oracleFactory.populateTransaction.register(pythFactory.address), 'Register PythFactory')
    if ((await pythFactory.pendingOwner()) === ownerSigner.address) {
      await addPayload(() => pythFactory.populateTransaction.acceptOwner(), 'Accept PythFactory ownership')
    }

    const oracles = await pythFactory.queryFilter(pythFactory.filters.OracleCreated())
    for (const oracle of oracles) {
      await addPayload(
        () => oracleFactory.populateTransaction.update(oracle.args.id, pythFactory.address),
        `Update Oracle ${oracle.args.id}`,
      )
    }

    if (isMainnet(getNetworkName())) {
      const cmsqETHNewOracle = await oracleFactory.callStatic.create(cmsqETHOracleID, pythFactory.address)
      await addPayload(
        () => oracleFactory.populateTransaction.create(cmsqETHOracleID, pythFactory.address),
        'Create Oracle cmsqETH',
      )

      const msqBTCNewOracle = await oracleFactory.callStatic.create(msqBTCOracleID, pythFactory.address)
      await addPayload(
        () => oracleFactory.populateTransaction.create(msqBTCOracleID, pythFactory.address),
        'Create Oracle msqBTC',
      )

      const marketmsqETH = await ethers.getContractAt('IMarket', '0x004E1Abf70e4FF99BC572843B63a63a58FAa08FF')
      await addPayload(
        () => marketmsqETH.populateTransaction.updateOracle(cmsqETHNewOracle),
        'Update msqETH Market Oracle',
      )
      const marketmsqBTC = await ethers.getContractAt('IMarket', '0x768a5909f0B6997efa56761A89344eA2BD5560fd')
      await addPayload(
        () => marketmsqBTC.populateTransaction.updateOracle(msqBTCNewOracle),
        'Update msqBTC Market Oracle',
      )
    }

    if (args.timelock) {
      console.log('[v2.2 Setup Oracles]  Timelock payload:')
      const timelockPayloads = {
        targets: txPayloads.map(tx => tx.to),
        values: txPayloads.map(tx => (tx.value ?? 0).toString()),
        payloads: txPayloads.map(tx => tx.data),
        predecessor: ethers.constants.HashZero,
        salt: ethers.utils.id(Math.random().toString()),
      }
      console.log(`[v2.2 Setup Oracles]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    } else if (args.dry) {
      for (const payload of txPayloads) {
        console.log('[v2.2 Setup Oracles]    Dry run:', payload.info)
        await ethers.provider.call(payload)
      }
      console.log('[v2.2 Setup Oracles]  Dry run successful')
    } else {
      console.log('[v2.2 Setup Oracles]   Sending Transactions')
      for (const payload of txPayloads) {
        process.stdout.write(`[v2.2 Setup Oracles]     Sending Transaction: ${payload.info}...`)
        const tx = await ownerSigner.sendTransaction({ to: payload.to, value: payload.value, data: payload.data })
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }
    console.log('[v2.2 Setup Oracles] Done.')
  })
