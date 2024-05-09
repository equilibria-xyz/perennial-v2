import HRE, { run } from 'hardhat'
import { expect } from 'chai'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'
import { increase, increaseTo, reset } from '../../../../../common/testutil/time'
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
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'
import { GlobalStruct } from '../../../../types/generated/@equilibria/perennial-v2/contracts/Market'

const RunMigrationDeployScript = true

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
  let markets: IMarket[]

  const beforeGlobals: GlobalStruct[] = []

  const { deployments, ethers } = HRE
  const { fixture, get, getNetworkName } = deployments

  beforeEach(async () => {
    await reset()

    DSU = await ethers.getContractAt('IERC20', (await get('DSU')).address)
    USDC = await ethers.getContractAt('IERC20', (await get('USDC')).address)

    if (RunMigrationDeployScript) {
      // Deploy migration
      console.log('---- Deploying Impls ----')
      await fixture('v2_2_Migration', { keepExistingDeployments: true })
      console.log('---- Done ----\n')
    }

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

    const marketsAddrs = (await marketFactory.queryFilter(marketFactory.filters['InstanceRegistered(address)']())).map(
      e => e.args.instance,
    )
    markets = await Promise.all(marketsAddrs.map(a => ethers.getContractAt('IMarket', a)))

    const v2_1_1Artifact = await deployments.getArtifact('MarketV2_1_1')
    const marketsOld = await Promise.all(marketsAddrs.map(a => ethers.getContractAt(v2_1_1Artifact.abi, a)))

    const oracles = await pythFactory.queryFilter(pythFactory.filters.OracleCreated())
    oracleIDs = oracles.map(o => ({ id: o.args.id, oracle: o.args.oracle }))

    // Perform v2.2 Migration
    // Enter settle only for all markets
    // Update to settle only using hardhat task
    console.log('---- Changing Markets Mode to Settle ----')
    await run('change-markets-mode', { settle: true, prevabi: true })
    console.log('---- Done ----\n')

    // Settle all users using hardhat task
    console.log('---- Settling Market Users ----')
    await run('settle-markets', { batchsize: 30 })
    console.log('---- Done ----\n')

    // Settle all users in vaults using hardhat task
    console.log('---- Settling Vault Users ----')
    await run('settle-vaults', { batchsize: 30 })
    console.log('---- Done ----\n')

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

      // await expect(market.settle(ethers.constants.AddressZero)).to.not.be.reverted

      const global = await market.global()
      expect(global.latestPrice).to.be.equal(beforeGlobals[i].latestPrice)
      expect(global.latestId).to.be.equal(beforeGlobals[i].latestId)
      expect(global.currentId).to.be.equal(beforeGlobals[i].currentId)
    }
  })

  /* it('Runs full request/fulfill flow', async () => {
    const perennialUser = await impersonateWithBalance(
      '0xF8b6010FD6ba8F3E52c943A1473B1b1459a73094',
      ethers.utils.parseEther('10'),
    ) // Vault

    await increaseTo(1705340300)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const oracle = await ethers.getContractAt('Oracle', await ethMarket.oracle())
    const oracleProvider = await ethers.getContractAt('IOracleProvider', (await oracle.oracles(2)).provider)
    const currentPosition = await ethMarket.positions(perennialUser.address)
    await pythFactory.commit([oracleIDs[0].id], 1705340296, ETH_VAA_UPDATE, { value: 1 })

    await expect(
      ethMarket.connect(perennialUser).update(perennialUser.address, currentPosition.maker.add(10), 0, 0, 0, false),
    )
      .to.emit(oracleProvider, 'OracleProviderVersionRequested')
      .withArgs(1705340310)

    await increase(10)

    await expect(pythFactory.commit([oracleIDs[0].id], 1705340310, ETH_VAA_FULFILL, { value: 1 })).to.emit(
      oracleProvider,
      'OracleProviderVersionFulfilled',
    )
  })

  it('liquidates', async () => {
    const [, liquidator] = await ethers.getSigners()
    const perennialUser = await impersonateWithBalance(
      '0x2EE6C29A4f28C13C22aC0D0B077Dcb2D4e2826B8',
      ethers.utils.parseEther('10'),
    )

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const riskParameter = await ethMarket.riskParameter()

    await increaseTo(1705340300)

    await pythFactory.commit([oracleIDs[0].id], 1705340296, ETH_VAA_UPDATE, { value: 1 })
    await ethMarket
      .connect(timelockSigner)
      .updateRiskParameter({ ...riskParameter, minMargin: 50e6, minMaintenance: 50e6 })

    await ethMarket.connect(liquidator).update(perennialUser.address, 0, 0, 0, 0, true)

    await pythFactory.commit([oracleIDs[0].id], 1705340310, ETH_VAA_FULFILL, { value: 1 })

    await ethMarket.connect(liquidator).update(liquidator.address, 0, 0, 0, 0, false)
    await ethMarket.connect(liquidator).update(perennialUser.address, 0, 0, 0, 0, false)

    expect((await ethMarket.locals(liquidator.address)).collateral).to.equal(5e6)
  })

  it('settles vaults', async () => {
    const perennialUser = await impersonateWithBalance(
      '0x3dd81863779991d88d7f186d41b8bea1a569553d',
      ethers.utils.parseEther('10'),
    )

    await increaseTo(1705340300)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const btcMarket = await ethers.getContractAt('IMarket', '0xcC83e3cDA48547e3c250a88C8D5E97089Fd28F60')
    const linkMarket = await ethers.getContractAt('IMarket', '0xD9c296A7Bee1c201B9f3531c7AC9c9310ef3b738')

    await pythFactory.commit([oracleIDs[0].id], 1705340296, ETH_VAA_UPDATE, { value: 1 })
    await pythFactory.commit([oracleIDs[1].id], 1705340296, BTC_VAA_UPDATE, { value: 1 })
    await pythFactory.commit([oracleIDs[6].id], 1705340296, LINK_VAA_UPDATE, { value: 1 })

    const asterVault = await ethers.getContractAt('IVault', (await get('AsterVault')).address)

    await expect(asterVault.connect(perennialUser).update(perennialUser.address, 0, 10e6, 0))
      .to.emit(ethMarket, 'Updated')
      .to.emit(btcMarket, 'Updated')
      .to.emit(linkMarket, 'Updated')

    await expect(pythFactory.commit([oracleIDs[0].id], 1705340310, ETH_VAA_FULFILL, { value: 1 })).to.not.be.reverted
    await expect(pythFactory.commit([oracleIDs[1].id], 1705340310, BTC_VAA_FULFILL, { value: 1 })).to.not.be.reverted
    await expect(pythFactory.commit([oracleIDs[6].id], 1705340310, LINK_VAA_FULFILL, { value: 1 })).to.not.be.reverted
  }) */
})

