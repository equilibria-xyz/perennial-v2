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
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('Verify Implementation', () => {
  let signer: SignerWithAddress

  beforeEach(async () => {
    ;[signer] = await HRE.ethers.getSigners()
  })

  it('MarketFactory', async () => {
    const marketFactory: MarketFactory = MarketFactory__factory.connect(
      (await HRE.deployments.get('MarketFactory')).address,
      signer,
    )
    expect(await marketFactory.callStatic.implementation()).to.equal(
      (await HRE.deployments.get('MarketFactoryImpl')).address,
    )
  })

  it('OracleFactory', async () => {
    const oracleFactory: OracleFactory = OracleFactory__factory.connect(
      (await HRE.deployments.get('OracleFactory')).address,
      signer,
    )
    expect(await oracleFactory.callStatic.implementation()).to.equal(
      (await HRE.deployments.get('OracleFactoryImpl')).address,
    )
  })

  it('MakerVaultFactory', async () => {
    const makerVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('MakerVaultFactory')).address,
      signer,
    )
    expect(await makerVaultFactory.callStatic.implementation()).to.equal(
      (await HRE.deployments.get('MakerVaultFactoryImpl')).address,
    )
  })

  it('SolverVaultFactory', async () => {
    const solverVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('SolverVaultFactory')).address,
      signer,
    )
    expect(await solverVaultFactory.callStatic.implementation()).to.equal(
      (await HRE.deployments.get('SolverVaultFactoryImpl')).address,
    )
  })

  it('StorkFactory', async () => {
    const storkFactory: StorkFactory = StorkFactory__factory.connect(
      (await HRE.deployments.get('StorkFactory')).address,
      signer,
    )
    expect(await storkFactory.callStatic.implementation()).to.equal(
      (await HRE.deployments.get('StorkFactoryImpl')).address,
    )
  })
})
