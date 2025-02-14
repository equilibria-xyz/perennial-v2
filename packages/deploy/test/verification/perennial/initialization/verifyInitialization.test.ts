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
  Verifier,
  Verifier__factory,
  AccountVerifier,
  AccountVerifier__factory,
  MultiInvoker,
  MultiInvoker__factory,
  Controller_Arbitrum__factory,
  Controller_Arbitrum,
  Manager,
  Manager__factory,
  PythFactory,
  PythFactory__factory,
  MetaQuantsFactory__factory,
  MetaQuantsFactory,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants } from 'ethers'

describe('Verify Initialization', () => {
  let signer: SignerWithAddress

  beforeEach(async () => {
    ;[signer] = await HRE.ethers.getSigners()
  })

  it('MarketFactory', async () => {
    const marketFactory: MarketFactory = MarketFactory__factory.connect(
      (await HRE.deployments.get('MarketFactory')).address,
      signer,
    )
    // check that marketFactory is initialized
    expect(await marketFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
  })

  it('Verifier', async () => {
    const verifier: Verifier = Verifier__factory.connect((await HRE.deployments.get('Verifier')).address, signer)
    expect(await verifier.callStatic.marketFactory()).to.equal((await HRE.deployments.get('MarketFactory')).address)
  })

  it('AccountVerifier', async () => {
    const accountVerifier: AccountVerifier = AccountVerifier__factory.connect(
      (await HRE.deployments.get('AccountVerifier')).address,
      signer,
    )
    expect(await accountVerifier.callStatic.verifier()).to.equal((await HRE.deployments.get('Verifier')).address)
  })

  it('OracleFactory', async () => {
    const oracleFactory: OracleFactory = OracleFactory__factory.connect(
      (await HRE.deployments.get('OracleFactory')).address,
      signer,
    )
    expect(await oracleFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
  })

  it('MakerVaultFactory', async () => {
    const makerVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('MakerVaultFactory')).address,
      signer,
    )
    expect(await makerVaultFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
  })

  it('SolverVaultFactory', async () => {
    const solverVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('SolverVaultFactory')).address,
      signer,
    )
    expect(await solverVaultFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
  })

  it('MultiInvoker', async () => {
    const multiInvoker: MultiInvoker = MultiInvoker__factory.connect(
      (await HRE.deployments.get('MultiInvoker')).address,
      signer,
    )
    expect(await multiInvoker.callStatic.ethTokenOracleFeed()).to.equal(
      (await HRE.deployments.get('ChainlinkETHUSDFeed')).address,
    )
  })

  it('Controller', async () => {
    const controller: Controller_Arbitrum = Controller_Arbitrum__factory.connect(
      (await HRE.deployments.get('Controller')).address,
      signer,
    )
    expect(await controller.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await controller.callStatic.verifier()).to.equal((await HRE.deployments.get('AccountVerifier')).address)
    expect(await controller.callStatic.ethTokenOracleFeed()).to.equal(
      (await HRE.deployments.get('ChainlinkETHUSDFeed')).address,
    )
  })

  it('Manager', async () => {
    const manager: Manager = Manager__factory.connect((await HRE.deployments.get('Manager')).address, signer)
    expect(await manager.callStatic.ethTokenOracleFeed()).to.equal(
      (await HRE.deployments.get('ChainlinkETHUSDFeed')).address,
    )
  })

  it('PythFactory', async () => {
    const pythFactory: PythFactory = PythFactory__factory.connect(
      (await HRE.deployments.get('PythFactory')).address,
      signer,
    )
    expect(await pythFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await pythFactory.callStatic.oracleFactory()).to.equal((await HRE.deployments.get('OracleFactory')).address)
  })

  it('CryptexFactory', async () => {
    const cryptexFactory: MetaQuantsFactory = MetaQuantsFactory__factory.connect(
      (await HRE.deployments.get('CryptexFactory')).address,
      signer,
    )
    expect(await cryptexFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await cryptexFactory.callStatic.oracleFactory()).to.equal(
      (await HRE.deployments.get('OracleFactory')).address,
    )
  })

  it('StorkFactory', async () => {
    const storkFactory: StorkFactory = StorkFactory__factory.connect(
      (await HRE.deployments.get('StorkFactory')).address,
      signer,
    )
    expect(await storkFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await storkFactory.callStatic.oracleFactory()).to.equal((await HRE.deployments.get('OracleFactory')).address)
  })
})
