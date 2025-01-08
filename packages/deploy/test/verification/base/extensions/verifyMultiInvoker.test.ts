import HRE from 'hardhat'
import { expect } from 'chai'
import { MultiInvoker, MultiInvoker__factory, ProxyAdmin, ProxyAdmin__factory } from '../../../../types/generated'
import { constants } from 'ethers'

describe('Verify MultiInvoker', () => {
  let multiInvoker: MultiInvoker
  let proxyAdmin: ProxyAdmin

  beforeEach(async () => {
    const { deployments, ethers } = HRE
    const [signer] = await ethers.getSigners()
    multiInvoker = MultiInvoker__factory.connect((await deployments.get('MultiInvoker')).address, signer)
    proxyAdmin = ProxyAdmin__factory.connect((await HRE.deployments.get('ProxyAdmin')).address, signer)
  })

  it('MultiInvoker', async () => {
    expect(await proxyAdmin.callStatic.getProxyAdmin(multiInvoker.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(multiInvoker.address)).to.equal(
      (await HRE.deployments.get('MultiInvokerImpl_Optimism')).address,
    )
    await expect(multiInvoker.initialize(constants.AddressZero)).to.be.reverted
  })
})
