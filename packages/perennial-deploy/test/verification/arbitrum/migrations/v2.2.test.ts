import HRE, { run } from 'hardhat'
import { expect } from 'chai'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'
import { currentBlockTimestamp, increase, reset } from '../../../../../common/testutil/time'
import {
  ArbGasInfo,
  IERC20,
  IMarket,
  MarketFactory,
  MultiInvoker,
  OracleFactory,
  ProxyAdmin,
  PythFactory,
  VaultFactory,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'
import { GlobalStruct } from '../../../../types/generated/@equilibria/perennial-v2/contracts/Market'

const RunMigrationDeployScript = true
const SkipUpdateVaultWeights = true
const SkipSettleAccounts = false
const SkipSettleVaults = false

describe('Verify Arbitrum v2.2 Migration', () => {
  let DSU: IERC20
  let USDC: IERC20
  let ownerSigner: SignerWithAddress
  let oracleFactory: OracleFactory
  let pythFactory: PythFactory
  let marketFactory: MarketFactory
  let vaultFactory: VaultFactory
  let multiinvoker: MultiInvoker
  let proxyAdmin: ProxyAdmin

  let oracleIDs: { id: string; oracle: string }[]
  let marketsAddrs: string[]
  let markets: IMarket[]

  const beforeGlobals: GlobalStruct[] = []

  const { deployments, ethers } = HRE
  const { fixture, get } = deployments

  before(async () => {
    await reset()

    if (RunMigrationDeployScript) {
      // Deploy migration
      console.log('---- Deploying Impls ----')
      await fixture('v2_2_Migration', { keepExistingDeployments: true })
      console.log('---- Done ----\n')
    }

    DSU = await ethers.getContractAt('IERC20', (await get('DSU')).address)
    USDC = await ethers.getContractAt('IERC20', (await get('USDC')).address)

    marketFactory = await ethers.getContractAt('MarketFactory', (await get('MarketFactory')).address)
    ownerSigner = await impersonateWithBalance(await marketFactory.owner(), ethers.utils.parseEther('10'))

    marketFactory = marketFactory.connect(ownerSigner)
    oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
      ownerSigner,
    )
    pythFactory = (await ethers.getContractAt('PythFactory', (await get('PythFactory')).address)).connect(ownerSigner)
    vaultFactory = (await ethers.getContractAt('VaultFactory', (await get('VaultFactory')).address)).connect(
      ownerSigner,
    )
    multiinvoker = (await ethers.getContractAt('MultiInvoker', (await get('MultiInvoker')).address)).connect(
      ownerSigner,
    )
    proxyAdmin = (await ethers.getContractAt('ProxyAdmin', (await get('ProxyAdmin')).address)).connect(ownerSigner)

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
    oracleIDs = oracles.map(o => ({ id: o.args.id, oracle: o.args.oracle }))

    const v2_1_1Artifact = await deployments.getArtifact('MarketV2_1_1')
    const marketsOld = await Promise.all(marketsAddrs.map(a => ethers.getContractAt(v2_1_1Artifact.abi, a)))

    console.log('---- Running Pre-Migration Tasks ----')
    // Update vault we ights so they add up to 1e6
    if (!SkipUpdateVaultWeights) {
      await run('2_2_update-vault-weights', { prevabi: true })
    }
    // Register pyth factory with oracle factory
    // During migration this will already be done
    await oracleFactory.register(pythFactory.address)
    console.log('---- Done ----\n')

    // Perform v2.2 Migration
    // Enter settle only for all markets
    // Update to settle only using hardhat task
    console.log('---- Changing Markets Mode to Settle ----')
    await run('change-markets-mode', { settle: true, prevabi: true })
    console.log('---- Done ----\n')

    await increase(1000)

    await commitPriceForIds(
      [
        '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
        '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
        '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
        '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52',
        '0x09f7c1d7dfbb7df2b8fe3d3d87ee94a2259d212da4f30c1f0540d066dfa44723',
        '0x2f2d17abbc1e781bd87b4a5d52c8b2856886f5c482fa3593cebf6795040ab0b6',
        '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
        '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
        '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8',
        '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
        '0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
      ],
      (await currentBlockTimestamp()) + 1,
      '0x6b60e7c96B4d11A63891F249eA826f8a73Ef4E6E',
    )

    // Settle all users using hardhat task
    if (!SkipSettleAccounts) {
      console.log('---- Settling Market Users ----')
      await run('settle-markets', { batchsize: 30, prevabi: true, timestamp: await currentBlockTimestamp() })
      console.log('---- Done ----\n')
    }

    // Settle all users in vaults using hardhat task
    if (!SkipSettleVaults) {
      console.log('---- Settling Vault Users ----')
      await run('settle-vaults', { batchsize: 30, prevabi: true, timestamp: await currentBlockTimestamp() })
      console.log('---- Done ----\n')
    }

    for (const market of marketsOld) {
      beforeGlobals.push(await market.global())
    }

    // Update implementations
    console.log('---- Upgrading Implementations ----')
    await run('2_2_upgrade-impls')
    console.log('---- Done ----\n')

    // Update oracles
    console.log('---- Setting up Oracles ----')
    await run('2_2_setup-oracles')
    console.log('---- Done ----\n')

    console.log('---- Changing Markets Mode to Open ----')
    await run('change-markets-mode', { open: true })
    console.log('---- Done ----\n')
  })

  it('Migrates', async () => {
    expect(await pythFactory.callStatic.owner()).to.be.eq(ownerSigner.address)
    expect(await oracleFactory.callStatic.factories(pythFactory.address)).to.be.true
    expect(await USDC.balanceOf(oracleFactory.address)).to.be.eq(0)

    for (const oracle of oracleIDs) {
      const contract = await ethers.getContractAt('Oracle', await oracleFactory.oracles(oracle.id))
      const global = await contract.global()
      expect((await contract.oracles(global.current)).provider).to.equal(await pythFactory.oracles(oracle.id))
    }

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]

      const global = await market.global()
      expect(global.latestPrice).to.be.equal(beforeGlobals[i].latestPrice)
      expect(global.latestId).to.be.equal(beforeGlobals[i].latestId)
      expect(global.currentId).to.be.equal(beforeGlobals[i].currentId)
      expect(global.currentId).to.equal(global.latestId)

      await expect(market.settle(ethers.constants.AddressZero)).to.not.be.reverted
    }
  })

  it('Runs full request/fulfill flow', async () => {
    const makerAccount = '0xF8b6010FD6ba8F3E52c943A1473B1b1459a73094'
    const perennialUser = await impersonateWithBalance(makerAccount, ethers.utils.parseEther('10')) // Vault

    await increase(10)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const oracle = await ethers.getContractAt('Oracle', await ethMarket.oracle())
    const oracleGlobal = await oracle.global()
    const oracleProvider = await ethers.getContractAt(
      'IOracleProvider',
      (
        await oracle.oracles(oracleGlobal.current)
      ).provider,
    )
    const currentPosition = await ethMarket.positions(perennialUser.address)
    const currentTimestamp = await currentBlockTimestamp()
    await commitPriceForIds([oracleIDs[0].id], currentTimestamp)

    const nextVersionTimestamp = nextVersionForTimestamp(currentTimestamp)
    await expect(
      ethMarket
        .connect(perennialUser)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          perennialUser.address,
          currentPosition.maker.add(10),
          0,
          0,
          0,
          false,
        ),
    )
      .to.emit(oracleProvider, 'OracleProviderVersionRequested')
      .withArgs(nextVersionTimestamp)

    await increase(10)

    const hash = await commitPriceForIds([oracleIDs[0].id], nextVersionTimestamp + 4)
    const tx = await ethers.provider.getTransaction(hash)
    expect(tx).to.emit(oracleProvider, 'OracleProviderVersionFulfilled').withArgs(nextVersionTimestamp)

    await ethMarket.settle(perennialUser.address)
    const local = await ethMarket.locals(perennialUser.address)
    const checkpoint = await ethMarket.checkpoints(perennialUser.address, nextVersionTimestamp)

    expect(local.currentId).to.equal(local.latestId)
    expect(checkpoint.collateral).to.be.greaterThan(0)
  })

  it('liquidates', async () => {
    const [liquidator] = await ethers.getSigners()
    const perennialUser = await impersonateWithBalance(
      '0x2EE6C29A4f28C13C22aC0D0B077Dcb2D4e2826B8',
      ethers.utils.parseEther('10'),
    )

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const riskParameter = await ethMarket.riskParameter()

    await increase(10)

    const currentTimestamp = await currentBlockTimestamp()
    await commitPriceForIds([oracleIDs[0].id], currentTimestamp)
    await ethMarket
      .connect(ownerSigner)
      .updateRiskParameter({ ...riskParameter, minMargin: 50e6, minMaintenance: 50e6 }, false)

    await ethMarket
      .connect(liquidator)
      ['update(address,uint256,uint256,uint256,int256,bool)'](perennialUser.address, 0, 0, 0, 0, true)

    await commitPriceForIds([oracleIDs[0].id], nextVersionForTimestamp(currentTimestamp) + 4)

    await ethMarket.connect(liquidator).settle(perennialUser.address)
    await ethMarket.connect(liquidator).settle(liquidator.address)

    expect((await ethMarket.locals(liquidator.address)).claimable).to.equal(5e6)
  })

  it('settles vaults', async () => {
    const perennialUser = await impersonateWithBalance(
      '0xeb04ee956b3aa60977542e084e38c60be7fd69a5',
      ethers.utils.parseEther('10'),
    )

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

    await expect(asterVault.connect(perennialUser).update(perennialUser.address, 0, 10e6, 0))
      .to.emit(ethMarket, 'Updated')
      .to.emit(btcMarket, 'Updated')
      .to.emit(linkMarket, 'Updated')

    await expect(begoniaVault.connect(perennialUser).update(perennialUser.address, 0, 10e6, 0))
      .to.emit(solMarket, 'Updated')
      .to.emit(maticMarket, 'Updated')
      .to.emit(btcMarket, 'Updated')

    await increase(10)

    await commitPriceForIds(
      [oracleIDs[0].id, oracleIDs[1].id, oracleIDs[2].id, oracleIDs[3].id, oracleIDs[6].id],
      nextVersionForTimestamp(currentTimestamp) + 4,
    )
  })
})

async function commitPriceForIds(priceIds: string[], timestamp: number, factoryAddress?: string) {
  return await run('commit-price', { priceids: priceIds.join(','), timestamp, factoryaddress: factoryAddress })
}

function nextVersionForTimestamp(timestamp: number) {
  return Math.ceil((timestamp + 0.1) / 10) * 10
}
