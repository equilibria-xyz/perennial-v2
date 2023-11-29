import fetch from 'isomorphic-fetch'
import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'

export default task('verify-proxies', 'Verifies proxies on Etherscan for the given network').setAction(
  async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { get, all, getNetworkName },
      config: { etherscan },
    } = HRE
    const res = await HRE.run('verify:get-etherscan-endpoint')
    const apiKey = (etherscan?.apiKey as Record<string, string>)[
      getNetworkName() === 'arbitrum' ? 'arbitrumOne' : getNetworkName()
    ]
    const proxyVerifyUrl = `${res.urls.apiURL}?module=contract&action=verifyproxycontract&apikey=${apiKey}`
    const proxyVerifyStatusUrl = `${res.urls.apiURL}?module=contract&action=checkproxyverification&apikey=${apiKey}"`

    const proxyAdmin = await ethers.getContractAt('ProxyAdmin', (await get('ProxyAdmin')).address)
    const allDeployments = await all()
    const proxies = await Promise.all(
      Object.entries(allDeployments)
        .filter(([, deployment]) => deployment.abi.filter(({ name }) => name === 'upgradeTo').length > 0)
        .filter(([name]) => name !== 'Pyth')
        .map(async ([name, deployment]) => {
          const impl = await proxyAdmin.callStatic.getProxyImplementation(deployment.address)
          return { address: deployment.address, name, expected: impl, deployment }
        }),
    )
    const factories = proxies.filter(({ name }) => name.endsWith('Factory') && name !== 'PayoffFactory')
    const instances = await Promise.all(
      factories.map(async ({ name, deployment }) => {
        const contract = await ethers.getContractAt('Factory', deployment.address)
        const impl = await contract.callStatic.implementation()
        const res = await contract.queryFilter(contract.filters.InstanceRegistered())
        return res.map(({ args }) => ({
          address: args.instance,
          expected: impl,
          name: name.replace('Factory', 'Impl'),
        }))
      }),
    )

    const allAddresses = [
      ...instances.flat(),
      ...proxies.map(({ name, address, expected }) => ({ address, expected, name })),
    ]

    for (const addressData of allAddresses) {
      const { address, expected, name } = addressData
      console.log(`Linking proxy ${name} - Address: ${address}, Expected: ${expected}`)
      const res = await fetch(proxyVerifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: `address=${address}&expectedimplementation=${expected}`,
      })
      const json = await res.json()
      const proxyguid = json.result
      let msg = 'Pending in queue'
      let proxyResultJson = {} as Record<string, unknown>
      while (msg === 'Pending in queue') {
        const proxyResult = await fetch(`${proxyVerifyStatusUrl}&guid=${proxyguid}`)
        proxyResultJson = await proxyResult.json()
        msg = proxyResultJson.result as string
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      console.log(`> Result: ${proxyResultJson.message} (${proxyResultJson.status}) - ${proxyResultJson.result}`)

      await new Promise(resolve => setTimeout(resolve, 500))
    }
  },
)
