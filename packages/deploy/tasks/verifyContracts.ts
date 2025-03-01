import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

export default task('verify-contracts', 'Verify all deployed contracts').setAction(
  async (_, HRE: HardhatRuntimeEnvironment) => {
    console.log('[Verify Contract] Running Verify Contract Task')
    const {
      deployments: { all },
    } = HRE

    const deployments = await all()

    for (const deployment of Object.keys(deployments)) {
      console.log(`Verifying: ${deployment} at ${deployments[deployment].address}`)
      await HRE.run('verify:verify', {
        address: deployments[deployment].address,
        constructorArguments: deployments[deployment].args,
        libraries: deployments[deployment].libraries,
      })
      console.log('Verified: ', deployment)
    }

    console.log('[Verify Contract] Done.')
  },
)