const VAA_PUBLISH_TIME = 1714761637

const ETH_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00a0e3bb6d36d802513f65a84ff4468a23de6aa47461cc6ad4d6fedd1e46643a3c6c5176b875715d116a626709706a019702a0a0beb0804afa6d7c0d17d8613e030102bb63c633f40f7bc43a791ad17ed6768000505ce5bbc3544175294286faa00c265d62f275c4a1b8f28493debff047a68ce7041261647f59495337a613d5170fbf00030c7d94246da0eeb429f78baaad78740abef35f25586c96566cbefe379e1a3ed0215c615a570a38a0239c3950b4f9e9ec6d6426cc624427e38d8230a0c48c3f6f010436dcc1ce3f5e5b8287503f03b8c76db8249f20a506bc392abe790bbd93c032f050c31c81a89908d3f7f603163ec36c5a8a206808b6d6ca0d53ef8a6d03154d710106e2e9251aebe314a9b2ab9a791400b08d1b327434feb79145aefa5686cfc2a98d56108ea75feced8d89d8dd0abe58cc00bd5bcd454ab8bc258d708a4e29c2db7c0107cf3ee12ee856d34977d77f961cccaeefd9d695adc89d4a1b35315555e0308ce61aa0a58f0aba5b43eff63755e2c89454f59b28a8b8eae577bbca5b2916ac8fd2000a1ad37aa695b880e89efca82167e766834fed167c53e8f87407fca95614acf40933499b29d2ec262f1694dc2c9a723c15b1c77b72ea6c71d894d40a9014b6827d000b04f3628ec6caaa75b96e19f96eb8faf86e73d5c2e7decc5d76d195c9315155383f767e6b1da432a969bf81902a4d4bcb85fd5747432231ea0443773ed5c68b1d010c6a3623b58d3027ece866b29ef0ba45445dcf157e779157878aafa32171a2df170dee985c3a7b6b4e6b4d3c48df516d89f0fb00e3bf1506e49495d59bcaf0aaad000d30f9146e2de18f5a332dd2de2602a3febf73dced3bafb4f8fbf4a555b72de5411d4dca2173dbbd642f60d76606e93549527b0ca1cf521c9073c18c4156ac41b0000eb9766c19479e3a33930abff0c18c696290e12b9acfb7b4dafbb4afade8eb417d0e42fa46ac9c0c2a69d1fcccaa903621492d03c136ebb588bcecb7eadd2c7437000fb87c2220f4782159d7c123fae62bca0e38b66ea1e5aff241bb6f4d8253c15108561788fc7304422e2dfcfc8fd4e360e787af1c4b4ec15ceac8d26531b9bffbc40112342a214ac7e6845b8ec9d02e279492d9510c549139e2fd1807a95bac853961a5255986a867be5555997e20996a3f13365b74f40f4d3084f1d55fd247598bb3bd0066352fa600000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033db254014155575600000000000847b07800002710cce845d0f6ba38c50163d5481b76657d4bdbd51a01005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace000000477becd82c000000000fc7fbfafffffff80000000066352fa50000000066352fa4000000479d1f1d20000000000b3d4b9a0a5b18d080a9f8018528ff74d0f2b9313250b9411e4a3f88d0836ea6dc45a89216a1775d8192a95ef475489dd048872051bda19d20395a1ed0a773691a8854365f39253c0084cc70b59743ed985354aabee21e969f088bfea4e84ae49b380bc248775515cc8fef3434b9fb28087077236ceb689694269428abb83575516ec89ab7c2b711c762f216652bd06a8676a806f0f303449f21e3294868d6b9d9c4a6e4adb905a57961f470ee7c923846566da1b8af5417d368111241cd984b16f2b5c1699c3e65c4739ef151'

