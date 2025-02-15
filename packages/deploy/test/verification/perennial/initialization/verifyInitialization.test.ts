import HRE, { ethers } from 'hardhat'
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
  KeeperOracle,
  KeeperOracle__factory,
  IERC20__factory,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants } from 'ethers'
import { DEFAULT_PROTOCOL_PARAMETER, KeeperFactoryParameter } from '../../../../util/constants'

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
    expect(await marketFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await marketFactory.callStatic.oracleFactory()).to.equal(
      (await HRE.deployments.get('OracleFactory')).address,
    )
    expect(await marketFactory.callStatic.verifier()).to.equal((await HRE.deployments.get('Verifier')).address)

    // check parameter
    expect((await marketFactory.callStatic.parameter()).maxFee).to.equal(DEFAULT_PROTOCOL_PARAMETER.maxFee)
    expect((await marketFactory.callStatic.parameter()).maxLiquidationFee).to.equal(
      DEFAULT_PROTOCOL_PARAMETER.maxLiquidationFee,
    )
    expect((await marketFactory.callStatic.parameter()).maxCut).to.equal(DEFAULT_PROTOCOL_PARAMETER.maxCut)
    expect((await marketFactory.callStatic.parameter()).maxRate).to.equal(DEFAULT_PROTOCOL_PARAMETER.maxRate)
    expect((await marketFactory.callStatic.parameter()).minMaintenance).to.equal(
      DEFAULT_PROTOCOL_PARAMETER.minMaintenance,
    )
    expect((await marketFactory.callStatic.parameter()).minEfficiency).to.equal(
      DEFAULT_PROTOCOL_PARAMETER.minEfficiency,
    )
    expect((await marketFactory.callStatic.parameter()).referralFee).to.equal(DEFAULT_PROTOCOL_PARAMETER.referralFee)
    expect((await marketFactory.callStatic.parameter()).maxStaleAfter).to.equal(
      DEFAULT_PROTOCOL_PARAMETER.maxStaleAfter,
    )
  })

  it('Verifier', async () => {
    const verifier: Verifier = Verifier__factory.connect((await HRE.deployments.get('Verifier')).address, signer)
    expect(await verifier.callStatic.marketFactory()).to.equal((await HRE.deployments.get('MarketFactory')).address)
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
    expect(await makerVaultFactory.callStatic.marketFactory()).to.equal(
      (await HRE.deployments.get('MarketFactory')).address,
    )
  })

  it('SolverVaultFactory', async () => {
    const solverVaultFactory: VaultFactory = VaultFactory__factory.connect(
      (await HRE.deployments.get('SolverVaultFactory')).address,
      signer,
    )
    expect(await solverVaultFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await solverVaultFactory.callStatic.marketFactory()).to.equal(
      (await HRE.deployments.get('MarketFactory')).address,
    )
  })

  it('MultiInvoker', async () => {
    const multiInvoker: MultiInvoker = MultiInvoker__factory.connect(
      (await HRE.deployments.get('MultiInvoker')).address,
      signer,
    )
    expect(await multiInvoker.callStatic.ethTokenOracleFeed()).to.equal(
      (await HRE.deployments.get('ChainlinkETHUSDFeed')).address,
    )
    expect(await multiInvoker.DSU()).to.equal((await HRE.deployments.get('DSU')).address)
    expect(await multiInvoker.callStatic.USDC()).to.equal((await HRE.deployments.get('USDC')).address)
    expect(await multiInvoker.callStatic.batcher()).to.equal(
      (await HRE.deployments.getOrNull('DSUBatcher'))?.address ?? constants.AddressZero,
    )
    expect(await multiInvoker.callStatic.marketFactory()).to.equal((await HRE.deployments.get('MarketFactory')).address)
    expect(await multiInvoker.callStatic.makerVaultFactory()).to.equal(
      (await HRE.deployments.get('MakerVaultFactory')).address,
    )
    expect(await multiInvoker.callStatic.solverVaultFactory()).to.equal(
      (await HRE.deployments.get('SolverVaultFactory')).address,
    )
    expect(await multiInvoker.callStatic.reserve()).to.equal((await HRE.deployments.get('DSUReserve')).address)
    expect(await multiInvoker.callStatic.keepBufferBase()).to.equal(1_500_000)

    const commitCalldata = 17_000
    const commitIncrement = 4_200
    expect(await multiInvoker.callStatic.keepBufferCalldata()).to.equal(commitCalldata + commitIncrement)

    const marketFactory: MarketFactory = MarketFactory__factory.connect(
      (await HRE.deployments.get('MarketFactory')).address,
      signer,
    )

    expect(await marketFactory.callStatic.extensions(multiInvoker.address)).to.equal(true)
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
    expect(await controller.callStatic.marketFactory()).to.equal((await HRE.deployments.get('MarketFactory')).address)
    expect(await controller.callStatic.nonceManager()).to.equal((await HRE.deployments.get('Verifier')).address)

    const keepConfig = await controller.callStatic.keepConfig()
    expect(keepConfig.multiplierBase).to.equal(ethers.utils.parseEther('1.05'))
    expect(keepConfig.bufferBase).to.equal(275_000n)
    expect(keepConfig.multiplierCalldata).to.equal(ethers.utils.parseEther('1.05'))
    expect(keepConfig.bufferCalldata).to.equal(0n)

    const keepConfigBuffered = await controller.callStatic.keepConfigBuffered()
    expect(keepConfigBuffered.multiplierBase).to.equal(ethers.utils.parseEther('1.08'))
    expect(keepConfigBuffered.bufferBase).to.equal(788_000n)
    expect(keepConfigBuffered.multiplierCalldata).to.equal(ethers.utils.parseEther('1.08'))
    expect(keepConfigBuffered.bufferCalldata).to.equal(35_200n)

    const keepConfigWithdrawal = await controller.callStatic.keepConfigWithdrawal()
    expect(keepConfigWithdrawal.multiplierBase).to.equal(ethers.utils.parseEther('0'))
    expect(keepConfigWithdrawal.bufferBase).to.equal(300_000n)
    expect(keepConfigWithdrawal.multiplierCalldata).to.equal(ethers.utils.parseEther('1.05'))
    expect(keepConfigWithdrawal.bufferCalldata).to.equal(0n)
  })

  it('Manager', async () => {
    const manager: Manager = Manager__factory.connect((await HRE.deployments.get('Manager')).address, signer)
    expect(await manager.callStatic.ethTokenOracleFeed()).to.equal(
      (await HRE.deployments.get('ChainlinkETHUSDFeed')).address,
    )
    expect(await manager.callStatic.DSU()).to.equal((await HRE.deployments.get('DSU')).address)
    expect(await manager.callStatic.USDC()).to.equal((await HRE.deployments.get('USDC')).address)
    expect(await manager.callStatic.reserve()).to.equal((await HRE.deployments.get('DSUReserve')).address)
    expect(await manager.callStatic.verifier()).to.equal((await HRE.deployments.get('OrderVerifier')).address)
    expect(await manager.callStatic.controller()).to.equal((await HRE.deployments.get('Controller')).address)
    expect(await manager.callStatic.marketFactory()).to.equal((await HRE.deployments.get('MarketFactory')).address)

    const keepConfig = await manager.callStatic.keepConfig()
    expect(keepConfig.multiplierBase).to.equal(ethers.utils.parseEther('1.05'))
    expect(keepConfig.bufferBase).to.equal(788_000n)
    expect(keepConfig.multiplierCalldata).to.equal(0n)
    expect(keepConfig.bufferCalldata).to.equal(35_200n)

    const keepConfigBuffered = await manager.callStatic.keepConfigBuffered()
    expect(keepConfigBuffered.multiplierBase).to.equal(ethers.utils.parseEther('1.05'))
    expect(keepConfigBuffered.bufferBase).to.equal(788_000n)
    expect(keepConfigBuffered.multiplierCalldata).to.equal(ethers.utils.parseEther('1.05'))
    expect(keepConfigBuffered.bufferCalldata).to.equal(35_200n)
  })

  it('StorkFactory', async () => {
    const storkFactory: StorkFactory = StorkFactory__factory.connect(
      (await HRE.deployments.get('StorkFactory')).address,
      signer,
    )
    expect(await storkFactory.callStatic.owner()).to.not.equal(constants.AddressZero)
    expect(await storkFactory.callStatic.oracleFactory()).to.equal((await HRE.deployments.get('OracleFactory')).address)

    expect(await storkFactory.callStatic.stork()).to.equal((await HRE.deployments.get('Stork')).address)
    expect(await storkFactory.callStatic.commitmentGasOracle()).to.equal(
      (await HRE.deployments.get('Stork_CommitmentGasOracle')).address,
    )
    expect(await storkFactory.callStatic.settlementGasOracle()).to.equal(
      (await HRE.deployments.get('Stork_SettlementGasOracle')).address,
    )
    expect(await storkFactory.callStatic.oracleFactory()).to.equal((await HRE.deployments.get('OracleFactory')).address)

    const storkFactoryParameter = await storkFactory.callStatic.parameter()
    expect(storkFactoryParameter.latestGranularity).to.equal(1)
    expect(storkFactoryParameter.currentGranularity).to.equal(KeeperFactoryParameter.granularity)
    expect(storkFactoryParameter.oracleFee).to.equal(KeeperFactoryParameter.oracleFee)
    expect(storkFactoryParameter.validFrom).to.equal(KeeperFactoryParameter.validFrom)
    expect(storkFactoryParameter.validTo).to.equal(KeeperFactoryParameter.validTo)
  })
})
