import { task } from 'hardhat/config'
import { constants, utils } from 'ethers'

task('approveMultiInvokerTargets', 'Approves MultiInvoker targets for markets and vaults').setAction(
  async (_, { deployments, ethers }) => {
    const { get } = deployments

    console.log('Approving MultiInvoker targets...')

    // Get contract instances
    const multiInvoker = await ethers.getContractAt('MultiInvoker', (await get('MultiInvoker')).address)
    const DSU = await ethers.getContractAt('DSU', (await get('DSU')).address)
    const marketFactory = await ethers.getContractAt('MarketFactory', (await get('MarketFactory')).address)
    const vaultFactory = await ethers.getContractAt('IVaultFactory', (await get('MakerVaultFactory')).address)
    const solverVaultFactory = await ethers.getContractAt('IVaultFactory', (await get('SolverVaultFactory')).address)

    // Get all markets and vaults
    const markets = await marketFactory.queryFilter(marketFactory.filters.InstanceRegistered())
    const vaults = await vaultFactory.queryFilter(vaultFactory.filters.InstanceRegistered())
    const solverVaults = await solverVaultFactory.queryFilter(solverVaultFactory.filters.InstanceRegistered())
    const approvalTargets = [...markets, ...vaults, ...solverVaults].map(e => e.args.instance)

    console.log(
      `Found ${markets.length} markets, ${vaults.length} maker vaults, and ${solverVaults.length} solver vaults to check`,
    )

    // Check allowances and create approval actions
    const approvalActions_ = await Promise.all(
      approvalTargets.map(async target => {
        const allowance = await DSU.callStatic.allowance(multiInvoker.address, target)
        if (allowance.eq(constants.MaxUint256)) return null
        return {
          action: 8, // Approve action
          args: utils.defaultAbiCoder.encode(['address'], [target]),
        }
      }),
    )

    const approvalActions = approvalActions_.filter(e => e !== null) as { action: number; args: string }[]

    if (approvalActions.length > 0) {
      console.log(`Approving ${approvalActions.length} targets...`)
      const tx = await multiInvoker['invoke((uint8,bytes)[])'](approvalActions)
      await tx.wait()
      console.log('Approvals complete')
    } else {
      console.log('All targets already approved')
    }
  },
)