const BTC_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00a0e3bb6d36d802513f65a84ff4468a23de6aa47461cc6ad4d6fedd1e46643a3c6c5176b875715d116a626709706a019702a0a0beb0804afa6d7c0d17d8613e030102bb63c633f40f7bc43a791ad17ed6768000505ce5bbc3544175294286faa00c265d62f275c4a1b8f28493debff047a68ce7041261647f59495337a613d5170fbf00030c7d94246da0eeb429f78baaad78740abef35f25586c96566cbefe379e1a3ed0215c615a570a38a0239c3950b4f9e9ec6d6426cc624427e38d8230a0c48c3f6f010436dcc1ce3f5e5b8287503f03b8c76db8249f20a506bc392abe790bbd93c032f050c31c81a89908d3f7f603163ec36c5a8a206808b6d6ca0d53ef8a6d03154d710106e2e9251aebe314a9b2ab9a791400b08d1b327434feb79145aefa5686cfc2a98d56108ea75feced8d89d8dd0abe58cc00bd5bcd454ab8bc258d708a4e29c2db7c0107cf3ee12ee856d34977d77f961cccaeefd9d695adc89d4a1b35315555e0308ce61aa0a58f0aba5b43eff63755e2c89454f59b28a8b8eae577bbca5b2916ac8fd2000a1ad37aa695b880e89efca82167e766834fed167c53e8f87407fca95614acf40933499b29d2ec262f1694dc2c9a723c15b1c77b72ea6c71d894d40a9014b6827d000b04f3628ec6caaa75b96e19f96eb8faf86e73d5c2e7decc5d76d195c9315155383f767e6b1da432a969bf81902a4d4bcb85fd5747432231ea0443773ed5c68b1d010c6a3623b58d3027ece866b29ef0ba45445dcf157e779157878aafa32171a2df170dee985c3a7b6b4e6b4d3c48df516d89f0fb00e3bf1506e49495d59bcaf0aaad000d30f9146e2de18f5a332dd2de2602a3febf73dced3bafb4f8fbf4a555b72de5411d4dca2173dbbd642f60d76606e93549527b0ca1cf521c9073c18c4156ac41b0000eb9766c19479e3a33930abff0c18c696290e12b9acfb7b4dafbb4afade8eb417d0e42fa46ac9c0c2a69d1fcccaa903621492d03c136ebb588bcecb7eadd2c7437000fb87c2220f4782159d7c123fae62bca0e38b66ea1e5aff241bb6f4d8253c15108561788fc7304422e2dfcfc8fd4e360e787af1c4b4ec15ceac8d26531b9bffbc40112342a214ac7e6845b8ec9d02e279492d9510c549139e2fd1807a95bac853961a5255986a867be5555997e20996a3f13365b74f40f4d3084f1d55fd247598bb3bd0066352fa600000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033db254014155575600000000000847b07800002710cce845d0f6ba38c50163d5481b76657d4bdbd51a01005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b430000059ed36dd1db00000000a633a043fffffff80000000066352fa50000000066352fa40000059f0334542000000000b57fe7c40ae1158b5d06aa084b492972ba2081d6bf2445cc6ee54ca10d1da6f53c01d972ca3fbbec096a079057220fb9bbef18505438638fa16e8623533a6701e2ddbe2baac53f9b5c88cf6af64ab2ca1352f91adb72b44880e22df86481ab3744e8eef622d00e1eb0f648edce4f9683944cb1cc51c87eaea8c8ffe6a1b83575516ec89ab7c2b711c762f216652bd06a8676a806f0f303449f21e3294868d6b9d9c4a6e4adb905a57961f470ee7c923846566da1b8af5417d368111241cd984b16f2b5c1699c3e65c4739ef151'

