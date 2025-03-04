import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'

export default task('verify-contracts', 'Verify all deployed contracts')
  .addFlag('noCompile', 'Skip contract compilation')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Verify Contract] Running Verify Contract Task')
    const {
      deployments: { all },
    } = HRE

    const deployments = await all()

    for (const deployment of Object.keys(deployments)) {
      console.log(`Verifying: ${deployment} at ${deployments[deployment].address}`)
      try {
        await HRE.run('verify:verify', {
          address: deployments[deployment].address,
          constructorArguments: deployments[deployment].args,
          libraries: deployments[deployment].libraries,
          noCompile: !!args.noCompile,
        })
      } catch (error) {
        console.error(`Error verifying ${deployment}:`, error)
      }

      console.log('Verified: ', deployment)
    }

    console.log('[Verify Contract] Done.')
  })
