import '@nomiclabs/hardhat-ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { utils } from 'ethers'
import { getAddress, Hex } from 'viem'
import PerennialSDK, { SupportedChainId } from '@perennial/sdk'
import PerennialSDK002 from '@perennial/sdk-0.0.2'
import { forkNetwork, getChainId, isFork } from '../../common/testutil/network'

export default task('commit-price', 'Commits a price for the given price ids')
  .addParam('priceids', 'The price ids to commit (comma separated)', '', types.string)
  .addFlag('dry', 'Do not commit prices, print out calldata instead')
  .addFlag('prevabi', 'Use v0.0.2 of the sdk')
  .addOptionalParam('timestamp', 'The timestamp to query for prices', undefined, types.int)
  .addOptionalParam('factoryaddress', 'The address of the keeper oracle factory', undefined, types.string)
  .addOptionalParam('gaslimit', 'The gas limit for the transaction', undefined, types.int)
  .setAction(
    async (
      { priceids: priceIds_, timestamp, dry, factoryaddress, gaslimit, prevabi }: TaskArguments,
      HRE: HardhatRuntimeEnvironment,
    ) => {
      let priceIds: { id: string; oracle: string; keeperFactoryAddress: string }[] = []

      const {
        ethers,
        deployments: { get, getNetworkName },
      } = HRE
      const multiInvoker = await ethers.getContractAt('IMultiInvoker', (await get('MultiInvoker')).address)

      const factoryAddresses = factoryaddress?.split(',') ?? [
        (await get('PythFactory')).address,
        (await get('CryptexFactory')).address,
      ]

      for (const keeperFactoryAddress of factoryAddresses) {
        const keeperFactory = await ethers.getContractAt('IKeeperFactory', keeperFactoryAddress)

        const oracles = await keeperFactory.queryFilter(keeperFactory.filters.OracleCreated())
        priceIds = priceIds.concat(
          oracles.map(oracle => ({
            id: oracle.args.id,
            oracle: oracle.args.oracle,
            keeperFactoryAddress,
          })),
        )
      }

      if (priceIds_) {
        priceIds = priceIds.filter(p => priceIds_.split(',').includes(p.id))
      }

      const chainId = getChainId(isFork() ? forkNetwork() : getNetworkName()) as SupportedChainId

      const SDKVersion = prevabi ? PerennialSDK002 : PerennialSDK
      const sdk = new SDKVersion({
        chainId,
        rpcUrl: ethers.provider.connection.url,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        pythUrl: process.env.PYTH_URL!,
        cryptexUrl: process.env.CRYPTEX_URL,
      })

      const commitments: { action: number; args: string }[] = []

      console.log('Gathering commitments for priceIds:', priceIds.map(p => p.id).join(','), 'at timestamp', timestamp)
      let minValidTime = ethers.BigNumber.from(4)
      for (const { id: priceId, oracle, keeperFactoryAddress } of priceIds) {
        const keeperFactory = await ethers.getContractAt('IKeeperFactory', keeperFactoryAddress)
        const underlyingId = await keeperFactory.callStatic.toUnderlyingId(priceId)

        if (underlyingId === ethers.constants.HashZero) {
          console.warn('No underlying id found for', priceId, 'skipping...')
          continue
        }

        if (!prevabi) {
          minValidTime = ethers.BigNumber.from((await keeperFactory.parameter()).validFrom)
        }

        const keeperOracle = await ethers.getContractAt('IKeeperOracle', oracle)
        const requestedVersion = await keeperOracle.callStatic.next()
        const request = {
          factory: getAddress(keeperFactory.address),
          subOracle: getAddress(oracle),
          id: priceId as Hex,
          underlyingId: underlyingId as Hex,
          minValidTime: minValidTime.toBigInt(),
          versionOverride: requestedVersion.isZero() ? undefined : requestedVersion.toBigInt(),
        }
        const [vaa] = timestamp
          ? await sdk.oracles.read.oracleCommitmentsTimestamp({
              timestamp,
              requests: [request],
            })
          : await sdk.oracles.read.oracleCommitmentsLatest({
              requests: [request],
            })

        if (!vaa) {
          console.warn('No VAA found for', priceId, 'skipping...')
          continue
        }

        const commitment = buildCommitPrice({
          oracleProviderFactory: keeperFactory.address,
          value: vaa.value,
          ids: vaa.ids,
          version: requestedVersion.isZero() ? BigInt(vaa.version) : requestedVersion.toBigInt(),
          vaa: vaa.updateData,
          revertOnFailure: true,
        })

        commitments.push(commitment)
      }

      if (!commitments.length) throw new Error('No commitments found')

      if (dry) {
        console.log('Dry run, not committing. Calldata')
        console.log(multiInvoker.interface.encodeFunctionData('invoke((uint8,bytes)[])', [commitments]))
        return true
      } else {
        console.log('Committing VAAs')
        const { hash } = await multiInvoker['invoke((uint8,bytes)[])'](commitments, {
          value: commitments.length,
          gasLimit: gaslimit,
        })
        console.log('VAA committed. Hash:', hash)
        return hash
      }
    },
  )

const buildCommitPrice = ({
  oracleProviderFactory,
  version,
  value,
  ids,
  vaa,
  revertOnFailure,
}: {
  oracleProviderFactory: string
  version: bigint
  value: bigint
  ids: string[]
  vaa: string
  revertOnFailure: boolean
}): { action: number; args: string } => ({
  action: 6,
  args: utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
    [oracleProviderFactory, value, ids, version, vaa, revertOnFailure],
  ),
})