const LINK_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00a0e3bb6d36d802513f65a84ff4468a23de6aa47461cc6ad4d6fedd1e46643a3c6c5176b875715d116a626709706a019702a0a0beb0804afa6d7c0d17d8613e030102bb63c633f40f7bc43a791ad17ed6768000505ce5bbc3544175294286faa00c265d62f275c4a1b8f28493debff047a68ce7041261647f59495337a613d5170fbf00030c7d94246da0eeb429f78baaad78740abef35f25586c96566cbefe379e1a3ed0215c615a570a38a0239c3950b4f9e9ec6d6426cc624427e38d8230a0c48c3f6f010436dcc1ce3f5e5b8287503f03b8c76db8249f20a506bc392abe790bbd93c032f050c31c81a89908d3f7f603163ec36c5a8a206808b6d6ca0d53ef8a6d03154d710106e2e9251aebe314a9b2ab9a791400b08d1b327434feb79145aefa5686cfc2a98d56108ea75feced8d89d8dd0abe58cc00bd5bcd454ab8bc258d708a4e29c2db7c0107cf3ee12ee856d34977d77f961cccaeefd9d695adc89d4a1b35315555e0308ce61aa0a58f0aba5b43eff63755e2c89454f59b28a8b8eae577bbca5b2916ac8fd2000a1ad37aa695b880e89efca82167e766834fed167c53e8f87407fca95614acf40933499b29d2ec262f1694dc2c9a723c15b1c77b72ea6c71d894d40a9014b6827d000b04f3628ec6caaa75b96e19f96eb8faf86e73d5c2e7decc5d76d195c9315155383f767e6b1da432a969bf81902a4d4bcb85fd5747432231ea0443773ed5c68b1d010c6a3623b58d3027ece866b29ef0ba45445dcf157e779157878aafa32171a2df170dee985c3a7b6b4e6b4d3c48df516d89f0fb00e3bf1506e49495d59bcaf0aaad000d30f9146e2de18f5a332dd2de2602a3febf73dced3bafb4f8fbf4a555b72de5411d4dca2173dbbd642f60d76606e93549527b0ca1cf521c9073c18c4156ac41b0000eb9766c19479e3a33930abff0c18c696290e12b9acfb7b4dafbb4afade8eb417d0e42fa46ac9c0c2a69d1fcccaa903621492d03c136ebb588bcecb7eadd2c7437000fb87c2220f4782159d7c123fae62bca0e38b66ea1e5aff241bb6f4d8253c15108561788fc7304422e2dfcfc8fd4e360e787af1c4b4ec15ceac8d26531b9bffbc40112342a214ac7e6845b8ec9d02e279492d9510c549139e2fd1807a95bac853961a5255986a867be5555997e20996a3f13365b74f40f4d3084f1d55fd247598bb3bd0066352fa600000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033db254014155575600000000000847b07800002710cce845d0f6ba38c50163d5481b76657d4bdbd51a010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d2210000000052f7314300000000000e7a79fffffff80000000066352fa50000000066352fa4000000005309f0e400000000000da4d10a5291f9286eb2596d123d01b656d5533ed20775a95eb1e0378027ad0da7d82ce8ab9df8a9fa89244a2c9dbc4d9b4ce2b6ee82066b29e2f7b46f348bf8b4ccfdbf31bf26320f8b6bf01a422634a9ffa3535199e6790fff160c72e27b5ae28b11fd6e53f47056c044c7ce7c8c6ac55e32634623bb6b239005ff03641b2894c0dafa025a2251ead589659412423f4f3df4b89c3688bfe14b0bd0c486ab3484fc3b3bb905a57961f470ee7c923846566da1b8af5417d368111241cd984b16f2b5c1699c3e65c4739ef151'

