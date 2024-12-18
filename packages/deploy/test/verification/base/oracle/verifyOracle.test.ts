import HRE from 'hardhat'
import { expect } from 'chai'
import { utils, constants } from 'ethers'
import {
  OracleFactory,
  OracleFactory__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  PythFactory,
  PythFactory__factory,
} from '../../../../types/generated'

describe('Verify Oracle', () => {
  let oracleFactory: OracleFactory
  let pythFactory: PythFactory
  let proxyAdmin: ProxyAdmin

  beforeEach(async () => {
    const { deployments, ethers } = HRE
    const [signer] = await ethers.getSigners()
    oracleFactory = OracleFactory__factory.connect((await deployments.get('OracleFactory')).address, signer)
    pythFactory = PythFactory__factory.connect((await deployments.get('PythFactory')).address, signer)
    proxyAdmin = ProxyAdmin__factory.connect((await HRE.deployments.get('ProxyAdmin')).address, signer)
  })

  it('OracleFactory', async () => {
    expect(await proxyAdmin.callStatic.getProxyAdmin(oracleFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(oracleFactory.address)).to.equal(
      (await HRE.deployments.get('OracleFactoryImpl')).address,
    )
    await expect(oracleFactory.initialize(constants.AddressZero, constants.AddressZero, constants.AddressZero)).to.be
      .reverted
    expect(await oracleFactory.callStatic.owner()).to.equal((await HRE.deployments.get('TimelockController')).address)
    expect(await oracleFactory.callStatic.implementation()).to.equal((await HRE.deployments.get('OracleImpl')).address)
    expect(await oracleFactory.callStatic.maxClaim()).to.equal(utils.parseUnits('25', 6))
  })

  it('PythFactory', async () => {
    expect(await proxyAdmin.callStatic.getProxyAdmin(pythFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(pythFactory.address)).to.equal(
      (await HRE.deployments.get('PythFactoryImpl')).address,
    )
    await expect(pythFactory.initialize(constants.AddressZero, constants.AddressZero, constants.AddressZero)).to.be
      .reverted
    expect(await pythFactory.callStatic.owner()).to.equal((await HRE.deployments.get('TimelockController')).address)
    expect(await pythFactory.callStatic.implementation()).to.equal(
      (await HRE.deployments.get('PythOracleImpl')).address,
    )
    expect((await pythFactory.callStatic.granularity()).currentGranularity).to.equal(10)
  })
})
