import HRE from 'hardhat'
import { expect } from 'chai'
import {
  MarketFactory,
  MarketFactory__factory,
  OracleFactory,
  OracleFactory__factory,
  VaultFactory,
  VaultFactory__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  Controller_Optimism,
  Controller_Optimism__factory,
  StorkFactory,
  StorkFactory__factory,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('Verify Owner', () => {
  let owner: string
  let signer: SignerWithAddress

  beforeEach(async () => {
    owner = '0x66a7fDB96C583c59597de16d8b2B989231415339' // Deployer address
    ;[signer] = await HRE.ethers.getSigners()
  })

  it('ProxyAdmin', async () => {
    const proxyAdmin: ProxyAdmin = ProxyAdmin__factory.connect(
      (await HRE.deployments.get('ProxyAdmin')).address,
      signer,
    )
    expect(await proxyAdmin.callStatic.owner()).to.equal(owner)
  })

  it('OracleFactory', async () => {
    const oracleFactory: OracleFactory = OracleFactory__factory.connect(
      (await HRE.deployments.get('OracleFactory')).address,
      signer,
    )
    expect(await oracleFactory.callStatic.owner()).to.equal(owner)
  })

  it('MarketFactory', async () => {
    const marketFactory: MarketFactory = MarketFactory__factory.connect(
      (await HRE.deployments.get('MarketFactory')).address,
      signer,
    )
    expect(await marketFactory.callStatic.owner()).to.equal(owner)
  })

  it('MakerVaultFactory', async () => {
    const makerVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('MakerVaultFactory')).address,
      signer,
    )
    expect(await makerVaultFactory.callStatic.owner()).to.equal(owner)
  })

  it('SolverVaultFactory', async () => {
    const solverVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('SolverVaultFactory')).address,
      signer,
    )
    expect(await solverVaultFactory.callStatic.owner()).to.equal(owner)
  })

  it('Controller', async () => {
    const controller: Controller_Optimism = Controller_Optimism__factory.connect(
      (await HRE.deployments.get('Controller')).address,
      signer,
    )
    expect(await controller.callStatic.owner()).to.equal(owner)
  })

  it('StorkFactory', async () => {
    const storkFactory: StorkFactory = StorkFactory__factory.connect(
      (await HRE.deployments.get('StorkFactory')).address,
      signer,
    )
    expect(await storkFactory.callStatic.owner()).to.equal(owner)
  })
})