// Publish Time: 1714761644
const ETH_VAA_FULFILL =
  '0x504e41550100000003b801000000040d00d4ed878bb7d0f516b9e4cc2bea0dfbd38f7ba5ae2d364df28e27f83959d148a445158fe49cf50da4110719981b0facbb5a5ccf9147c295c4aae9c8f94a12291f00027fa69fc81938d3b3e77e06d006ed615ed755942046cfb2a70a8387f151d83a0c36d40e70b018e35dacb276a4795dde2021e0caa1eb3d50324fdabfe5670665aa0103a9760a5b9a6e7e8119ad06b481850330e286dfa2108f29fe89296492769dc542328523061fb445227cb553c1d66aaf27c15afe91670fe062a77b053c88f930b3010449ccd04c9d6e8cc61f6490fee88c6b4d83b2dbf09fba9e4e564f13ee593888232c4566f0e82967027c9d529319cb489d0378a527513e34c177308be5c0e2a07401066574fe50808981df55c2534a87fb7424195462be4f133c54c638d6c540b131f70e1e78ab8fee722e420a8846da81380831fccbf6bbdf530ba30ee3e6c1e7e6260107a5feb8c7e6c0ef6fc8841d2201221d49faa3a9fd3478aa9e3f9dfdb534ef764b54e54971e15c9e855b4df8f336e395c26cf97026255b2c69c0d304c9e079b187000ab92f8dc24092c4678eec86f4c59b4d9ae0bc977ff3f842da42a8cb533db0d03310ab52538599e5847652940bd7bf711994048565182cda87d3f24b2e257e94bc010be021dd799afe255c283590e2a8b1d082e28ddd7fcf09b208bfb43b091ede5a176a71138844688092dd3143a9149e201a3de5d03a64c47adf05fedbe1cdd269c0010c9611316c7b2c7771ffe013ab3c8352acb29b0d79cf6198267623da284dabe1320139b2f2760de3800833a198d49b10920cba39cbcdad11d94775fc4503bc67ca000df288dacb0ecec4be9c507639d3a1aef5076f030302e862c117fbd5be296dfb7b76d91346cd6d2b4beb79f435cce36166a09b67ee5294f0248f71fd3cf4656972010e95d5a4bab23386a5ee8b2552ec23fc3e6a3c5e3c9afc4f1ad6948deca23c91e73eaf51a1c25b108bf34cc46d2c484a287ed79e8d9bef9ba29b478635c592f749000f97962cf31df90f49bf94a5f38c2abf8b795656093ec44e8f1d766c371660b4810267c933ec1a7d445fdb1e2121e847e92ecbb7f3e0f496c92d40542f64f07d3201120ca56646eb46e3edc09c881691cbd7f5ff042d65d23ee6d579de312df1061a851539cfc954729739cfc1f4212732fd60f3956c6a3023fc5f4aba80431df999310166352fac00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033db265014155575600000000000847b0890000271025820e492940a6237483c5e276f4ea79b7f884fd01005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace000000477d20220a000000000bca2b56fffffff80000000066352fac0000000066352fab000000479d107720000000000b3d982d0ac63cf0156c47454facd84324c947850aba386bbf97e61609208fcbe59afac28a86af7d1f168026f3cab9dde638105dc0995b4dd4aef471bc8c4fbf0b07a9b03325df70a68d7a5ae367c27f3fc810c7382a600a44e653085afac2da80c72fdcc0edcdc38a33159e0024f819055a665d93ca510aaf9577b191f4e238b82eadff1e40ada33876d97679685df2b1c52272ae2dbbe9293c76645ec47ced637c452925e22cf507fecc55300401cae8f30d3f51a016c0ed5fc1ef19b0d8a837dbca14bb215e6433d5bf23a9'

