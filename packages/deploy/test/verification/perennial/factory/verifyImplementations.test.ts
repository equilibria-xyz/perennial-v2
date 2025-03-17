import HRE from 'hardhat'
import { expect } from 'chai'
import {
  MarketFactory,
  MarketFactory__factory,
  OracleFactory,
  OracleFactory__factory,
  VaultFactory,
  VaultFactory__factory,
  StorkFactory,
  StorkFactory__factory,
  Controller_Optimism,
  Controller_Optimism__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('Verify Implementation', () => {
  let signer: SignerWithAddress
  let proxyAdmin: ProxyAdmin

  beforeEach(async () => {
    ;[signer] = await HRE.ethers.getSigners()
    proxyAdmin = ProxyAdmin__factory.connect((await HRE.deployments.get('ProxyAdmin')).address, signer)
  })

  it('MarketFactory', async () => {
    const marketFactory: MarketFactory = MarketFactory__factory.connect(
      (await HRE.deployments.get('MarketFactory')).address,
      signer,
    )
    expect(await proxyAdmin.getProxyImplementation((await HRE.deployments.get('MarketFactory')).address)).to.equal(
      (await HRE.deployments.get('MarketFactoryImpl')).address,
    )
    expect(await marketFactory.implementation()).to.equal((await HRE.deployments.get('MarketImpl')).address)
  })

  it('OracleFactory', async () => {
    const oracleFactory: OracleFactory = OracleFactory__factory.connect(
      (await HRE.deployments.get('OracleFactory')).address,
      signer,
    )
    expect(await proxyAdmin.getProxyImplementation((await HRE.deployments.get('OracleFactory')).address)).to.equal(
      (await HRE.deployments.get('OracleFactoryImpl')).address,
    )
    expect(await oracleFactory.implementation()).to.equal((await HRE.deployments.get('OracleImpl')).address)
  })

  it('MakerVaultFactory', async () => {
    const makerVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('MakerVaultFactory')).address,
      signer,
    )
    expect(await proxyAdmin.getProxyImplementation((await HRE.deployments.get('MakerVaultFactory')).address)).to.equal(
      (await HRE.deployments.get('MakerVaultFactoryImpl')).address,
    )
    expect(await makerVaultFactory.implementation()).to.equal((await HRE.deployments.get('MakerVaultImpl')).address)
  })

  it('SolverVaultFactory', async () => {
    const solverVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('SolverVaultFactory')).address,
      signer,
    )
    expect(await proxyAdmin.getProxyImplementation((await HRE.deployments.get('SolverVaultFactory')).address)).to.equal(
      (await HRE.deployments.get('SolverVaultFactoryImpl')).address,
    )
    expect(await solverVaultFactory.implementation()).to.equal((await HRE.deployments.get('SolverVaultImpl')).address)
  })

  it('StorkFactory', async () => {
    const storkFactory: StorkFactory = StorkFactory__factory.connect(
      (await HRE.deployments.get('StorkFactory')).address,
      signer,
    )
    expect(await proxyAdmin.getProxyImplementation((await HRE.deployments.get('StorkFactory')).address)).to.equal(
      (await HRE.deployments.get('StorkFactoryImpl')).address,
    )
    expect(await storkFactory.implementation()).to.equal((await HRE.deployments.get('KeeperOracleImpl')).address)
  })

  it('Controller', async () => {
    const controller: Controller_Optimism = Controller_Optimism__factory.connect(
      (await HRE.deployments.get('Controller')).address,
      signer,
    )
    expect(await proxyAdmin.getProxyImplementation((await HRE.deployments.get('Controller')).address)).to.equal(
      (await HRE.deployments.get('ControllerImpl')).address,
    )
    expect(await controller.implementation()).to.equal((await HRE.deployments.get('AccountImpl')).address)
  })
})
