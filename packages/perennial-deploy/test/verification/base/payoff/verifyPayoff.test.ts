import HRE from 'hardhat'
import { expect } from 'chai'
import { PayoffFactory, PayoffFactory__factory, ProxyAdmin, ProxyAdmin__factory } from '../../../../types/generated'

describe('Verify Payoff', () => {
  let payoffFactory: PayoffFactory
  let proxyAdmin: ProxyAdmin

  beforeEach(async () => {
    const { deployments, ethers } = HRE
    const [signer] = await ethers.getSigners()
    payoffFactory = PayoffFactory__factory.connect((await deployments.get('PayoffFactory')).address, signer)
    proxyAdmin = ProxyAdmin__factory.connect((await HRE.deployments.get('ProxyAdmin')).address, signer)
  })

  it('PayoffFactory', async () => {
    expect(await proxyAdmin.callStatic.getProxyAdmin(payoffFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(payoffFactory.address)).to.equal(
      (await HRE.deployments.get('PayoffFactoryImpl')).address,
    )
    await expect(payoffFactory.initialize()).to.be.reverted
    expect(await payoffFactory.callStatic.owner()).to.equal((await HRE.deployments.get('TimelockController')).address)

    const payoffs = await payoffFactory.queryFilter(payoffFactory.filters.InstanceRegistered())
    expect(payoffs.length).to.equal(14)
  })
})