const BTC_VAA_FULFILL =
  '0x504e41550100000003b801000000040d00d4ed878bb7d0f516b9e4cc2bea0dfbd38f7ba5ae2d364df28e27f83959d148a445158fe49cf50da4110719981b0facbb5a5ccf9147c295c4aae9c8f94a12291f00027fa69fc81938d3b3e77e06d006ed615ed755942046cfb2a70a8387f151d83a0c36d40e70b018e35dacb276a4795dde2021e0caa1eb3d50324fdabfe5670665aa0103a9760a5b9a6e7e8119ad06b481850330e286dfa2108f29fe89296492769dc542328523061fb445227cb553c1d66aaf27c15afe91670fe062a77b053c88f930b3010449ccd04c9d6e8cc61f6490fee88c6b4d83b2dbf09fba9e4e564f13ee593888232c4566f0e82967027c9d529319cb489d0378a527513e34c177308be5c0e2a07401066574fe50808981df55c2534a87fb7424195462be4f133c54c638d6c540b131f70e1e78ab8fee722e420a8846da81380831fccbf6bbdf530ba30ee3e6c1e7e6260107a5feb8c7e6c0ef6fc8841d2201221d49faa3a9fd3478aa9e3f9dfdb534ef764b54e54971e15c9e855b4df8f336e395c26cf97026255b2c69c0d304c9e079b187000ab92f8dc24092c4678eec86f4c59b4d9ae0bc977ff3f842da42a8cb533db0d03310ab52538599e5847652940bd7bf711994048565182cda87d3f24b2e257e94bc010be021dd799afe255c283590e2a8b1d082e28ddd7fcf09b208bfb43b091ede5a176a71138844688092dd3143a9149e201a3de5d03a64c47adf05fedbe1cdd269c0010c9611316c7b2c7771ffe013ab3c8352acb29b0d79cf6198267623da284dabe1320139b2f2760de3800833a198d49b10920cba39cbcdad11d94775fc4503bc67ca000df288dacb0ecec4be9c507639d3a1aef5076f030302e862c117fbd5be296dfb7b76d91346cd6d2b4beb79f435cce36166a09b67ee5294f0248f71fd3cf4656972010e95d5a4bab23386a5ee8b2552ec23fc3e6a3c5e3c9afc4f1ad6948deca23c91e73eaf51a1c25b108bf34cc46d2c484a287ed79e8d9bef9ba29b478635c592f749000f97962cf31df90f49bf94a5f38c2abf8b795656093ec44e8f1d766c371660b4810267c933ec1a7d445fdb1e2121e847e92ecbb7f3e0f496c92d40542f64f07d3201120ca56646eb46e3edc09c881691cbd7f5ff042d65d23ee6d579de312df1061a851539cfc954729739cfc1f4212732fd60f3956c6a3023fc5f4aba80431df999310166352fac00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033db265014155575600000000000847b0890000271025820e492940a6237483c5e276f4ea79b7f884fd01005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b430000059ee174982300000000a595888afffffff80000000066352fac0000000066352fab0000059f03420fc000000000b5766ec40ac938e0b19741e7aba286cf2ffd136ac8c799da23d10bf66b501a1258ac73bd48b59d05d75c3e4eac41c4dadf3e16e537b73158918a40dc43985e92e343fcc31c1413d97ca333a5fec9c0b568533c9159b3ea4238adbe498823a09bf7bd5a01b87d791b8abc95a008ff7d4508bc5416beb0e7d0f8d7a50cd2f4e238b82eadff1e40ada33876d97679685df2b1c52272ae2dbbe9293c76645ec47ced637c452925e22cf507fecc55300401cae8f30d3f51a016c0ed5fc1ef19b0d8a837dbca14bb215e6433d5bf23a9'

