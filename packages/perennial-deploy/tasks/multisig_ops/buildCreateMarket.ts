import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { PAYOFFS } from '../../deploy/002_deploy_payoff'
import { PopulatedTransaction, utils } from 'ethers'
import { NewMarketParameter, NewRiskParams } from './contstants'
import { Market__factory } from '../../types/generated'

export default task('multisig_ops:buildCreateMarket', 'Builds the create market transaction')
  .addParam('underlyingid', 'The oracle ID to use')
  .addParam('market', 'Market key for risk params. Refer to constants.ts')
  .addOptionalParam('id', 'The oracle ID to use. Defaults to underlying-id')
  .addOptionalParam<typeof PAYOFFS>('payoff', 'The payoff contract to use')
  .addOptionalParam('decimals', 'The number of decimals to use')
  .addFlag('pyth', 'Use Pyth oracle factory')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Multisig Ops: Create Market] Building Create Market Transaction')

    const {
      ethers,
      deployments: { get, getOrNull },
    } = HRE

    const DSU = await get('DSU')
    const marketFactoryAddress = (await get('MarketFactory')).address
    const marketFactory = await ethers.getContractAt('IMarketFactory', marketFactoryAddress)

    const underlyingID = args.underlyingid
    const id = args.id || underlyingID
    const payoff = args.payoff ? (await get(args.payoff)).address : ethers.constants.AddressZero
    const decimals = args.decimals || 0
    const oracleFactory = await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)

    if (!args.pyth) throw new Error('Only Pyth oracle factory is supported')
    const keeperFactory = await ethers.getContractAt('KeeperFactory', (await get('PythFactory')).address)

    const txPayloads: { to?: string; value?: string; data?: string; info: string }[] = []

    const addPayload = async (
      populateTx: () => Promise<PopulatedTransaction | { to: string; value?: number; data: string }>,
      info: string,
    ) => {
      const txResult = await populateTx()
      txPayloads.push({
        to: txResult.to,
        value: txResult.value?.toString(),
        data: txResult.data,
        info,
      })
    }

    // Create the Oracle if it doesn't exist
    if ((await keeperFactory.oracles(id)) === ethers.constants.AddressZero) {
      await addPayload(
        () => keeperFactory.populateTransaction.create(id, underlyingID, { provider: payoff, decimals }),
        `Create Keeper ${id}`,
      )
    }
    if ((await oracleFactory.oracles(id)) === ethers.constants.AddressZero) {
      await addPayload(() => oracleFactory.populateTransaction.create(id, keeperFactory.address), `Create Oracle ${id}`)
    }

    // Create the market
    const oracleAddress = utils.getContractAddress({
      from: oracleFactory.address,
      nonce: await ethers.provider.getTransactionCount(oracleFactory.address),
    })
    const keeperOracleAddress = utils.getContractAddress({
      from: keeperFactory.address,
      nonce: await ethers.provider.getTransactionCount(keeperFactory.address),
    })
    await addPayload(
      () => marketFactory.populateTransaction.create({ token: DSU.address, oracle: oracleAddress }),
      'Create Market',
    )

    const marketAddress = utils.getContractAddress({
      from: marketFactory.address,
      nonce: await ethers.provider.getTransactionCount(marketFactory.address),
    })
    const coordinatorAddress = (await getOrNull('GauntletCoordinator'))?.address || ethers.constants.AddressZero
    const marketInterface = Market__factory.createInterface()

    await addPayload(async () => {
      return {
        to: marketAddress,
        value: 0,
        data: marketInterface.encodeFunctionData('updateParameter', [
          ethers.constants.AddressZero,
          coordinatorAddress,
          NewMarketParameter,
        ]),
      }
    }, 'Update Market Parameter')

    const [, riskParam] = NewRiskParams[args.market]
    if (!riskParam) throw new Error('Invalid market key')

    await addPayload(async () => {
      return {
        to: marketAddress,
        value: 0,
        data: marketInterface.encodeFunctionData('updateRiskParameter', [riskParam, false]),
      }
    }, 'Update Market Risk Parameter')

    const timelockPayloads = {
      targets: txPayloads.map(tx => tx.to),
      values: txPayloads.map(tx => (tx.value ?? 0).toString()),
      payloads: txPayloads.map(tx => tx.data),
      predecessor: ethers.constants.HashZero,
      salt: ethers.utils.id(Math.random().toString()),
    }
    console.log('[Multisig Ops: Create Market] Timelock:', (await getOrNull('TimelockController'))?.address)
    console.log('[Multisig Ops: Create Market] New Oracle:', oracleAddress)
    console.log('[Multisig Ops: Create Market] New Keeper Oracle:', keeperOracleAddress)
    console.log('[Multisig Ops: Create Market] New Market:', marketAddress)
    console.log(`[Multisig Ops: Create Market] Payload: ${JSON.stringify(timelockPayloads, null, 2)}`)
  })
