/* eslint-disable @typescript-eslint/no-explicit-any */
import HRE, { run } from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { expect } from 'chai'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'
import { currentBlockTimestamp, increase, increaseTo, reset } from '../../../../../common/testutil/time'
import {
  AccountVerifier,
  ArbGasInfo,
  Controller_Incentivized,
  IERC20,
  IMarket,
  IOracleProvider,
  Manager,
  MarketFactory,
  MetaQuantsFactory,
  MultiInvoker,
  OracleFactory,
  OrderVerifier,
  ProxyAdmin,
  PythFactory,
  TimelockController,
  VaultFactory,
  Verifier,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'
import { GlobalStruct } from '../../../../types/generated/@perennial/v2-core/contracts/interfaces/IMarket'

const RunMigrationDeployScript = false
const SkipSettleAccounts = false
const SkipSettleVaults = false

const liquidatorAddress = '0xB092493412FCae3432487Efb33204F7B4FeF12ff'
const emptyKeeperConfig = {
  multiplierBase: 0,
  bufferBase: 0,
  multiplierCalldata: 0,
  bufferCalldata: 0,
}

const safeURLBase = 'https://safe-client.safe.global/v1/chains/42161/transactions/'
const safeID0 =
  'multisig_0x8074583B0F9CFA345405320119D4B6937C152304_0xaed1fe680650cd3fc7bd3a07a2a35ebf72eb3ef5185de404326cdbbe87e94e99'
const safeID1 =
  'multisig_0x8074583B0F9CFA345405320119D4B6937C152304_0xf33d7f5ec75a7703bab88f51fcfdb243a1e98a85cacef1ec9961993454737e03'
const safeID2 =
  'multisig_0x8074583B0F9CFA345405320119D4B6937C152304_0xb072770109fb07f166d10065ae11c1eac98f8f78decae91c3ca9f9f2642c8b02'
const safeID3 =
  'multisig_0x8074583B0F9CFA345405320119D4B6937C152304_0xd6fc7637ed147e4e9bee486f65f1d2d926999d21c476dd470c1b13ca3f72bd8d'

describe('Verify Arbitrum v2.3 Migration', () => {
  let ownerSigner: SignerWithAddress
  let oracleFactory: OracleFactory
  let pythFactory: PythFactory
  let cryptexFactory: MetaQuantsFactory
  let marketFactory: MarketFactory
  let vaultFactory: VaultFactory
  let multiinvoker: MultiInvoker
  let verifier: Verifier
  let controller: Controller_Incentivized
  let manager: Manager
  let orderVerifier: OrderVerifier
  let accountVerifier: AccountVerifier
  let proxyAdmin: ProxyAdmin
  let usdc: IERC20
  let timelock: TimelockController

  let oracleIDs: { id: string; oracle: string; keeperFactory: string }[]
  let marketsAddrs: string[]
  let markets: IMarket[]

  const beforeGlobals: { [key: string]: GlobalStruct } = {}

  const { deployments, ethers } = HRE
  const { fixture, get } = deployments

  before(async () => {
    await reset()

    if (RunMigrationDeployScript) {
      // Deploy migration
      console.log('---- Deploying Impls ----')
      await fixture('v2_3_Migration', { keepExistingDeployments: true })
      console.log('---- Done ----\n')
    }

    const multisig = await impersonateWithBalance(
      '0x8074583B0F9CFA345405320119D4B6937C152304',
      ethers.utils.parseEther('10'),
    )

    marketFactory = await ethers.getContractAt('MarketFactory', (await get('MarketFactory')).address)
    ownerSigner = await impersonateWithBalance(await marketFactory.owner(), ethers.utils.parseEther('10'))

    marketFactory = marketFactory.connect(ownerSigner)
    oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
      ownerSigner,
    )
    pythFactory = (await ethers.getContractAt('PythFactory', (await get('PythFactory')).address)).connect(ownerSigner)
    cryptexFactory = (await ethers.getContractAt('MetaQuantsFactory', (await get('CryptexFactory')).address)).connect(
      ownerSigner,
    )
    vaultFactory = (await ethers.getContractAt('VaultFactory', (await get('VaultFactory')).address)).connect(
      ownerSigner,
    )
    multiinvoker = (await ethers.getContractAt('MultiInvoker', (await get('MultiInvoker')).address)).connect(
      ownerSigner,
    )
    verifier = (await ethers.getContractAt('Verifier', (await get('Verifier')).address)).connect(ownerSigner)
    controller = (await ethers.getContractAt('Controller_Incentivized', (await get('Controller')).address)).connect(
      ownerSigner,
    )
    manager = (await ethers.getContractAt('Manager', (await get('Manager')).address)).connect(ownerSigner)
    orderVerifier = (await ethers.getContractAt('OrderVerifier', (await get('OrderVerifier')).address)).connect(
      ownerSigner,
    )
    accountVerifier = (await ethers.getContractAt('AccountVerifier', (await get('AccountVerifier')).address)).connect(
      ownerSigner,
    )
    proxyAdmin = (await ethers.getContractAt('ProxyAdmin', (await get('ProxyAdmin')).address)).connect(ownerSigner)
    usdc = (await ethers.getContractAt('IERC20', (await get('USDC')).address)).connect(ownerSigner)
    timelock = (await ethers.getContractAt('TimelockController', (await get('TimelockController')).address)).connect(
      multisig,
    )

    const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    // Hardhat fork network does not support Arbitrum built-ins, so we need to fake this call for testing
    gasInfo.getL1BaseFeeEstimate.returns(0)

    marketsAddrs = (await marketFactory.queryFilter(marketFactory.filters['InstanceRegistered(address)']())).map(
      e => e.args.instance,
    )

    markets = await Promise.all(marketsAddrs.map(a => ethers.getContractAt('IMarket', a)))

    const oracles = await pythFactory.queryFilter(pythFactory.filters.OracleCreated())
    oracleIDs = oracles.map(o => ({ id: o.args.id, oracle: o.args.oracle, keeperFactory: pythFactory.address }))

    const cryptexOracles = await cryptexFactory.queryFilter(cryptexFactory.filters.OracleCreated())
    oracleIDs = oracleIDs.concat(
      cryptexOracles.map(o => ({ id: o.args.id, oracle: o.args.oracle, keeperFactory: cryptexFactory.address })),
    )

    const v2_2Artifact = await deployments.getArtifact('MarketV2_2')
    const marketsOld = await Promise.all(marketsAddrs.map(a => ethers.getContractAt(v2_2Artifact.abi, a)))

    // Perform v2.3 Migration
    // Enter settle only for all markets
    // Update to settle only using hardhat task
    console.log('---- Changing Markets Mode to Settle ----')
    const closePayload = await fetch(`${safeURLBase}${safeID0}`).then(r => r.json())
    // await run('change-markets-mode', { settle: true, prevabi: true })
    await timelock.scheduleBatch(
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
      60,
    )
    await increase(60)
    await timelock.executeBatch(
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      closePayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
    )
    console.log('---- Done ----\n')

    await increase(10)

    // Settle all users using hardhat task
    if (!SkipSettleAccounts) {
      console.log('---- Settling Market Users ----')
      await run('settle-markets', {
        batchsize: 30,
        prevabi: true,
        timestamp: await currentBlockTimestamp(),
        factoryaddress: '0x663B38A93FdC2164D45F35051B0F905211d1C9E4,0x8bF8a44A6b2f4a174404854ec14c05204cF31dA9',
        commitgaslimit: 32_000_000,
      })
      console.log('---- Done ----\n')
    }

    // // Settle all users in vaults using hardhat task
    if (!SkipSettleVaults) {
      console.log('---- Settling Vault Users ----')
      await run('settle-vaults', {
        batchsize: 30,
        prevabi: true,
        timestamp: await currentBlockTimestamp(),
        factoryaddress: '0x663B38A93FdC2164D45F35051B0F905211d1C9E4',
        commitgaslimit: 32_000_000,
      })
      console.log('---- Done ----\n')
    }

    console.log('---- Committing Prices to New Factories ----')
    await run('commit-price', {
      priceids: oracleIDs.map(oracle => oracle.id).join(','),
      timestamp: await currentBlockTimestamp(),
      gaslimit: 32_000_000,
    })
    console.log('---- Done ----\n')

    console.log('---- Verifying Market Latest ----')
    const earlierOracleIDs = await run('v2_3_verify-market-latest')
    if (earlierOracleIDs.length > 0) throw new Error(`Found ${earlierOracleIDs.length} earlier oracle IDs`)
    console.log('---- Done ----\n')

    for (const market of marketsOld) {
      beforeGlobals[market.address] = await market.global()
    }

    // Update implementations
    console.log('---- Upgrading Implementations and Setting Up Oracles ----')
    // await run('01_v2_3_upgrade-impls')
    const step01 = await fetch(`${safeURLBase}${safeID1}`).then(r => r.json())
    await timelock.scheduleBatch(
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
      60,
    )
    await increase(60)
    await timelock.executeBatch(
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      step01.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
    )
    console.log('---- Done ----\n')

    // Update oracles
    // console.log('---- Setting up Oracles ----')
    // await run('02_v2_3_setup-oracles')
    // console.log('---- Done ----\n')

    console.log('---- Associating Markets to Oracles ----')
    // await run('03_v2_3_associate_market_to_oracle')
    const step02 = await fetch(`${safeURLBase}${safeID2}`).then(r => r.json())
    await timelock.scheduleBatch(
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
      60,
    )
    await increase(60)
    await timelock.executeBatch(
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      step02.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
    )

    // console.log('---- Updating Vault Parameters ----')
    // await run('04_v2_3_update-vault-parameters')
    // console.log('---- Done ----\n')

    console.log('---- Changing Markets Mode to Open and Updating Vaults ----')
    // await run('change-markets-mode', { open: true })
    const openPayload = await fetch(`${safeURLBase}${safeID3}`).then(r => r.json())
    await timelock.scheduleBatch(
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
      60,
    )
    await increase(60)
    console.log('---- Committing Prices to New Factories for Vault Update ----')
    await run('commit-price', {
      priceids: [oracleIDs[0].id, oracleIDs[1].id, oracleIDs[2].id, oracleIDs[3].id, oracleIDs[6].id].join(','),
      timestamp: await currentBlockTimestamp(),
      commitgaslimit: 32_000_000,
    })
    console.log('---- Done ----\n')
    await timelock.executeBatch(
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'targets').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'values').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'payloads').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'predecessor').value,
      openPayload.txData.dataDecoded.parameters.find((p: any) => p.name === 'salt').value,
    )
    console.log('---- Done ----\n')

    console.log('---- Finished Running Migration...Running Tests ----\n')
  })

  it('Migrates', async () => {
    /* Check all initializations */
    await expect(marketFactory.initialize()).to.be.revertedWithCustomError(
      marketFactory,
      'InitializableAlreadyInitializedError',
    )
    await expect(pythFactory.initialize(constants.AddressZero)).to.be.revertedWithCustomError(
      pythFactory,
      'InitializableAlreadyInitializedError',
    )
    await expect(cryptexFactory.initialize(constants.AddressZero)).to.be.revertedWithCustomError(
      cryptexFactory,
      'InitializableAlreadyInitializedError',
    )
    await expect(oracleFactory.initialize()).to.be.revertedWithCustomError(
      oracleFactory,
      'InitializableAlreadyInitializedError',
    )
    await expect(vaultFactory.initialize()).to.be.revertedWithCustomError(
      vaultFactory,
      'InitializableAlreadyInitializedError',
    )
    await expect(multiinvoker.initialize(constants.AddressZero)).to.be.revertedWithCustomError(
      multiinvoker,
      'InitializableAlreadyInitializedError',
    )
    await expect(verifier.initialize(constants.AddressZero)).to.be.revertedWithCustomError(
      verifier,
      'InitializableAlreadyInitializedError',
    )
    await expect(
      controller[
        'initialize(address,address,(uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256))'
      ](constants.AddressZero, constants.AddressZero, emptyKeeperConfig, emptyKeeperConfig, emptyKeeperConfig),
    ).to.be.revertedWithCustomError(controller, 'InitializableAlreadyInitializedError')
    await expect(
      manager.initialize(constants.AddressZero, emptyKeeperConfig, emptyKeeperConfig),
    ).to.be.revertedWithCustomError(manager, 'InitializableAlreadyInitializedError')

    // Check Oracle Factories setup
    expect(await pythFactory.callStatic.owner()).to.be.eq(ownerSigner.address)
    expect(await oracleFactory.callStatic.factories(pythFactory.address)).to.be.true
    expect(await cryptexFactory.callStatic.owner()).to.be.eq(ownerSigner.address)
    expect(await oracleFactory.callStatic.factories(cryptexFactory.address)).to.be.true

    expect(await proxyAdmin.getProxyImplementation(marketFactory.address)).to.be.equal(
      (await get('MarketFactoryImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(pythFactory.address)).to.be.equal(
      (await get('PythFactoryImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(cryptexFactory.address)).to.be.equal(
      (await get('CryptexFactoryImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(oracleFactory.address)).to.be.equal(
      (await get('OracleFactoryImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(vaultFactory.address)).to.be.equal(
      (await get('VaultFactoryImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(multiinvoker.address)).to.be.equal(
      (await get('MultiInvokerImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(verifier.address)).to.be.equal((await get('VerifierImpl')).address)
    expect(await proxyAdmin.getProxyImplementation(controller.address)).to.be.equal(
      (await get('ControllerImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(manager.address)).to.be.equal((await get('ManagerImpl')).address)
    expect(await proxyAdmin.getProxyImplementation(orderVerifier.address)).to.be.equal(
      (await get('OrderVerifierImpl')).address,
    )
    expect(await proxyAdmin.getProxyImplementation(accountVerifier.address)).to.be.equal(
      (await get('AccountVerifierImpl')).address,
    )

    // Check Factory beacon proxy impls
    expect(await marketFactory.implementation()).to.be.equal((await get('MarketImpl')).address)
    expect(await pythFactory.implementation()).to.be.equal((await get('KeeperOracleImpl')).address)
    expect(await cryptexFactory.implementation()).to.be.equal((await get('KeeperOracleImpl')).address)
    expect(await oracleFactory.implementation()).to.be.equal((await get('OracleImpl')).address)
    expect(await vaultFactory.implementation()).to.be.equal((await get('VaultImpl')).address)
    expect(await controller.implementation()).to.be.equal((await get('AccountImpl')).address)

    // Check Verifier points to MarketFactory
    expect(await verifier.marketFactory()).to.be.equal(marketFactory.address)

    // Check Oracles point to PythFactory
    for (const oracle of oracleIDs) {
      const contract = await ethers.getContractAt('Oracle', await oracleFactory.oracles(oracle.id))
      const global = await contract.global()
      expect((await contract.oracles(global.current)).provider).to.equal(
        await (oracle.keeperFactory === cryptexFactory.address ? cryptexFactory : pythFactory).oracles(oracle.id),
      )
    }

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]
      await expect(market.settle(ethers.constants.AddressZero)).to.not.be.reverted
    }

    await commitPriceForIds(
      oracleIDs.map(oracle => oracle.id),
      await currentBlockTimestamp(),
      undefined,
      32_000_000,
    )

    // Assert oracle prices are close to previous ones
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]

      const oracle = await ethers.getContractAt('IOracle', await market.oracle())
      const oraclePrice = await oracle.latest()
      const lowerRange = BigNumber.from(beforeGlobals[market.address].latestPrice).mul(5).div(10)
      const upperRange = BigNumber.from(beforeGlobals[market.address].latestPrice).mul(15).div(10)
      expect(oraclePrice.price).to.be.within(lowerRange, upperRange)

      await expect(market.settle(ethers.constants.AddressZero)).to.not.be.reverted
    }
  })

  it('Runs full request/fulfill flow for each market', async () => {
    const makerAccount = '0x1deFb9E9aE40d46C358dc0a185408dc178483851'
    const perennialUser = await impersonateWithBalance(makerAccount, ethers.utils.parseEther('10'))
    const usdcHolder = await impersonateWithBalance(
      '0x47c031236e19d024b42f8AE6780E44A573170703',
      ethers.utils.parseEther('1000000'),
    )
    await usdc.connect(perennialUser).approve(multiinvoker.address, ethers.constants.MaxUint256)
    await usdc.connect(usdcHolder).transfer(perennialUser.address, ethers.utils.parseUnits('1000000', 6))

    await increase(10)

    const idsToCommit = oracleIDs.map(oracle => oracle.id)

    const oracleProviders: IOracleProvider[] = []
    const actions: { action: number; args: string }[] = []

    for (const market of markets) {
      const riskParameter = await market.riskParameter()
      // Update market parameters to make it easier to fill the oracle with new prices
      await market.connect(ownerSigner).updateRiskParameter({
        ...riskParameter,
        staleAfter: 100,
      })
      const oracle = await ethers.getContractAt('Oracle', await market.oracle())
      const oracleGlobal = await oracle.global()
      const oracleProvider = await ethers.getContractAt(
        'IOracleProvider',
        (
          await oracle.oracles(oracleGlobal.current)
        ).provider,
      )
      oracleProviders.push(oracleProvider)

      actions.push({
        action: 1,
        args: ethers.utils.defaultAbiCoder.encode(
          [
            'address',
            'uint256',
            'uint256',
            'uint256',
            'int256',
            'bool',
            'tuple(uint256,address,bool)',
            'tuple(uint256,address,bool)',
          ],
          [
            market.address,
            100,
            0,
            0,
            ethers.utils.parseUnits('100', 6),
            true,
            [0, ethers.constants.AddressZero, false],
            [0, ethers.constants.AddressZero, false],
          ],
        ),
      })
    }

    await increaseTo(Math.floor(Date.now() / 1000) - 100)

    const currentTimestamp = await currentBlockTimestamp()
    await commitPriceForIds(idsToCommit, currentTimestamp, undefined, 32000000)
    console.log('Updating position in markets')
    const invokeTx = await multiinvoker.connect(perennialUser)['invoke((uint8,bytes)[])'](actions)
    const nextVersionTimestamp = nextVersionForTimestamp(await currentBlockTimestamp())

    for (const oracleProvider of oracleProviders)
      await expect(invokeTx)
        .to.emit(oracleProvider, 'OracleProviderVersionRequested')
        .withArgs(nextVersionTimestamp, true)

    await increase(20)

    const hash = await commitPriceForIds(idsToCommit, nextVersionTimestamp + 5, undefined, 32000000)
    const tx = await ethers.provider.getTransaction(hash)

    for (const oracleProvider of oracleProviders)
      await expect(tx).to.emit(oracleProvider, 'OracleProviderVersionFulfilled')

    for (const market of markets) {
      await market.settle(perennialUser.address)
      const local = await market.locals(perennialUser.address)
      const checkpoint = await market.checkpoints(perennialUser.address, nextVersionTimestamp)

      expect(local.currentId).to.equal(local.latestId)
      expect(local.collateral).to.be.greaterThan(0)
      expect(checkpoint.transfer).to.be.equal(ethers.utils.parseUnits('100', 6))
    }

    await run('check-solvency', { full: true, batchsize: 30 })
  }).timeout(10000000)

  it('transitions checkpoint for liquidator', async () => {
    const liquidatorSigner = await impersonateWithBalance(liquidatorAddress, ethers.utils.parseEther('10'))

    await increase(10)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const btcMarket = await ethers.getContractAt('IMarket', '0xcC83e3cDA48547e3c250a88C8D5E97089Fd28F60')
    const currentTimestamp = await currentBlockTimestamp()
    await commitPriceForIds([oracleIDs[0].id, oracleIDs[1].id], currentTimestamp)

    const nextVersionTimestamp = nextVersionForTimestamp(await currentBlockTimestamp())
    await ethMarket
      .connect(liquidatorSigner)
      ['update(address,uint256,uint256,uint256,int256,bool)'](liquidatorSigner.address, 0, 0, 0, 0, false)
    await btcMarket
      .connect(liquidatorSigner)
      ['update(address,uint256,uint256,uint256,int256,bool)'](liquidatorSigner.address, 0, 0, 0, 0, false)

    await increase(10)

    await commitPriceForIds([oracleIDs[0].id, oracleIDs[1].id], nextVersionTimestamp + 4)

    await ethMarket.settle(liquidatorSigner.address)
    await btcMarket.settle(liquidatorSigner.address)
    const ethCheckpoint = await ethMarket.checkpoints(liquidatorSigner.address, nextVersionTimestamp)
    const btcCheckpoint = await btcMarket.checkpoints(liquidatorSigner.address, nextVersionTimestamp)
    expect((await ethMarket.locals(liquidatorAddress)).collateral).to.be.equal(ethCheckpoint.collateral)
    expect((await btcMarket.locals(liquidatorAddress)).collateral).to.be.equal(btcCheckpoint.collateral)
  })

  it('liquidates', async () => {
    const [liquidator] = await ethers.getSigners()
    const perennialUser = await impersonateWithBalance(
      '0x13949042fae1b28febb1a1a3e9471a2cd9018ac7',
      ethers.utils.parseEther('10'),
    )

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const riskParameter = await ethMarket.riskParameter()

    await increase(10)

    const currentTimestamp = await currentBlockTimestamp()
    await commitPriceForIds([oracleIDs[0].id], currentTimestamp)
    await ethMarket
      .connect(ownerSigner)
      .updateRiskParameter({ ...riskParameter, minMargin: 500e6, minMaintenance: 500e6 })

    await ethMarket
      .connect(liquidator)
      ['update(address,uint256,uint256,uint256,int256,bool)'](perennialUser.address, 0, 0, 0, 0, true)
    await commitPriceForIds([oracleIDs[0].id], nextVersionForTimestamp(await currentBlockTimestamp()) + 4)

    await ethMarket.connect(liquidator).settle(perennialUser.address)
    await ethMarket.connect(liquidator).settle(liquidator.address)

    // Liquidator should have received some collateral, but it is not a dynamic value based on settlement fee
    expect((await ethMarket.locals(liquidator.address)).claimable).to.be.greaterThan(1)
  })

  it('settles vaults', async () => {
    // await run('check-vault-shares')
    const vaultUser = '0x66a7fDB96C583c59597de16d8b2B989231415339'
    const perennialUser = await impersonateWithBalance(vaultUser, ethers.utils.parseEther('10'))
    const usdcHolder = await impersonateWithBalance(
      '0x47c031236e19d024b42f8AE6780E44A573170703',
      ethers.utils.parseEther('1000000'),
    )
    await usdc.connect(perennialUser).approve(multiinvoker.address, ethers.constants.MaxUint256)
    await usdc.connect(usdcHolder).transfer(perennialUser.address, ethers.utils.parseUnits('1000000', 6))

    await increase(10)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const btcMarket = await ethers.getContractAt('IMarket', '0xcC83e3cDA48547e3c250a88C8D5E97089Fd28F60')
    const linkMarket = await ethers.getContractAt('IMarket', '0xD9c296A7Bee1c201B9f3531c7AC9c9310ef3b738')
    const solMarket = await ethers.getContractAt('IMarket', '0x02258bE4ac91982dc1AF7a3D2C4F05bE6079C253')
    const maticMarket = await ethers.getContractAt('IMarket', '0x7e34B5cBc6427Bd53ECFAeFc9AC2Cad04e982f78')

    const currentTimestamp = await currentBlockTimestamp()
    await commitPriceForIds(
      [oracleIDs[0].id, oracleIDs[1].id, oracleIDs[2].id, oracleIDs[3].id, oracleIDs[6].id],
      currentTimestamp,
    )

    const asterVault = await ethers.getContractAt('IVault', (await get('AsterVault')).address)
    const begoniaVault = await ethers.getContractAt('IVault', (await get('BegoniaVault')).address)

    const depositActions = [
      {
        action: 2,
        args: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'bool'],
          [asterVault.address, 100e6, 0, 0, true],
        ),
      },
      {
        action: 2,
        args: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'bool'],
          [begoniaVault.address, 100e6, 0, 0, true],
        ),
      },
    ]

    console.log('Depositing to vaults')
    await expect(multiinvoker.connect(perennialUser)['invoke((uint8,bytes)[])'](depositActions))
      .to.emit(ethMarket, 'OrderCreated')
      .to.emit(btcMarket, 'OrderCreated')
      .to.emit(linkMarket, 'OrderCreated')
      .to.emit(solMarket, 'OrderCreated')
      .to.emit(maticMarket, 'OrderCreated')

    let nextVersionTimestamp = nextVersionForTimestamp(await currentBlockTimestamp())

    await increase(10)

    await commitPriceForIds(
      [oracleIDs[0].id, oracleIDs[1].id, oracleIDs[2].id, oracleIDs[3].id, oracleIDs[6].id],
      nextVersionTimestamp + 4,
    )

    await increase(10)
    console.log('Withdrawing from vaults')
    const withdrawActions = [
      {
        action: 2,
        args: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'bool'],
          [asterVault.address, 0, 20e6, 0, true],
        ),
      },
      {
        action: 2,
        args: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'bool'],
          [begoniaVault.address, 0, 20e6, 0, true],
        ),
      },
    ]
    await expect(multiinvoker.connect(perennialUser)['invoke((uint8,bytes)[])'](withdrawActions))
      .to.emit(ethMarket, 'OrderCreated')
      .to.emit(btcMarket, 'OrderCreated')
      .to.emit(linkMarket, 'OrderCreated')
      .to.emit(solMarket, 'OrderCreated')
      .to.emit(maticMarket, 'OrderCreated')
    nextVersionTimestamp = nextVersionForTimestamp(await currentBlockTimestamp())

    await commitPriceForIds(
      [oracleIDs[0].id, oracleIDs[1].id, oracleIDs[2].id, oracleIDs[3].id, oracleIDs[6].id],
      nextVersionTimestamp + 4,
    )

    await increase(10)
    console.log('Claiming from vaults')
    const claimActions = [
      {
        action: 2,
        args: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'bool'],
          [asterVault.address, 0, 0, 10e6, true],
        ),
      },
      {
        action: 2,
        args: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'bool'],
          [begoniaVault.address, 0, 0, 10e6, true],
        ),
      },
    ]
    const balanceBefore = await usdc.balanceOf(perennialUser.address)
    await multiinvoker.connect(perennialUser)['invoke((uint8,bytes)[])'](claimActions)
    const balanceAfter = await usdc.balanceOf(perennialUser.address)
    expect(balanceAfter.sub(balanceBefore)).to.be.equal(20e6)
  })
})

async function commitPriceForIds(priceIds: string[], timestamp: number, factoryAddress?: string, gasLimit?: number) {
  const hash = await run('commit-price', {
    priceids: priceIds.join(','),
    timestamp,
    factoryaddress: factoryAddress,
    gaslimit: gasLimit,
  })
  const tx = await HRE.ethers.provider.getTransaction(hash)
  await tx.wait()

  return hash
}

function nextVersionForTimestamp(timestamp: number) {
  return Math.ceil((timestamp + 0.9) / 10) * 10
}
