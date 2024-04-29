import HRE from 'hardhat'
import { expect } from 'chai'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'
import { currentBlockTimestamp, increase, increaseTo, reset } from '../../../../../common/testutil/time'
import { ArbGasInfo, IERC20, MarketFactory, OracleFactory, ProxyAdmin, PythFactory } from '../../../../types/generated'
import { BigNumber, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'

const RunMigrationDeployScript = true

describe('Verify Arbitrum v2.1.1 Migration', () => {
  let DSU: IERC20
  let USDC: IERC20
  let timelockSigner: SignerWithAddress
  let oracleFactory: OracleFactory
  let pythFactory: PythFactory
  let marketFactory: MarketFactory
  let proxyAdmin: ProxyAdmin

  let dsuBalanceDifference: BigNumber
  let usdcBalanceDifference: BigNumber

  let oracleIDs: { id: string; oracle: string }[]

  const { deployments, ethers } = HRE
  const { fixture, get } = deployments

  beforeEach(async () => {
    await reset()

    DSU = await ethers.getContractAt('IERC20', (await get('DSU')).address)
    USDC = await ethers.getContractAt('IERC20', (await get('USDC')).address)

    if (RunMigrationDeployScript) {
      // Deploy migration
      await fixture('v2_1_1_Migration', { keepExistingDeployments: true })
    }

    timelockSigner = await impersonateWithBalance(
      (
        await get('TimelockController')
      ).address,
      ethers.utils.parseEther('10'),
    )
    oracleFactory = (await ethers.getContractAt('OracleFactory', (await get('OracleFactory')).address)).connect(
      timelockSigner,
    )
    pythFactory = (await ethers.getContractAt('PythFactory', (await get('PythFactory')).address)).connect(
      timelockSigner,
    )
    marketFactory = (await ethers.getContractAt('MarketFactory', (await get('MarketFactory')).address)).connect(
      timelockSigner,
    )
    proxyAdmin = (await ethers.getContractAt('ProxyAdmin', (await get('ProxyAdmin')).address)).connect(timelockSigner)

    await oracleFactory.register(pythFactory.address)

    const dsuBalance = await DSU.balanceOf(oracleFactory.address)
    const usdcBalance = await USDC.balanceOf(oracleFactory.address)

    // FIXME: upgradeAndCall doesn't work, but update-then-call works fine
    const dsuAddress = (await get('DSU')).address
    const usdcAddress = (await get('USDC')).address
    const dsuReserve = (await get('DSUReserve')).address
    /*await proxyAdmin.upgradeAndCall(
      oracleFactory.address,
      (
        await get('OracleFactoryImpl')
      ).address,
      oracleFactory.interface.encodeFunctionData('initialize', [
        dsuAddress,
        usdcAddress,
        dsuReserve,
      ]),
    )*/
    proxyAdmin.upgrade(oracleFactory.address, (await get('OracleFactoryImpl')).address)
    oracleFactory.initialize(dsuAddress, usdcAddress, dsuReserve)

    dsuBalanceDifference = (await DSU.balanceOf(oracleFactory.address)).sub(dsuBalance)
    usdcBalanceDifference = (await USDC.balanceOf(oracleFactory.address)).sub(usdcBalance)

    await proxyAdmin.upgrade((await get('MarketFactory')).address, (await get('MarketFactoryImpl')).address)
    await proxyAdmin.upgrade((await get('VaultFactory')).address, (await get('VaultFactoryImpl')).address)
    await proxyAdmin.upgrade((await get('MultiInvoker')).address, (await get('MultiInvokerImpl_Arbitrum')).address)

    oracleIDs = (await oracleFactory.queryFilter(oracleFactory.filters.OracleCreated())).map(e => ({
      id: e.args.id,
      oracle: e.args.oracle,
    }))
    for (const oracle of oracleIDs) {
      await oracleFactory.update(oracle.id, pythFactory.address)
    }

    if ((await pythFactory.pendingOwner()) !== constants.AddressZero) {
      await pythFactory.acceptOwner()
    }

    const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    // Hardhat fork network does not support Arbitrum built-ins, so we need to fake this call for testing
    gasInfo.getL1BaseFeeEstimate.returns(0)
  })

  it('Migrates', async () => {
    expect(await pythFactory.callStatic.owner()).to.be.eq(timelockSigner.address)
    expect(await oracleFactory.callStatic.factories(pythFactory.address)).to.be.true
    expect(await USDC.balanceOf(oracleFactory.address)).to.be.eq(0)
    expect(dsuBalanceDifference).to.equal(usdcBalanceDifference.mul(-1).mul(1e12))

    for (const oracle of oracleIDs) {
      const contract = await ethers.getContractAt('Oracle', await oracleFactory.oracles(oracle.id))
      const global = await contract.global()
      expect((await contract.oracles(global.current)).provider).to.equal(await pythFactory.oracles(oracle.id))
    }

    const markets = (await marketFactory.queryFilter(marketFactory.filters['InstanceRegistered(address)']())).map(
      e => e.args.instance,
    )
    for (const market of markets) {
      const contract = await ethers.getContractAt('IMarket', market)
      expect(await contract.update(ethers.constants.AddressZero, 0, 0, 0, 0, false)).to.not.be.reverted
    }
  })

  it('Runs full request/fulfill flow', async () => {
    const perennialUser = await impersonateWithBalance(
      '0xF8b6010FD6ba8F3E52c943A1473B1b1459a73094',
      ethers.utils.parseEther('10'),
    ) // Vault

    // in 2.1 tests, this was 4 seconds ahead of publish time
    await increaseTo(VAA_PUBLISH_TIME + 4)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const oracle = await ethers.getContractAt('Oracle', await ethMarket.oracle())
    const oracleProvider = await ethers.getContractAt('IOracleProvider', (await oracle.oracles(2)).provider)
    const currentPosition = await ethMarket.positions(perennialUser.address)
    console.log('oracleId', [oracleIDs[0].id])
    // FIXME:
    // For new migration, needed to adjust fork to a block following the last deployment (179203656).
    // At this height, original VAAs from block 179203656 and timestamp 1705340296 revert with 0xb8499c31 (KeeperOracleVersionOutsideRangeError)
    // I cannot query VAAs from that vintage (timestamp 1707554324), as Hermes 404's on anything over a week old.
    // Recent VAAs (within past day) revert with custom error 0x2acbe915 (InvalidWormholeVaa)
    // If I change forked block to something more recent (like from an hour ago to current block height), recent VAAs revert with 0x45805f5d (PriceFeedNotFoundWithinRange)
    await pythFactory.commit([oracleIDs[0].id], VAA_PUBLISH_TIME, ETH_VAA_UPDATE, { value: 1 })
    // Uncomment below to generate calldata for debugging with Tenderly.
    // console.log('sending from', perennialUser.address, 'to', pythFactory.address, 'at block height', await ethers.provider.getBlockNumber())
    // console.log(pythFactory.interface.encodeFunctionData('commit', [[oracleIDs[0].id], VAA_PUBLISH_TIME, ETH_VAA_UPDATE]))
    // expect(true).to.be.false
    return

    await expect(
      ethMarket.connect(perennialUser).update(perennialUser.address, currentPosition.maker.add(10), 0, 0, 0, false),
    )
      .to.emit(oracleProvider, 'OracleProviderVersionRequested')
      .withArgs(VAA_PUBLISH_TIME + 20)
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

    // FIXME: also reverts with 0xb8499c31
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
  })
})

const VAA_PUBLISH_TIME = 1714412682

const ETH_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00cdf12709fa559c13252b45382230fd25eeb4ea9b576676a238108f8ef54de9c77dc6b6be14d28e06aaccf5edd8b32f27208c109a828e0e025a3da25e6afe453b010290577d37befba1a7ea8ddf2b48eb07b6f9ad0a22b4f10fc7939364c5c42d01ea7f50afd9c67e659c9ae0eec3c1dea00f7144a9e5444ae52fc0b3c0e08d4b423d0103f75d496adfbb661abfd1ffdd6523ebaa53e867c543e1086c1252243d2efa91ea66bfe52c36dc47dd7a9f1994563b4793c1d972e600122b8b6b4b2b2d488b232f0106d6d56e812c2072b5f56c024812c469d810d0394fbf932b8fdacad0e8f8ea828677aadc957c4918babf04986aba9193b4dafd704b856b9524341e06adcdf2d4bb000790883a17d6c48c9e7e4f196fb2da8ecd1f8d7d123b4ed397757b826f39d84f9a04abc1d0583b70e4a50f5ca7068f7b50c44f765b63fb7e2f63594e5704694b43000a1ba32b3afaf19f59edfec09db8d3b9b9efb0f99c5d70091b119e87c213157bc84def7ca87b26d57908df509414e777e8ad36c91a319a233c3b6b222403389412010be70fc43175e9aaf174ab0b814f07a832e1272f026c0ebd8f5cb401629906c95808082d1b550a4799cf45a9d66f48b9f6794b37ffa10d378b18b1036d62978f9a010cabfeb55edb54475634743351e47a6a967fdaf929b11f898082060c498bdd66275f8813576f61108d98c93c59e2b890be05f72d0eb2c87aaf5bb5197bf7cc5f1d010d9904176fce285fc3d62ad300386b005d68f3f1fb0a875b54640e00c049f8aabb0144b395764af9aa2c73fd93b71380da0a3a498fb5f2f6c9f59277a1ed9e38ec000e0bfc24ea89c8caa3ae1dbb63b3ed0544fcd2a90f955b24a4102661d3c6b1557a4c828809d2e47b19126bd5239eacf3dc1e582e063b0c421b566af626614115aa010ff86cd3b7b29918b1173248470966517745d19e80d33caaba58b5ed367a2bc8171957fc4bfe4f899164054567c6afac1fc5140ce78178430f6347f2b06f20d8bd0110adaef0525bd3bda65d345c65a2d10cc0c6832cadd56b2f69144b63e605d17b3b3badaf486253dccd93603a1199e0ee05a24c60adf169c26b348f24d57a61de3d001274887a59671b99f6738e1ef865bdea630cae9b846da90e24b7eaa3e93330f91a4f7f45c89e5306834d268bb9f127e569759754c959ba71dc75b3df721503611601662fdc8a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033188d401415557560000000000083b812d00002710ad12da0358f7f9ee36648913d39efd771e5dbb6b01005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace00000049fe575a8f00000000156ac8ebfffffff800000000662fdc8a00000000662fdc8900000049cf84a7b0000000000f4c4cad0a6e94e14c012356f5d72bcb1ffbeb90b4f635bf856d68668f8de22d888130071164f236243b01a36f7c224495090c8063871c9f79335cc10825a56b27aaaf9244cb18d150b52935dc4b714c78c40e31328129f08e7481878816f34fa26697e2908710a160707df4e5dca9d020ce4006ec1b39a8d3ec1b82792f1993ae3908a2dbde3b0970816a8da8cf4d584ddb3afa483c9ea31709a30a72cb2ef44fdd1a87e191a8e02ced7de72b654a67d4edf00af0586f5a24aa9403ca6417987cef4c4cbb140b54b50c4f15e6'

// TODO: update these again once ETH VAA is working
const BTC_VAA_UPDATE =
  '0x504e41550100000003b801000000040d0097b1e8e3ffa8522848291241faec7190b46d591582bf640b36e13eef41a4dbab30c1b43f1b0a00e00b8672b09c57f868a5938b8613056d87080c434ed4490f4e0001e7f390bd93692de26aebf4f16f9356fe8df87a1b00cc89a410841fb5652501b32b18dd14a8eac9a641f2869491e2156ae3edfc6eee9184e3e3cb1c3babc9fe2d01021773a4a2720889ca2736415efa498f3eeb2d9294bb45030915f70dbb426aa5634ac07f4e23ed2f01c38c54a5d26771bc1c19707839c8fc488fa3c23289c250a000036c9c8b3c9da3363b25761f21d01a1d9ac8d3fc2bc1d27e55bd26b519c22e6b2d5fae9a85d667ae2ac1c4906eda4dc1a7dd9b6d64c2e1db7f91e552d4b362a81b01062fee202788c731fd846a49b3a47dd0ae4cb1f477f42b197a3055f4b7ac70810465eec0de1155061c0fc54fd3a444e2f043cd4487f36f6dc99a099f259e1d173801070acb3eebfe1a8db139e8192b20216597fd34bf3417eb40a1f72e7c88c8e772a070d0ca9a1e212461fbe45bbec65eb6a570ccaab02cb5503232702560e017bcbe0109bb90a106b10c56a6f4d0b90440cb9d32caea0675ba27bf0881d013094271410f5a3b270c96db996500221b1a2d811971e32f398ff637721622eef601f0f68e55000ac256b3e39e83dacf5c52ab5dcda8ef28c4214b907d00adeee7b28f01ed9ee4c0619a88ad9985e30d2be52561b20e866e785f3448cea94048f4523f2525a3e011010b4e6460b13a6e0a280f2d49279c2366c8b3ef8ad955df673f7f03f381e1aa254d3f3ef227da19f823a8dfbdcecfea83f5ace6c7bba5603cae6c77910b9ef93aa9010c958672e5c14ecc67f5d14a47ead06f4fd1cfb0a46e589c92e5deeaa5dc2e73a16c9271ecd1fdcaada4470d1252494b2add1c36543a97031cb30f6ebae58cdee6000dc6abb14357313da333c8bbfd64e8a11a555676045335d19ef0bda12fd0c60c752d688405338ec6a3c14029d539572be79be200cc78e134793f966d188262512c000eab20b26a438bbff6089280738b7295febfe3b7af6c9c3fb636514e7e82ac7ff154f89d38279f1d69d0b9884500184a127906abf34fb3f85e7cad1c8f542ae876001219304ec3b9b7b8e56ddc5dc7371e7fa39d135bc3b3cfc5e6cab4b1b053d4a23d772ace464815a2e83de3e5adbeb0065be761325f1411c56862961d7a3959c24701662bcf8000000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71000000000327f1a1014155575600000000000831e98100002710aa144906b3ed6333992a2571b86f4c972d2066a501005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43000005c6368ed34600000000b9d9017afffffff800000000662bcf8000000000662bcf7f000005ce2965336000000000d85306780a87f08025e2c38ab8726779948178915e9213c3f9e688a05b2186594d2c3b084d23dbe3b8072f8d00df08177472206923d8b7a052b1590467932ca21d18cdafeea45eab36e7229d75ebbab71a3a2955bdc3bc1752ae09d7c2c3ed6a9b5e15261dad44f32218b4dd09b6e438c15f4daf10c0fe0c4cb5dd4c9d06382aeefcd11aa21f07daf94ca6e1d201172dccbf224a2c2f439640cd2522fcb2fefb92568ca8e7c631fde91367770e1efe7ba36d15fddc6c3949aad97755cfbcabd6459948b2c08a519cb76599b2e6'

const LINK_VAA_UPDATE =
  '0x504e41550100000003b801000000040d0097b1e8e3ffa8522848291241faec7190b46d591582bf640b36e13eef41a4dbab30c1b43f1b0a00e00b8672b09c57f868a5938b8613056d87080c434ed4490f4e0001e7f390bd93692de26aebf4f16f9356fe8df87a1b00cc89a410841fb5652501b32b18dd14a8eac9a641f2869491e2156ae3edfc6eee9184e3e3cb1c3babc9fe2d01021773a4a2720889ca2736415efa498f3eeb2d9294bb45030915f70dbb426aa5634ac07f4e23ed2f01c38c54a5d26771bc1c19707839c8fc488fa3c23289c250a000036c9c8b3c9da3363b25761f21d01a1d9ac8d3fc2bc1d27e55bd26b519c22e6b2d5fae9a85d667ae2ac1c4906eda4dc1a7dd9b6d64c2e1db7f91e552d4b362a81b01062fee202788c731fd846a49b3a47dd0ae4cb1f477f42b197a3055f4b7ac70810465eec0de1155061c0fc54fd3a444e2f043cd4487f36f6dc99a099f259e1d173801070acb3eebfe1a8db139e8192b20216597fd34bf3417eb40a1f72e7c88c8e772a070d0ca9a1e212461fbe45bbec65eb6a570ccaab02cb5503232702560e017bcbe0109bb90a106b10c56a6f4d0b90440cb9d32caea0675ba27bf0881d013094271410f5a3b270c96db996500221b1a2d811971e32f398ff637721622eef601f0f68e55000ac256b3e39e83dacf5c52ab5dcda8ef28c4214b907d00adeee7b28f01ed9ee4c0619a88ad9985e30d2be52561b20e866e785f3448cea94048f4523f2525a3e011010b4e6460b13a6e0a280f2d49279c2366c8b3ef8ad955df673f7f03f381e1aa254d3f3ef227da19f823a8dfbdcecfea83f5ace6c7bba5603cae6c77910b9ef93aa9010c958672e5c14ecc67f5d14a47ead06f4fd1cfb0a46e589c92e5deeaa5dc2e73a16c9271ecd1fdcaada4470d1252494b2add1c36543a97031cb30f6ebae58cdee6000dc6abb14357313da333c8bbfd64e8a11a555676045335d19ef0bda12fd0c60c752d688405338ec6a3c14029d539572be79be200cc78e134793f966d188262512c000eab20b26a438bbff6089280738b7295febfe3b7af6c9c3fb636514e7e82ac7ff154f89d38279f1d69d0b9884500184a127906abf34fb3f85e7cad1c8f542ae876001219304ec3b9b7b8e56ddc5dc7371e7fa39d135bc3b3cfc5e6cab4b1b053d4a23d772ace464815a2e83de3e5adbeb0065be761325f1411c56862961d7a3959c24701662bcf8000000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71000000000327f1a1014155575600000000000831e98100002710aa144906b3ed6333992a2571b86f4c972d2066a5010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221000000005779344e00000000000ff6d0fffffff800000000662bcf8000000000662bcf7f0000000057189e560000000000150a890a13256f1e91e8159f08449ba3e77f735dea76defedbc4310c6345f139afb662649e84f66b5d3880db594bcc94350eaa0f70279e9e296f063faa064a3ca9ec1c3c42c37b63dade1fa82a817830c233fdbb340b4ea56be61f3f16f0202872bd8101cb043c3e0f2c240eafaccbe2fb3c0cbec3d3ff64c1f136d2624b4db0e1b10d8bf7b77bd02c70b4a262f8b0697135b1abac61c562ad14140ad042c2aeed6b34ccc631fde91367770e1efe7ba36d15fddc6c3949aad97755cfbcabd6459948b2c08a519cb76599b2e6'

// TODO: figure out what the "fulfill" process is and where to get these from
// Publish Time: 1705340314
const ETH_VAA_FULFILL =
  '0x504e41550100000003b801000000030d029233926abe8b47091a8732d99bccb39c8a1f582599d5b86c9b2e29a9f4af8f845d0c89560bd74509feeeb7889442b0615bd1a59020b83f8ff891ed8493715be40003bd3877d2c1e3dbfeeaa63f0243c795a8f30151e30df7d1c3ca17b6a4f22eaa417bc22469c45206e7b0db4a08de4449e37664aa42351f7547bf877ad58a44501e0004e8cc244b4213569b869e99d508c15092d67fd4494934bd03b1d3684ca8ed32535e8f8b6491a5a67e05f84c83c1c776517e1eea7fe5109041ce01dca5826c5d87010622db91443417ca1b129c44fde4c299248cd0a0e1cd5796f55d1538751bc4cb727ee0df1f413cae6b17543e32af455854f42441078816797fbdcf859554c5f83100075c4d8983cfcd487a1182b7896e769e86fc43ee7e1a70a75feba18bcee0f14d1a4a9535599bb025f5f885a639001a53551a6fa47b4769d7ebf5870d26652d9c8d0108899b4573428b0b850fce1d0caaeb5114236ef00b3a04ecae8ced81af335f38b02499ed57069699f289bd13a8e9519bff18da813f75f9ed7f63b128af90c5a569000b5a65799208e818b7360a3044cd875da3d08539915464056d6c7243ff7522c4347d6bafd16f80a8550a1ccf3683f8a344e20e5351bbd03dd3b5b684dd717eda6f010c652ab290b56da6ebd3d508150d3ee6cdf7828c19ca2bd683089ceb6cdda70c250cc34318a2eff108ed4ec581799fad56606270a7bb739276dc2b279aef1ea6f8000d568b5d05bc68600430fb5b9baf29e5573422f0a77b7af203fffb5d1affa6a5887bb546b6461ae3bf4b33a2a33e9f1960e74446b844b20eb2afdd8bc6421640ae000ec27285d82efc3659ebd07bcd88e896431d687802bc20efb465bab2aaeb602b6f72d8af67191a08371d6b7f2f1ac8b9181a4082020dd722215398b3685336956b000f04527970e23f4e97e8ba8f13c4bd2b4efa96549af92bfb4200e02d72b9a7cc7b3045160e4bdf117ba506535aa12c1a2b2b8d4027d1e113ab55279f1cee9df04f001052df944588b88196cae15fd36561f33fab5f69fd78488153e75f2f6e58dbd8a772687d9fd96201e6b65e54422213e6b64e3b1cb432c597238b0ca75991e702c501124614b2615cbfb647780c2af3ccccc8bee38005a0782929bfa1aa272c8387d9520a58fa6df0107762e4bc06bb3dbc1976b5b1b905f827dfc9e7623ad298ff34e90165a56d9a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a7573014155575600000000000731ba8400002710500569ca8f8eb579f76faf1c424901b9fbe7102101005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003ae90ce0030000000008ca165dfffffff80000000065a56d9a0000000065a56d990000003acbefc6c0000000000a85dec60a10138ab3d2671462714ce1d9f7fb12549d52446b48f96a938f8699a56be7fb9f9a6ce552a014eed88ac01bc9ace8518516b66f6b0534a4ba61163b709d1dd5b9d7de9b01325fec1e5ca08a987c15effe452d9898957fc965fff9544194fa6953bbf53dc6c1e5dea855d2a632b37b723e0c99202f53f31c3297a86c5f02178383f7b9b4e7073b4293fe1ebbf8ac1bda3d8ec771e545ada346ae3290d3a6adf31d5f3b2da5df74233573338348a4e507654520c155deccd90d81ba88894a39f23e935eae758f77ddb3'

const BTC_VAA_FULFILL =
  '0x504e41550100000003b801000000030d029233926abe8b47091a8732d99bccb39c8a1f582599d5b86c9b2e29a9f4af8f845d0c89560bd74509feeeb7889442b0615bd1a59020b83f8ff891ed8493715be40003bd3877d2c1e3dbfeeaa63f0243c795a8f30151e30df7d1c3ca17b6a4f22eaa417bc22469c45206e7b0db4a08de4449e37664aa42351f7547bf877ad58a44501e0004e8cc244b4213569b869e99d508c15092d67fd4494934bd03b1d3684ca8ed32535e8f8b6491a5a67e05f84c83c1c776517e1eea7fe5109041ce01dca5826c5d87010622db91443417ca1b129c44fde4c299248cd0a0e1cd5796f55d1538751bc4cb727ee0df1f413cae6b17543e32af455854f42441078816797fbdcf859554c5f83100075c4d8983cfcd487a1182b7896e769e86fc43ee7e1a70a75feba18bcee0f14d1a4a9535599bb025f5f885a639001a53551a6fa47b4769d7ebf5870d26652d9c8d0108899b4573428b0b850fce1d0caaeb5114236ef00b3a04ecae8ced81af335f38b02499ed57069699f289bd13a8e9519bff18da813f75f9ed7f63b128af90c5a569000b5a65799208e818b7360a3044cd875da3d08539915464056d6c7243ff7522c4347d6bafd16f80a8550a1ccf3683f8a344e20e5351bbd03dd3b5b684dd717eda6f010c652ab290b56da6ebd3d508150d3ee6cdf7828c19ca2bd683089ceb6cdda70c250cc34318a2eff108ed4ec581799fad56606270a7bb739276dc2b279aef1ea6f8000d568b5d05bc68600430fb5b9baf29e5573422f0a77b7af203fffb5d1affa6a5887bb546b6461ae3bf4b33a2a33e9f1960e74446b844b20eb2afdd8bc6421640ae000ec27285d82efc3659ebd07bcd88e896431d687802bc20efb465bab2aaeb602b6f72d8af67191a08371d6b7f2f1ac8b9181a4082020dd722215398b3685336956b000f04527970e23f4e97e8ba8f13c4bd2b4efa96549af92bfb4200e02d72b9a7cc7b3045160e4bdf117ba506535aa12c1a2b2b8d4027d1e113ab55279f1cee9df04f001052df944588b88196cae15fd36561f33fab5f69fd78488153e75f2f6e58dbd8a772687d9fd96201e6b65e54422213e6b64e3b1cb432c597238b0ca75991e702c501124614b2615cbfb647780c2af3ccccc8bee38005a0782929bfa1aa272c8387d9520a58fa6df0107762e4bc06bb3dbc1976b5b1b905f827dfc9e7623ad298ff34e90165a56d9a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a7573014155575600000000000731ba8400002710500569ca8f8eb579f76faf1c424901b9fbe7102101005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43000003e0e460151d00000000a9d70267fffffff80000000065a56d9a0000000065a56d99000003ddd94910a000000000a55db22c0ad762f4bd496a46f54831d3eb57099ec06e7ff2c2cc69f033dc644bcddc0a311e21292c8fa0ae073caafcf460222ee1fb18cf41b96452ca3be4e155f0f594160920e99b50baaf946164f42afcc0e97a1b1981a02a9f0882f0f0fd3a7352bc119379dbc677f93a5b7a4bc573941f7d8da13bce06233f3fbdc094a3664e549c7b0fa004cffe3a1138797428d6d56d815b108928129cfedb46e808314e41558c10e65f3b2da5df74233573338348a4e507654520c155deccd90d81ba88894a39f23e935eae758f77ddb3'

const LINK_VAA_FULFILL =
  '0x504e41550100000003b801000000030d029233926abe8b47091a8732d99bccb39c8a1f582599d5b86c9b2e29a9f4af8f845d0c89560bd74509feeeb7889442b0615bd1a59020b83f8ff891ed8493715be40003bd3877d2c1e3dbfeeaa63f0243c795a8f30151e30df7d1c3ca17b6a4f22eaa417bc22469c45206e7b0db4a08de4449e37664aa42351f7547bf877ad58a44501e0004e8cc244b4213569b869e99d508c15092d67fd4494934bd03b1d3684ca8ed32535e8f8b6491a5a67e05f84c83c1c776517e1eea7fe5109041ce01dca5826c5d87010622db91443417ca1b129c44fde4c299248cd0a0e1cd5796f55d1538751bc4cb727ee0df1f413cae6b17543e32af455854f42441078816797fbdcf859554c5f83100075c4d8983cfcd487a1182b7896e769e86fc43ee7e1a70a75feba18bcee0f14d1a4a9535599bb025f5f885a639001a53551a6fa47b4769d7ebf5870d26652d9c8d0108899b4573428b0b850fce1d0caaeb5114236ef00b3a04ecae8ced81af335f38b02499ed57069699f289bd13a8e9519bff18da813f75f9ed7f63b128af90c5a569000b5a65799208e818b7360a3044cd875da3d08539915464056d6c7243ff7522c4347d6bafd16f80a8550a1ccf3683f8a344e20e5351bbd03dd3b5b684dd717eda6f010c652ab290b56da6ebd3d508150d3ee6cdf7828c19ca2bd683089ceb6cdda70c250cc34318a2eff108ed4ec581799fad56606270a7bb739276dc2b279aef1ea6f8000d568b5d05bc68600430fb5b9baf29e5573422f0a77b7af203fffb5d1affa6a5887bb546b6461ae3bf4b33a2a33e9f1960e74446b844b20eb2afdd8bc6421640ae000ec27285d82efc3659ebd07bcd88e896431d687802bc20efb465bab2aaeb602b6f72d8af67191a08371d6b7f2f1ac8b9181a4082020dd722215398b3685336956b000f04527970e23f4e97e8ba8f13c4bd2b4efa96549af92bfb4200e02d72b9a7cc7b3045160e4bdf117ba506535aa12c1a2b2b8d4027d1e113ab55279f1cee9df04f001052df944588b88196cae15fd36561f33fab5f69fd78488153e75f2f6e58dbd8a772687d9fd96201e6b65e54422213e6b64e3b1cb432c597238b0ca75991e702c501124614b2615cbfb647780c2af3ccccc8bee38005a0782929bfa1aa272c8387d9520a58fa6df0107762e4bc06bb3dbc1976b5b1b905f827dfc9e7623ad298ff34e90165a56d9a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a7573014155575600000000000731ba8400002710500569ca8f8eb579f76faf1c424901b9fbe71021010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221000000005c3e80800000000000137f73fffffff80000000065a56d9a0000000065a56d99000000005c1a0804000000000013d9ca0a72b1dfc9d3ff354cae4e5bd2f7d046ee0c234efe39cfaf353320ddb6d77858275cf8952ba7a1cefab48927d334d00931cb516a5d56c1933dd04af2e2c7e1c1d029646313a29863d4c9220ee5704692708224e28f86c61902d67d910dc7ce3d8b338f3819163951d20ac9ff018f038890f62a0e8cbda945fd4c4848450a3a5f2fa3c6bd4a3f3cd94229f5fbbd2ac1adb0bd5932eb1acf493cdbedb19fdaf50bf5ea0a6f16cbfa43c1d048c68b6f0d6281b62ac682deccd90d81ba88894a39f23e935eae758f77ddb3'