const LINK_VAA_FULFILL =
  '0x504e41550100000003b801000000040d00d4ed878bb7d0f516b9e4cc2bea0dfbd38f7ba5ae2d364df28e27f83959d148a445158fe49cf50da4110719981b0facbb5a5ccf9147c295c4aae9c8f94a12291f00027fa69fc81938d3b3e77e06d006ed615ed755942046cfb2a70a8387f151d83a0c36d40e70b018e35dacb276a4795dde2021e0caa1eb3d50324fdabfe5670665aa0103a9760a5b9a6e7e8119ad06b481850330e286dfa2108f29fe89296492769dc542328523061fb445227cb553c1d66aaf27c15afe91670fe062a77b053c88f930b3010449ccd04c9d6e8cc61f6490fee88c6b4d83b2dbf09fba9e4e564f13ee593888232c4566f0e82967027c9d529319cb489d0378a527513e34c177308be5c0e2a07401066574fe50808981df55c2534a87fb7424195462be4f133c54c638d6c540b131f70e1e78ab8fee722e420a8846da81380831fccbf6bbdf530ba30ee3e6c1e7e6260107a5feb8c7e6c0ef6fc8841d2201221d49faa3a9fd3478aa9e3f9dfdb534ef764b54e54971e15c9e855b4df8f336e395c26cf97026255b2c69c0d304c9e079b187000ab92f8dc24092c4678eec86f4c59b4d9ae0bc977ff3f842da42a8cb533db0d03310ab52538599e5847652940bd7bf711994048565182cda87d3f24b2e257e94bc010be021dd799afe255c283590e2a8b1d082e28ddd7fcf09b208bfb43b091ede5a176a71138844688092dd3143a9149e201a3de5d03a64c47adf05fedbe1cdd269c0010c9611316c7b2c7771ffe013ab3c8352acb29b0d79cf6198267623da284dabe1320139b2f2760de3800833a198d49b10920cba39cbcdad11d94775fc4503bc67ca000df288dacb0ecec4be9c507639d3a1aef5076f030302e862c117fbd5be296dfb7b76d91346cd6d2b4beb79f435cce36166a09b67ee5294f0248f71fd3cf4656972010e95d5a4bab23386a5ee8b2552ec23fc3e6a3c5e3c9afc4f1ad6948deca23c91e73eaf51a1c25b108bf34cc46d2c484a287ed79e8d9bef9ba29b478635c592f749000f97962cf31df90f49bf94a5f38c2abf8b795656093ec44e8f1d766c371660b4810267c933ec1a7d445fdb1e2121e847e92ecbb7f3e0f496c92d40542f64f07d3201120ca56646eb46e3edc09c881691cbd7f5ff042d65d23ee6d579de312df1061a851539cfc954729739cfc1f4212732fd60f3956c6a3023fc5f4aba80431df999310166352fac00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033db265014155575600000000000847b0890000271025820e492940a6237483c5e276f4ea79b7f884fd010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d2210000000052f81c8000000000000c64e8fffffff80000000066352fac0000000066352fab000000005309e82400000000000da50f0a28ebed909c87c47e88194c8bdfc9226a96bffd7c4a5c5e0864e6a98d1a05057cc7182508f1ef4223f7401484f6c147d411717d0a2a686d3b70d2e3841e6d533e5ec583ff49cbf104a118bc18e158105f79ec853d1cf65446c47d68b93991e10df2cd169d5b0733941f62491c059cdd3b6418d448e68627da21ccd6886c3381c283ff3c44ba3e872c738c89404e960d00e422e0ea414c88ee781127785fe5f69ee22cf507fecc55300401cae8f30d3f51a016c0ed5fc1ef19b0d8a837dbca14bb215e6433d5bf23a9'
