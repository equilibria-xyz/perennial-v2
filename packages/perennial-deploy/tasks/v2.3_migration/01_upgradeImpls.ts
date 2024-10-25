import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { PopulatedTransaction, BigNumberish } from 'ethers'
import { NewMarketParameter, NewProtocolParameter } from '../multisig_ops/constants'
import { V2_2MarketParameterStructOutput, V2_2RiskParameterStructOutput } from './prevTypes'
export default task('01_v2_3_upgrade-impls', 'Upgrades implementations for v2.3 Migration')
  .addFlag('dry', 'Dry run; do not send transactions but use eth_call to simulate them')
  .addFlag('timelock', 'Print timelock transaction payload')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[v2.3 Upgrade Impls] Running Upgrade Implementations Task')
    const {
      ethers,
      deployments: { get, getArtifact },
    } = HRE

    const marketFactoryAddress = (await get('MarketFactory')).address
    let marketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)
    const owner = await marketFactory.owner()
    const ownerSigner = await ethers.getSigner(owner)
    const proxyAdmin = (await ethers.getContractAt('ProxyAdmin', (await get('ProxyAdmin')).address)).connect(
      ownerSigner,
    )

    marketFactory = marketFactory.connect(ownerSigner)
    const oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
      ownerSigner,
    )
    const vaultFactory = (await ethers.getContractAt('VaultFactory', (await get('VaultFactory')).address)).connect(
      ownerSigner,
    )
    const multiinvoker = (await ethers.getContractAt('MultiInvoker', (await get('MultiInvoker')).address)).connect(
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

    const buildUpgrade = async (address: string, implAddress: string, contract: string) => {
      await addPayload(() => proxyAdmin.populateTransaction.upgrade(address, implAddress), `Upgrade ${contract}`)
    }

    await buildUpgrade(marketFactory.address, (await get('MarketFactoryImpl')).address, 'marketFactory')
    await buildUpgrade(vaultFactory.address, (await get('VaultFactoryImpl')).address, 'vaultFactory')
    await buildUpgrade(oracleFactory.address, (await get('OracleFactoryImpl')).address, 'oracleFactory')
    await buildUpgrade(multiinvoker.address, (await get('MultiInvokerImpl')).address, 'multiinvoker')

    // Update Protocol/Risk/Market parameters to new formats
    await addPayload(
      () => marketFactory.populateTransaction.updateParameter(NewProtocolParameter),
      'Update Protocol Parameter',
    )
    const marketsAddrs = (await marketFactory.queryFilter(marketFactory.filters['InstanceRegistered(address)']())).map(
      e => e.args.instance,
    )
    const markets = await Promise.all(marketsAddrs.map(a => ethers.getContractAt('IMarket', a)))
    const newCoordinator = (await get('GauntletCoordinator')).address
    for (const market of markets) {
      await addPayload(() => market.populateTransaction.migrate(), `Migrate Market ${market.address}`)
      await addPayload(async () => {
        const v2_2Market = await ethers.getContractAt((await getArtifact('MarketV2_2')).abi, market.address)
        const v2_2MarketParam = (await v2_2Market.callStatic.parameter()) as V2_2MarketParameterStructOutput

        return market.populateTransaction.updateParameter({
          ...NewMarketParameter,
          fundingFee: v2_2MarketParam.fundingFee,
          interestFee: v2_2MarketParam.interestFee,
          settle: true,
        })
      }, `Update Market ${market.address} Parameter`)
      await addPayload(
        () => market.populateTransaction.updateCoordinator(newCoordinator),
        `Update Market ${market.address} Parameter`,
      )

      await addPayload(async () => {
        const v2_2Market = await ethers.getContractAt((await getArtifact('MarketV2_2')).abi, market.address)
        const v2_2RiskParam = (await v2_2Market.callStatic.riskParameter()) as V2_2RiskParameterStructOutput

        return market.populateTransaction.updateRiskParameter({
          ...v2_2RiskParam,
          liquidationFee: 10e6, // 10x liquidation fee
          makerFee: {
            linearFee: v2_2RiskParam.makerFee.linearFee,
            proportionalFee: v2_2RiskParam.makerFee.proportionalFee,
            scale: v2_2RiskParam.makerFee.scale,
          },
        })
      }, `Update Market ${market.address} Risk Parameter`)
    }

    if (args.timelock) {
      console.log('[v2.3 Upgrade Impls]  Timelock payload:')
      const timelockPayloads = {
        targets: txPayloads.map(tx => tx.to),
        values: txPayloads.map(tx => (tx.value ?? 0).toString()),
        payloads: txPayloads.map(tx => tx.data),
        predecessor: ethers.constants.HashZero,
        salt: ethers.utils.id(Math.random().toString()),
      }
      console.log(`[v2.3 Upgrade Impls]    ${JSON.stringify(timelockPayloads, null, 2)}`)
    } else if (args.dry) {
      for (const payload of txPayloads) {
        console.log('[v2.3 Upgrade Impls]    Dry run:', payload.info)
        await ethers.provider.call(payload)
      }
      console.log('[v2.3 Upgrade Impls]   Dry run successful!')
    } else {
      console.log('[v2.3 Upgrade Impls]   Sending Transactions')
      for (const payload of txPayloads) {
        process.stdout.write(`[v2.3 Upgrade Impls]     Sending Transaction: ${payload.info}...`)
        const tx = await ownerSigner.sendTransaction({ to: payload.to, value: payload.value, data: payload.data })
        await tx.wait()
        process.stdout.write(`complete. Hash: ${tx.hash}\n`)
      }
    }
    console.log('[v2.3 Upgrade Impls] Done.')
  })
