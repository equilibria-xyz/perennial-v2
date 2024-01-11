import HRE from 'hardhat'
import { expect } from 'chai'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'
import { increase, increaseTo } from '../../../../../common/testutil/time'
import { ArbGasInfo, IERC20, MarketFactory, OracleFactory, ProxyAdmin, PythFactory } from '../../../../types/generated'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'

describe('Verify Arbitrum v2.1 Migration', () => {
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

  before(async () => {
    DSU = await ethers.getContractAt('IERC20', (await get('DSU')).address)
    USDC = await ethers.getContractAt('IERC20', (await get('USDC')).address)
    // Deploy migration
    await fixture('v2_1_Migration', { keepExistingDeployments: true })

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

    await proxyAdmin.upgradeAndCall(
      oracleFactory.address,
      (
        await get('OracleFactoryImpl')
      ).address,
      oracleFactory.interface.encodeFunctionData('initialize', [
        (await get('DSU')).address,
        (await get('USDC')).address,
        (await get('DSUReserve')).address,
      ]),
    )

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

    await pythFactory.acceptOwner()

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

    await increaseTo(1704922300)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const oracle = await ethers.getContractAt('Oracle', await ethMarket.oracle())
    const oracleProvider = await ethers.getContractAt('IOracleProvider', (await oracle.oracles(2)).provider)
    const currentPosition = await ethMarket.positions(perennialUser.address)
    await pythFactory.commit([oracleIDs[0].id], 1704922296, ETH_VAA_UPDATE, { value: 1 })

    await expect(
      ethMarket.connect(perennialUser).update(perennialUser.address, currentPosition.maker.add(10), 0, 0, 0, false),
    )
      .to.emit(oracleProvider, 'OracleProviderVersionRequested')
      .withArgs(1704922310)

    await increase(10)

    await expect(pythFactory.commit([oracleIDs[0].id], 1704922310, ETH_VAA_FULFILL, { value: 1 })).to.emit(
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

    await increaseTo(1704922300)

    await pythFactory.commit([oracleIDs[0].id], 1704922296, ETH_VAA_UPDATE, { value: 1 })
    await ethMarket
      .connect(timelockSigner)
      .updateRiskParameter({ ...riskParameter, minMargin: 50e6, minMaintenance: 50e6 })

    await ethMarket.connect(liquidator).update(perennialUser.address, 0, 0, 0, 0, true)

    await increase(10)

    await pythFactory.commit([oracleIDs[0].id], 1704922310, ETH_VAA_FULFILL, { value: 1 })

    await ethMarket.connect(liquidator).update(liquidator.address, 0, 0, 0, 0, false)
    await ethMarket.connect(liquidator).update(perennialUser.address, 0, 0, 0, 0, false)

    expect((await ethMarket.locals(liquidator.address)).collateral).to.equal(5e6)
  })

  it('settles vaults', async () => {
    const perennialUser = await impersonateWithBalance(
      '0x3dd81863779991d88d7f186d41b8bea1a569553d',
      ethers.utils.parseEther('10'),
    )

    await increaseTo(1704922300)

    const ethMarket = await ethers.getContractAt('IMarket', '0x90A664846960AaFA2c164605Aebb8e9Ac338f9a0')
    const btcMarket = await ethers.getContractAt('IMarket', '0xcC83e3cDA48547e3c250a88C8D5E97089Fd28F60')
    const linkMarket = await ethers.getContractAt('IMarket', '0xD9c296A7Bee1c201B9f3531c7AC9c9310ef3b738')

    await pythFactory.commit([oracleIDs[0].id], 1704922296, ETH_VAA_UPDATE, { value: 1 })
    await pythFactory.commit([oracleIDs[1].id], 1704922296, BTC_VAA_UPDATE, { value: 1 })
    await pythFactory.commit([oracleIDs[6].id], 1704922296, LINK_VAA_UPDATE, { value: 1 })

    const asterVault = await ethers.getContractAt('IVault', (await get('AsterVault')).address)

    await expect(asterVault.connect(perennialUser).update(perennialUser.address, 0, 10e6, 0))
      .to.emit(ethMarket, 'Updated')
      .to.emit(btcMarket, 'Updated')
      .to.emit(linkMarket, 'Updated')
  })
})

// Publish Time: 1704922300
const ETH_VAA_UPDATE =
  '0x504e41550100000003b801000000030d03bd5e5750fea8fc997328806a7e98d7d47b63c5a6a02a272cb94a29ec449af12a72f62b88d98005ec4314e4828489480a0998dd64c66460f1895da3146cfff9270004c2d0f75ec6875c150f544a47a76e4d898cb5c73801d621d2f9a01a0a200f13935796d0949970316212693c74c9c26cfc4d86d56d4ae32b6a752c9bc561a5d4fb01060d2b9dcb4e029237e57e8949af6c08e8b0faf831e56d6aec260e58f3d28f9d8964af0c5bee5602d74107f1786a47686277bf8dfd55d6f2e721dd2c5b958a55870007ff403718848c3bdd3cabe5054008b0be303d9729ba193a8d22137b6a8067ef2a709fc9c194c4f12a5ca8e181f2878c5f901d87a1a842fe35f4ce2d6680210d690008385dfb60febd764ec06658c30a1a79895e43b64fd3af4e4d74a860fa43546cd74cf4782a730254c4119b0e92049c69018c696724464c0573100dd6006452450d01097bb2bfbdc7940e19e0bcef34d441d4494d85c781b304278a077137dd058607bb50eb58d0bde824705fd1d5f659e975dc52aab859b4359f06ebd268f094960a1c010aa2718bbd1b551eafc5e21ac89f2b94e8b45f133b73294556ff4f3d9f1c92ede3716508edecf8c5607d5d45c199455e2061f2812acd4e8d3dbb33d2aea23850e6000bb3ad9fb08847f053701de10d44a1ed049add27a6d8de6469cc25818be2f30cc91ff684df8bc24d16a009e4bf5a142aa05d5355308a79d7557ed30c37f752b5b1010d4d4b83fbf63c1cd29ac60af60879cf95b58975c75278ff2a6dce4e18cf40bcd53da3797f0e45797fbfe9fa2c2268056f76f039d465698fda3b9ff4b42a2486f6000ebae9c48588d7b0c00fce7dc82c8652b34653ebe92228e840c5f5821c2eff0f047aacb95e4a09f0cd614c3f57d2a4fb65baec9c2768d41a22e5c6ce35568ea44a000f6174f5f04bf9de984fe41c9e98fd60149a9fb4d764be233bb0a880cadb09f18147b7ac781427679ad5be83889e17d0a16748cd9d34689c7f6b76b30567235be80110028ac75be0251e1a4e10fd717f996d4df4784c6d959955922e457240af02ea625b903b632070806af32e960c7e092575d5693692a18957855143ba2733eab6500012db66541e0802b6164754a4ff879ee0b1a9646b1258d76fbc72d98ed4e021b1c739d72ddcb32df29368e246dfc822b5ef245a97607120658ef79d2f0cc641dc9101659f0cbc00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000021f4a7401415557560000000000072687160000271037fc346bb788e5d32339f63d73c615753792f33501005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003a5d733c71000000001f9e629ffffffff800000000659f0cbc00000000659f0cbb000000397468a940000000000a52fa210ac6a0c5d97e5e02f65cdaea2b52521245cfac5a6d207570162fc11427d88a6e54fcf983e31017f8df36831e8165aaf9ededfedb914a78a5083db555af04e3afc33b3aff0fabe8b2109ae2d00d49458c0c9c1b7fe9ff98fcf77be2fdc0b8eec5ef855ac17856f05282abe8ac62e5b19af9c4a0949ae30a6e7116fb504820491ff088298e2192c4df0f3346d4025a86c5ac3bef95ee2276cd8961c722e6399a6e8ac5b53b012cf476dcfc4f79ed37cb040e6e71a26c1533614f5ee0b498735186734aa3b2c33da618e5'

const BTC_VAA_UPDATE =
  '0x504e41550100000003b801000000030d03bd5e5750fea8fc997328806a7e98d7d47b63c5a6a02a272cb94a29ec449af12a72f62b88d98005ec4314e4828489480a0998dd64c66460f1895da3146cfff9270004c2d0f75ec6875c150f544a47a76e4d898cb5c73801d621d2f9a01a0a200f13935796d0949970316212693c74c9c26cfc4d86d56d4ae32b6a752c9bc561a5d4fb01060d2b9dcb4e029237e57e8949af6c08e8b0faf831e56d6aec260e58f3d28f9d8964af0c5bee5602d74107f1786a47686277bf8dfd55d6f2e721dd2c5b958a55870007ff403718848c3bdd3cabe5054008b0be303d9729ba193a8d22137b6a8067ef2a709fc9c194c4f12a5ca8e181f2878c5f901d87a1a842fe35f4ce2d6680210d690008385dfb60febd764ec06658c30a1a79895e43b64fd3af4e4d74a860fa43546cd74cf4782a730254c4119b0e92049c69018c696724464c0573100dd6006452450d01097bb2bfbdc7940e19e0bcef34d441d4494d85c781b304278a077137dd058607bb50eb58d0bde824705fd1d5f659e975dc52aab859b4359f06ebd268f094960a1c010aa2718bbd1b551eafc5e21ac89f2b94e8b45f133b73294556ff4f3d9f1c92ede3716508edecf8c5607d5d45c199455e2061f2812acd4e8d3dbb33d2aea23850e6000bb3ad9fb08847f053701de10d44a1ed049add27a6d8de6469cc25818be2f30cc91ff684df8bc24d16a009e4bf5a142aa05d5355308a79d7557ed30c37f752b5b1010d4d4b83fbf63c1cd29ac60af60879cf95b58975c75278ff2a6dce4e18cf40bcd53da3797f0e45797fbfe9fa2c2268056f76f039d465698fda3b9ff4b42a2486f6000ebae9c48588d7b0c00fce7dc82c8652b34653ebe92228e840c5f5821c2eff0f047aacb95e4a09f0cd614c3f57d2a4fb65baec9c2768d41a22e5c6ce35568ea44a000f6174f5f04bf9de984fe41c9e98fd60149a9fb4d764be233bb0a880cadb09f18147b7ac781427679ad5be83889e17d0a16748cd9d34689c7f6b76b30567235be80110028ac75be0251e1a4e10fd717f996d4df4784c6d959955922e457240af02ea625b903b632070806af32e960c7e092575d5693692a18957855143ba2733eab6500012db66541e0802b6164754a4ff879ee0b1a9646b1258d76fbc72d98ed4e021b1c739d72ddcb32df29368e246dfc822b5ef245a97607120658ef79d2f0cc641dc9101659f0cbc00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000021f4a7401415557560000000000072687160000271037fc346bb788e5d32339f63d73c615753792f33501005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43000004253b0cddc00000000103608cb6fffffff800000000659f0cbc00000000659f0cbb0000042f14b0b8e000000000a447d3680a4bcd3d85d3b4c7b3963d81471cdf46f75c4fe8773adbf57e573972a83f4e115095115b151eeb660083a908bf1d32a54f13b524dfe059562c34f53987417e54c2e9537dfb31b5b4a67a4b77b89ed19613561b7a6272582eaf789d3c8c7f1a5f4bfdade3dfd336c60ec3065b4a4e0a27c0f28beada717ba32c55c670bf9f9bf1fc1fb24a285dcaed5b853f79f9025830dd9a9df0504fda8854b603b79bd6c9a449c5b53b012cf476dcfc4f79ed37cb040e6e71a26c1533614f5ee0b498735186734aa3b2c33da618e5'

const LINK_VAA_UPDATE =
  '0x504e41550100000003b801000000030d03bd5e5750fea8fc997328806a7e98d7d47b63c5a6a02a272cb94a29ec449af12a72f62b88d98005ec4314e4828489480a0998dd64c66460f1895da3146cfff9270004c2d0f75ec6875c150f544a47a76e4d898cb5c73801d621d2f9a01a0a200f13935796d0949970316212693c74c9c26cfc4d86d56d4ae32b6a752c9bc561a5d4fb01060d2b9dcb4e029237e57e8949af6c08e8b0faf831e56d6aec260e58f3d28f9d8964af0c5bee5602d74107f1786a47686277bf8dfd55d6f2e721dd2c5b958a55870007ff403718848c3bdd3cabe5054008b0be303d9729ba193a8d22137b6a8067ef2a709fc9c194c4f12a5ca8e181f2878c5f901d87a1a842fe35f4ce2d6680210d690008385dfb60febd764ec06658c30a1a79895e43b64fd3af4e4d74a860fa43546cd74cf4782a730254c4119b0e92049c69018c696724464c0573100dd6006452450d01097bb2bfbdc7940e19e0bcef34d441d4494d85c781b304278a077137dd058607bb50eb58d0bde824705fd1d5f659e975dc52aab859b4359f06ebd268f094960a1c010aa2718bbd1b551eafc5e21ac89f2b94e8b45f133b73294556ff4f3d9f1c92ede3716508edecf8c5607d5d45c199455e2061f2812acd4e8d3dbb33d2aea23850e6000bb3ad9fb08847f053701de10d44a1ed049add27a6d8de6469cc25818be2f30cc91ff684df8bc24d16a009e4bf5a142aa05d5355308a79d7557ed30c37f752b5b1010d4d4b83fbf63c1cd29ac60af60879cf95b58975c75278ff2a6dce4e18cf40bcd53da3797f0e45797fbfe9fa2c2268056f76f039d465698fda3b9ff4b42a2486f6000ebae9c48588d7b0c00fce7dc82c8652b34653ebe92228e840c5f5821c2eff0f047aacb95e4a09f0cd614c3f57d2a4fb65baec9c2768d41a22e5c6ce35568ea44a000f6174f5f04bf9de984fe41c9e98fd60149a9fb4d764be233bb0a880cadb09f18147b7ac781427679ad5be83889e17d0a16748cd9d34689c7f6b76b30567235be80110028ac75be0251e1a4e10fd717f996d4df4784c6d959955922e457240af02ea625b903b632070806af32e960c7e092575d5693692a18957855143ba2733eab6500012db66541e0802b6164754a4ff879ee0b1a9646b1258d76fbc72d98ed4e021b1c739d72ddcb32df29368e246dfc822b5ef245a97607120658ef79d2f0cc641dc9101659f0cbc00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000021f4a7401415557560000000000072687160000271037fc346bb788e5d32339f63d73c615753792f335010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d22100000000565c3d9e00000000001100e2fffffff800000000659f0cbc00000000659f0cbb000000005524d8a8000000000011937c0a50770b50f7c2451662d4ff6215237b9f4e199ef1fb22380ed2a005160e30eb8848b1f956ebd8c1f608ef0c0152f1c818ee928210d10009ebe603ca3840ee35d66bba3d391672c678dd359d4ea3fd19d72b61e4bda457b243db0fb69961dca40ccf2838627f158c0c30d72c9a505734f02e276ba26e998893f2bc13dc74606e955708744bedd66a8b7eea58b0862cbf4a3d98b53370d0d7801fc6b2e93f2dc05d2ab6e3c57b8090b6e5b0bc87457897a66210928d1533614f5ee0b498735186734aa3b2c33da618e5'

// Publish Time: 1704922314
const ETH_VAA_FULFILL =
  '0x504e41550100000003b801000000030d03637743675506aff43edacd585daa0e17e3225cd0b5dd3e89b2a164cafe9a72ba74400b48ddc485aab93a41372958d9e371ade21a25a9c5330e10d1f95069f4300004452e5c8fc540fe1c8c48edc352ecc5eefbe6ab4fcea7e383ec07d6ff270662c30ccf945e6a2153482afe1e705fc85124e2b77dca62084c306a2f104b3eef7c8300064c99f89e2421cd71a2809aaef37666527a9b1954565172e41056e4044dc881b51aab808e1f4981ac6cd436aa8e53bcbcc3c7636bca0a63d75df32940fa63969f01083a076475f398124650cc4ee8a9bef7aeba333d05b8c629d9231b0571f829de422e9b5f4caaafdb287e4ceef7b842b9eb0d92ae462328f1b352945eaa516a73c101098650e4feb028d2d7edb2b68ce9527009c451bff5bb8cca77bf5103d8ca5476417d9a8c3ced240d1051638aaa7e04ae013ddab1ba56cacef8c89d359efa1689d3000a6e5df595a4092c0d6495634f4d19a576305bf92e7b6361b385a309f7da663d6d3de47870eb4f4e004e520231eff91f65db57effda400023005891e0d261b8492010bd1a2fcead068b68e906365e8cd39e05112451c47bdf7d8bcc20cd02ff29fe3726d7e37732c6994edb06fc323894b39229c0980fc1910a973e39482f9a8a78388000c4d0b2396824c1bfaceacffc03b0849a32c6e62279e7e33303d4ab96eb23a451758a02000c41db689243124c6295ad7130e0994fb0c04c9b9a3b81ce025fe34d9010d71feec113f1609c605811f20b2caa9852745d5df0888a70d3841048c2e30510b504daaaa8c4276b5667a639b653f57a6b8f897f3dce94b0433650ceb4370c3dd010ee59120519237e2894a8725075fc261d518f3fcfa5564fea7c34ec4b29fd560496ba3cc3e73e201804e7e92c5b2bf5e7f0717c52495f044903910347498d62079010f433f49079a95cbeb50cc783bc5597b9294c122bb60c7106473ba94921733bace533055bc4a7c77959312ac16f4b44a2ae8aced2a958dbe53c4b319441a4fa3f6001012a8147ad08a6a79d7e425903337a81fc9ce824a69a5de1c36d128b2b115cf1c7c84c16e382ecdadad4626b7649929c6e09c12a1efda10e33116915946d645ec0112ae909a92a09e4c9b84471896424d1f6f45ceae26f970134c185429327006bd627746197cf44c1f8790c3b29295db1b0c8054216ae4cbf1d30fa0c0758958f0bd01659f0cca00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000021f4a8a014155575600000000000726872c00002710cd94d3d2b19d571c35d13538bb5dd6bdad4e58c001005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003a77cf26ad000000000da6899efffffff800000000659f0cca00000000659f0cc90000003974e5fb48000000000a54c2330ada82fabb053e7a02d1d6ee90c222324985cca844207570162fc11427d88a6e54fcf983e31017f8dfbade1395e1196584014510f10477cbe300c7291aa3c9b2a4ac83b9482b3a794d1034beec514328dbf03ca7ad448dc4f0de75f1b46acb2b4b21650d450b9bbd7f13c0e90ffe9c46b515d8e65dc3abb3fab01753840d7e5c6c71944bdd38a65a3fcddbcaa84c0eb60adcbe4b4cb034e16a2c64ab758b2f867b9bb79ff4070c8223a24e906e5b45979e02874b513061cd05774b3d7f68af3161ce1258c5bb0e54ed'

const BTC_VAA_FULFILL =
  '0x504e41550100000003b801000000030d03637743675506aff43edacd585daa0e17e3225cd0b5dd3e89b2a164cafe9a72ba74400b48ddc485aab93a41372958d9e371ade21a25a9c5330e10d1f95069f4300004452e5c8fc540fe1c8c48edc352ecc5eefbe6ab4fcea7e383ec07d6ff270662c30ccf945e6a2153482afe1e705fc85124e2b77dca62084c306a2f104b3eef7c8300064c99f89e2421cd71a2809aaef37666527a9b1954565172e41056e4044dc881b51aab808e1f4981ac6cd436aa8e53bcbcc3c7636bca0a63d75df32940fa63969f01083a076475f398124650cc4ee8a9bef7aeba333d05b8c629d9231b0571f829de422e9b5f4caaafdb287e4ceef7b842b9eb0d92ae462328f1b352945eaa516a73c101098650e4feb028d2d7edb2b68ce9527009c451bff5bb8cca77bf5103d8ca5476417d9a8c3ced240d1051638aaa7e04ae013ddab1ba56cacef8c89d359efa1689d3000a6e5df595a4092c0d6495634f4d19a576305bf92e7b6361b385a309f7da663d6d3de47870eb4f4e004e520231eff91f65db57effda400023005891e0d261b8492010bd1a2fcead068b68e906365e8cd39e05112451c47bdf7d8bcc20cd02ff29fe3726d7e37732c6994edb06fc323894b39229c0980fc1910a973e39482f9a8a78388000c4d0b2396824c1bfaceacffc03b0849a32c6e62279e7e33303d4ab96eb23a451758a02000c41db689243124c6295ad7130e0994fb0c04c9b9a3b81ce025fe34d9010d71feec113f1609c605811f20b2caa9852745d5df0888a70d3841048c2e30510b504daaaa8c4276b5667a639b653f57a6b8f897f3dce94b0433650ceb4370c3dd010ee59120519237e2894a8725075fc261d518f3fcfa5564fea7c34ec4b29fd560496ba3cc3e73e201804e7e92c5b2bf5e7f0717c52495f044903910347498d62079010f433f49079a95cbeb50cc783bc5597b9294c122bb60c7106473ba94921733bace533055bc4a7c77959312ac16f4b44a2ae8aced2a958dbe53c4b319441a4fa3f6001012a8147ad08a6a79d7e425903337a81fc9ce824a69a5de1c36d128b2b115cf1c7c84c16e382ecdadad4626b7649929c6e09c12a1efda10e33116915946d645ec0112ae909a92a09e4c9b84471896424d1f6f45ceae26f970134c185429327006bd627746197cf44c1f8790c3b29295db1b0c8054216ae4cbf1d30fa0c0758958f0bd01659f0cca00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000021f4a8a014155575600000000000726872c00002710cd94d3d2b19d571c35d13538bb5dd6bdad4e58c001005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b4300000426e793ee8400000000c558bdebfffffff800000000659f0cca00000000659f0cc90000042f105240c000000000a45f2e500a4bcd3d85d3b4c7b3963d81471cdf46f75c4fe877d4dc9657b3a2d6ff7ab815e03b5f2befd128cbd3423b9df089df77f6a0a4360fef731e5245d35eed717eb996cc2af509c0e77b714a923c12e9807714e1f0c4e15443b6d2f8017102926afb71cd0f4d5264692ff310c7873760d91e0c44fa7c8b36fe51346b3d3d1c9125b044f09c77b52b4a7a3f0e91351edf87c1f5ee0f241ef4b90cec26cf1a85f8843a969bb79ff4070c8223a24e906e5b45979e02874b513061cd05774b3d7f68af3161ce1258c5bb0e54ed'

const LINK_VAA_FULFILL =
  '0x504e41550100000003b801000000030d03637743675506aff43edacd585daa0e17e3225cd0b5dd3e89b2a164cafe9a72ba74400b48ddc485aab93a41372958d9e371ade21a25a9c5330e10d1f95069f4300004452e5c8fc540fe1c8c48edc352ecc5eefbe6ab4fcea7e383ec07d6ff270662c30ccf945e6a2153482afe1e705fc85124e2b77dca62084c306a2f104b3eef7c8300064c99f89e2421cd71a2809aaef37666527a9b1954565172e41056e4044dc881b51aab808e1f4981ac6cd436aa8e53bcbcc3c7636bca0a63d75df32940fa63969f01083a076475f398124650cc4ee8a9bef7aeba333d05b8c629d9231b0571f829de422e9b5f4caaafdb287e4ceef7b842b9eb0d92ae462328f1b352945eaa516a73c101098650e4feb028d2d7edb2b68ce9527009c451bff5bb8cca77bf5103d8ca5476417d9a8c3ced240d1051638aaa7e04ae013ddab1ba56cacef8c89d359efa1689d3000a6e5df595a4092c0d6495634f4d19a576305bf92e7b6361b385a309f7da663d6d3de47870eb4f4e004e520231eff91f65db57effda400023005891e0d261b8492010bd1a2fcead068b68e906365e8cd39e05112451c47bdf7d8bcc20cd02ff29fe3726d7e37732c6994edb06fc323894b39229c0980fc1910a973e39482f9a8a78388000c4d0b2396824c1bfaceacffc03b0849a32c6e62279e7e33303d4ab96eb23a451758a02000c41db689243124c6295ad7130e0994fb0c04c9b9a3b81ce025fe34d9010d71feec113f1609c605811f20b2caa9852745d5df0888a70d3841048c2e30510b504daaaa8c4276b5667a639b653f57a6b8f897f3dce94b0433650ceb4370c3dd010ee59120519237e2894a8725075fc261d518f3fcfa5564fea7c34ec4b29fd560496ba3cc3e73e201804e7e92c5b2bf5e7f0717c52495f044903910347498d62079010f433f49079a95cbeb50cc783bc5597b9294c122bb60c7106473ba94921733bace533055bc4a7c77959312ac16f4b44a2ae8aced2a958dbe53c4b319441a4fa3f6001012a8147ad08a6a79d7e425903337a81fc9ce824a69a5de1c36d128b2b115cf1c7c84c16e382ecdadad4626b7649929c6e09c12a1efda10e33116915946d645ec0112ae909a92a09e4c9b84471896424d1f6f45ceae26f970134c185429327006bd627746197cf44c1f8790c3b29295db1b0c8054216ae4cbf1d30fa0c0758958f0bd01659f0cca00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000021f4a8a014155575600000000000726872c00002710cd94d3d2b19d571c35d13538bb5dd6bdad4e58c0010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d22100000000567d4dc80000000000116ed8fffffff800000000659f0cca00000000659f0cc90000000055259aea00000000001194ed0ab1a9ec49adb962d7e578924eba2b7244d3e0dde47053f3423dafb981b15cf9d5c5fe91596f5049b25fe8e3d2281abd983b2ecff54a0a0ac9befd796f900ae72f09e8560b3a389a245dacb76f3f792e447a92409aa1c45cb666376d377e3582392be33e64c5168b265f41a3f4d8b12eab191eee2c50f9906423bcfc983904a38668ab8dfe49f5b8f978a8bb4b8ab282156f3f8fd0a6c87045b6c3873481a6fc665874f62c8adf146f4187ffb21de63020ce49f8643061cd05774b3d7f68af3161ce1258c5bb0e54ed'
