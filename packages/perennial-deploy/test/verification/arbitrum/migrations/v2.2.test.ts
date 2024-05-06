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
import { cmsqETHOracleID, msqBTCOracleID } from '../../../../util/constants'
import { isMainnet } from '../../../../../common/testutil/network'

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

  let dsuBalanceDifference: BigNumber
  let usdcBalanceDifference: BigNumber

  let oracleIDs: { id: string; oracle: string }[]
  let markets: IMarket[]

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

    // Perform v2.2 Migration
    // Enter settle only for all markets
    // Update to settle only using hardhat task
    console.log('---- Changing Markets Mode ----')
    await run('change-markets-mode', { settle: true, prevabi: true })
    console.log('---- Done ----\n')

    // Settle all users using hardhat task
    console.log('---- Settling Market Users ----')
    await run('settle-markets', { batchsize: 30 })
    console.log('---- Done ----\n')

    // Update implementations
    console.log('---- Upgrading Implementations ----')
    await run('2_2_upgrade-impls')
    console.log('---- Done ----\n')

    // Update oracles
    console.log('---- Setting up Oracles ----')
    await run('2_2_setup-oracles')
    console.log('---- Done ----\n')
  })

  it('Migrates', async () => {
    expect(await pythFactory.callStatic.owner()).to.be.eq(ownerSigner.address)
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
      expect(
        await contract['update(address,uint256,uint256,uint256,int256,bool)'](
          ethers.constants.AddressZero,
          0,
          0,
          0,
          0,
          false,
        ),
      ).to.not.be.reverted
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

const VAA_PUBLISH_TIME = 1714755044

const ETH_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00eb54b2a55f2a8a156bdde6d531bc18530c7fced2a3c11ab78645c0e27c93f60121185e2404e287bae845464acaf528f76e1fe288f0336dbb9298e16e40a2086a0101198719d7bba24a1edc35193eb078e1f7486c2cc5c8289abe4599d8193d64d73918dc8281e7092db0113cda122274f68199a666fcc04ba9faebcbd0b0ffab2424010255856a016d60a2414999bc8698b23ede80fcce38753c6b9914699d9a7f917f38490925123abfa5ad0fbf3fc80ad1110f220d225a6184101326561e8a6e3a93f101036ce935821eadc5a4c4622f47130c187ac5c6bf5c2acb0fd95bd818d3589edd4f38f9a2926b762daa326399ab94f33c254096ee72f998597f86df45af598eaf7c0104377faee6868e4c4671ee89e8867ab5292761cea97550bd1f29527cc5ab8f60bb4b50c763879fb89a1a1aa5d2b115ad595762fe4c597d2fb0ad134506a3b2efeb0106c0d39bbd90c85543494cd8a72875ce519f68c7b6a73157793e02aea480e1c81558633e96db1aa5face6a4b4add0e5d50449966da6044eaca5d958951f135cc400007112bb9d171e329587c8d7d1887f87d22cf30e9e176bfebe81fe0fb7e38ada90222848011aa3ac1ee43e0a759bb3be1871c2d89c359f008376a9e3006492595e70009daf9b3c332fff7515a5df80ede12cdd74339167e23e2be8cab5f31925d9cc39508f032f4ddcf84d34f12f6bedf2bc2ac69d970811b58f066bde184c4a1bc424d010aa77476ad581348443dac4dc49d1e2b7af113f2c25af0887e533ed23ec41055e81b9c22ca3878feabc8cde6e9552566314b0ab9c1e591681c7128b5f97ab43227000bc1a4d3e3b1b25ab7dfdadd5980d0561cf619496d3b4038addb25b20a865d34417e36317bd534935944d97bc9491d6c245283eaad9a3a3b8c873894543ccfb8bb010dc51fd70173b6f910f4a7a8b7efc32b660b0483bccd72e05b7a50894d30aace5d279bcfb7e39abe90e4c6cb1b5090f4f4d1d06e34100bf05fe815b801729ae80a010ed1727b55351f5c984debb4c52d4c6ade44d9013f22593859a3b418782e69052042a7066068d8901c336a96088c25f46e49fc59daa542a68757be33a8def94a42010ff9eca078bf934cd34d1871c54222cd1a4047a880192d1f527e0728ad484b49d15b11008bb295cae1f1d7f15dde2bba6da6bbfd9e7a49865d04d4eb73662b0eee00663515e400000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033d77ff014155575600000000000847760300002710fde52dfe2687ac0a3a5a999460140e4162a6809701005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace00000047754059e000000000138f7ba0fffffff800000000663515e400000000663515e30000004781029c70000000000c8156440a63c46061e7665de273d007512a0c6e08d2fbd5a0529f18489357817b52cc7e6f05f3dfa5567b2a7b85c5e974a14a0838eb12fe95382e68efed4b45413cd275e305171abfbe836abbcf93dfa82ef9b4ae7df1c4bdda8c0947c8ad312bbf0632946489eb13ef9ff132a2a832f4682d6533defd14e64e8a4260395054ac048cdcd46394750ca2fb21bd92c27c8f6215e464269408dcb491109aa65edba2700593dd946439a9f7c553bbcaf5cc1946534e4d892d381aceb50cd9bed54d03e3e4f4c665c810722acc1290'

const BTC_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00eb54b2a55f2a8a156bdde6d531bc18530c7fced2a3c11ab78645c0e27c93f60121185e2404e287bae845464acaf528f76e1fe288f0336dbb9298e16e40a2086a0101198719d7bba24a1edc35193eb078e1f7486c2cc5c8289abe4599d8193d64d73918dc8281e7092db0113cda122274f68199a666fcc04ba9faebcbd0b0ffab2424010255856a016d60a2414999bc8698b23ede80fcce38753c6b9914699d9a7f917f38490925123abfa5ad0fbf3fc80ad1110f220d225a6184101326561e8a6e3a93f101036ce935821eadc5a4c4622f47130c187ac5c6bf5c2acb0fd95bd818d3589edd4f38f9a2926b762daa326399ab94f33c254096ee72f998597f86df45af598eaf7c0104377faee6868e4c4671ee89e8867ab5292761cea97550bd1f29527cc5ab8f60bb4b50c763879fb89a1a1aa5d2b115ad595762fe4c597d2fb0ad134506a3b2efeb0106c0d39bbd90c85543494cd8a72875ce519f68c7b6a73157793e02aea480e1c81558633e96db1aa5face6a4b4add0e5d50449966da6044eaca5d958951f135cc400007112bb9d171e329587c8d7d1887f87d22cf30e9e176bfebe81fe0fb7e38ada90222848011aa3ac1ee43e0a759bb3be1871c2d89c359f008376a9e3006492595e70009daf9b3c332fff7515a5df80ede12cdd74339167e23e2be8cab5f31925d9cc39508f032f4ddcf84d34f12f6bedf2bc2ac69d970811b58f066bde184c4a1bc424d010aa77476ad581348443dac4dc49d1e2b7af113f2c25af0887e533ed23ec41055e81b9c22ca3878feabc8cde6e9552566314b0ab9c1e591681c7128b5f97ab43227000bc1a4d3e3b1b25ab7dfdadd5980d0561cf619496d3b4038addb25b20a865d34417e36317bd534935944d97bc9491d6c245283eaad9a3a3b8c873894543ccfb8bb010dc51fd70173b6f910f4a7a8b7efc32b660b0483bccd72e05b7a50894d30aace5d279bcfb7e39abe90e4c6cb1b5090f4f4d1d06e34100bf05fe815b801729ae80a010ed1727b55351f5c984debb4c52d4c6ade44d9013f22593859a3b418782e69052042a7066068d8901c336a96088c25f46e49fc59daa542a68757be33a8def94a42010ff9eca078bf934cd34d1871c54222cd1a4047a880192d1f527e0728ad484b49d15b11008bb295cae1f1d7f15dde2bba6da6bbfd9e7a49865d04d4eb73662b0eee00663515e400000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033d77ff014155575600000000000847760300002710fde52dfe2687ac0a3a5a999460140e4162a6809701005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b430000059d2d038c8500000000ae8b06dbfffffff800000000663515e400000000663515e30000059c188c87a000000000c71c1a340a40f3a8af3dc99bd006bbd33b97b27b56b641f8fa37f14463c162cc909ff205ca86f3042e7dcd3cfd81d543e3f25be5a779cb90fc9d16e55b6c4800513acafb020556dcfcf5d62f595b4bae3cbf7dc7ad2d69691cf658e2822745ac69cd781d77a347863c660f8fc676094d5fa338645580be43770ac9a0c9395054ac048cdcd46394750ca2fb21bd92c27c8f6215e464269408dcb491109aa65edba2700593dd946439a9f7c553bbcaf5cc1946534e4d892d381aceb50cd9bed54d03e3e4f4c665c810722acc1290'

const LINK_VAA_UPDATE =
  '0x504e41550100000003b801000000040d00eb54b2a55f2a8a156bdde6d531bc18530c7fced2a3c11ab78645c0e27c93f60121185e2404e287bae845464acaf528f76e1fe288f0336dbb9298e16e40a2086a0101198719d7bba24a1edc35193eb078e1f7486c2cc5c8289abe4599d8193d64d73918dc8281e7092db0113cda122274f68199a666fcc04ba9faebcbd0b0ffab2424010255856a016d60a2414999bc8698b23ede80fcce38753c6b9914699d9a7f917f38490925123abfa5ad0fbf3fc80ad1110f220d225a6184101326561e8a6e3a93f101036ce935821eadc5a4c4622f47130c187ac5c6bf5c2acb0fd95bd818d3589edd4f38f9a2926b762daa326399ab94f33c254096ee72f998597f86df45af598eaf7c0104377faee6868e4c4671ee89e8867ab5292761cea97550bd1f29527cc5ab8f60bb4b50c763879fb89a1a1aa5d2b115ad595762fe4c597d2fb0ad134506a3b2efeb0106c0d39bbd90c85543494cd8a72875ce519f68c7b6a73157793e02aea480e1c81558633e96db1aa5face6a4b4add0e5d50449966da6044eaca5d958951f135cc400007112bb9d171e329587c8d7d1887f87d22cf30e9e176bfebe81fe0fb7e38ada90222848011aa3ac1ee43e0a759bb3be1871c2d89c359f008376a9e3006492595e70009daf9b3c332fff7515a5df80ede12cdd74339167e23e2be8cab5f31925d9cc39508f032f4ddcf84d34f12f6bedf2bc2ac69d970811b58f066bde184c4a1bc424d010aa77476ad581348443dac4dc49d1e2b7af113f2c25af0887e533ed23ec41055e81b9c22ca3878feabc8cde6e9552566314b0ab9c1e591681c7128b5f97ab43227000bc1a4d3e3b1b25ab7dfdadd5980d0561cf619496d3b4038addb25b20a865d34417e36317bd534935944d97bc9491d6c245283eaad9a3a3b8c873894543ccfb8bb010dc51fd70173b6f910f4a7a8b7efc32b660b0483bccd72e05b7a50894d30aace5d279bcfb7e39abe90e4c6cb1b5090f4f4d1d06e34100bf05fe815b801729ae80a010ed1727b55351f5c984debb4c52d4c6ade44d9013f22593859a3b418782e69052042a7066068d8901c336a96088c25f46e49fc59daa542a68757be33a8def94a42010ff9eca078bf934cd34d1871c54222cd1a4047a880192d1f527e0728ad484b49d15b11008bb295cae1f1d7f15dde2bba6da6bbfd9e7a49865d04d4eb73662b0eee00663515e400000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033d77ff014155575600000000000847760300002710fde52dfe2687ac0a3a5a999460140e4162a68097010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d2210000000052ce3fe400000000000d5454fffffff800000000663515e400000000663515e30000000053073d6800000000000ea9250a2bcd2592828ff1de794d9d7cd9016490e5a9b1a13702b2495c153bd51aa97119d1d2b756510fc66bd40c096879da906f337469917b4a07ec61bfa896b9a1a5cbae4681b4939017295a0d90d8962b20c90c1ed1317fedf741a94b73ce8f6af289a82b1b2515ae8714265af8d33bedc815dbaa13d2cd3f35132e7b4c39591f4845bdc08ff395196e09b8cb77775a989d9d04193388ff2104e96a13d91b39f7ba4d946439a9f7c553bbcaf5cc1946534e4d892d381aceb50cd9bed54d03e3e4f4c665c810722acc1290'

// Publish Time: 1714755054
const ETH_VAA_FULFILL =
  '0x504e41550100000003b801000000040d02318f2b0babdc66a17b228b71a2099e5348094ef722aacfcb5ff4d15d1991498e0b56688b8e62ce7c6ae584cdc07c54b4d517b9412660e74a232734af7a67a5990003a70bb5dbd20af6f13612259853f78285fddb9224b54bf2a23ee55884d34fb6e748195b5a1327bae2ec6ce567882efee548ef9eac93841b2296caf549f419b9870004c7e99bd5a3a318acaa5232314330a5a5c8730471a937f6ccf72dde53df111f9823962027bbbb7106a8f7ec5fcd7f659dd6e9623dbad8b2eac96db1725207bc6a000610a692fdbf722c86087a974524fad6ca08d4f72d30d042933585f052182199211d21d5d36aed95b08aa1c4efafa8317c3bfe844e62fd4df82fd4bb09485bf64c01072ebcc17d87bcf68e40ab68f107173f34087c052ee5a3a55ff1dd592ad1d9e1dc69ef17c0c530327fa6168106e822c69320302424d4d6e65048cec3e7cd1e0d780009baad049e4ddc22c56c20a18a9df7c6ae26aea27e7b5f8baac48fa8dedc777ea679e58254f5b4d76bdf1e754b11d5f5c6c48a05af1649d8d9c41fbfdb60fc2ece000a3f3258330c5e7124c08eb42895300d13ee6bcd54b8b4dd4a72af1ca4520dcd613799dc95a7fa179018961b2ddd7b86a0df03d5ad43269e8470fca85aa60ddef7000b32057ebe2722ef2d886b3aac81bafe09faebe2a8c8d082043477230cc4e48c4b5dd5d2eb2c9269d19d92d924190227bb0e6d2a52e31884b308bea4ba32c4170c010cca39459df1df05006901ed89674bf898597143c13a5fb51e41f555c201416ade6aa944d8e766e13e25c6d6bd6ed0a8f3df4d2541584947a88930380c8722f79d010dab65117caac79e50fee126f5ebf837c8d5636093a9af8761adcebfc1e08f3b2712213ee9cfa5fbd32d54bbd7cbdc7c76b8c9bd9df566bbcf7f71ba7e971debd9010eeae63f70d4dffb0c90935f6eb09f107497d3f516f372bed17f8b7ca8726bb03f3ba0f385698db04d847693e2b628cc23d6590b2744c4f7db9b99ba05b8573ac1000fcb0013cc2623e420539331d8c7603d3302f50c98c286642c44020f0f88d2d9a222deb80956d31dea959b9ea1293acdf36fd3f2bb85f37a548b1013fb5cc90a5f01128a9cbb6adbb53f335b261b91d9ff61d84052b33f97c11cee5e92326335fc64a0210f6d83aa0d8eb2df9f2b62e01b29ff214a83f7aeff0fec7cba4a7495e4a54701663515ee00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033d7815014155575600000000000847761900002710a77749cd58b7c470d94026a4a7e90b9e44ca5bd901005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000004772c99f14000000000f07b431fffffff800000000663515ee00000000663515ed0000004780fe0890000000000c83b1290a7618370a94bdfc6a0dea28b59ba9c126d7aed89e513e1942be1c7713d33f93bb3d025bb4da4b0cf9488d8e71fe70e7df3babd199bf66e47a31e0479d9fe9fa7b4466817b85a313552f50ecf146a68a8c0606c90daede37d14ef47c223a677907d5a3f0ee4d2eedf1cf0738f909001c95247dc673a068f930086fd5b76fe4406d56728e6b4156c7289c287e861966ee9fda1448abc786e121ba5f28aea4e3813e5115ca9dd2377220d6ec218f3845341a337904bdc7fc79260280d74438303ab5ae0d9c764bce17a4'

const BTC_VAA_FULFILL =
  '0x504e41550100000003b801000000040d02318f2b0babdc66a17b228b71a2099e5348094ef722aacfcb5ff4d15d1991498e0b56688b8e62ce7c6ae584cdc07c54b4d517b9412660e74a232734af7a67a5990003a70bb5dbd20af6f13612259853f78285fddb9224b54bf2a23ee55884d34fb6e748195b5a1327bae2ec6ce567882efee548ef9eac93841b2296caf549f419b9870004c7e99bd5a3a318acaa5232314330a5a5c8730471a937f6ccf72dde53df111f9823962027bbbb7106a8f7ec5fcd7f659dd6e9623dbad8b2eac96db1725207bc6a000610a692fdbf722c86087a974524fad6ca08d4f72d30d042933585f052182199211d21d5d36aed95b08aa1c4efafa8317c3bfe844e62fd4df82fd4bb09485bf64c01072ebcc17d87bcf68e40ab68f107173f34087c052ee5a3a55ff1dd592ad1d9e1dc69ef17c0c530327fa6168106e822c69320302424d4d6e65048cec3e7cd1e0d780009baad049e4ddc22c56c20a18a9df7c6ae26aea27e7b5f8baac48fa8dedc777ea679e58254f5b4d76bdf1e754b11d5f5c6c48a05af1649d8d9c41fbfdb60fc2ece000a3f3258330c5e7124c08eb42895300d13ee6bcd54b8b4dd4a72af1ca4520dcd613799dc95a7fa179018961b2ddd7b86a0df03d5ad43269e8470fca85aa60ddef7000b32057ebe2722ef2d886b3aac81bafe09faebe2a8c8d082043477230cc4e48c4b5dd5d2eb2c9269d19d92d924190227bb0e6d2a52e31884b308bea4ba32c4170c010cca39459df1df05006901ed89674bf898597143c13a5fb51e41f555c201416ade6aa944d8e766e13e25c6d6bd6ed0a8f3df4d2541584947a88930380c8722f79d010dab65117caac79e50fee126f5ebf837c8d5636093a9af8761adcebfc1e08f3b2712213ee9cfa5fbd32d54bbd7cbdc7c76b8c9bd9df566bbcf7f71ba7e971debd9010eeae63f70d4dffb0c90935f6eb09f107497d3f516f372bed17f8b7ca8726bb03f3ba0f385698db04d847693e2b628cc23d6590b2744c4f7db9b99ba05b8573ac1000fcb0013cc2623e420539331d8c7603d3302f50c98c286642c44020f0f88d2d9a222deb80956d31dea959b9ea1293acdf36fd3f2bb85f37a548b1013fb5cc90a5f01128a9cbb6adbb53f335b261b91d9ff61d84052b33f97c11cee5e92326335fc64a0210f6d83aa0d8eb2df9f2b62e01b29ff214a83f7aeff0fec7cba4a7495e4a54701663515ee00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033d7815014155575600000000000847761900002710a77749cd58b7c470d94026a4a7e90b9e44ca5bd901005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b430000059d19d3523c00000000aff3e741fffffff800000000663515ee00000000663515ed0000059c193c018000000000c70f6f3c0ae480583d1d0dbeb65d09f626b4210aad9381c73737552c704fcebf2e1ab7e4643036a09681600ddc6c8c030312915bc98c1b7f446b5bf84666a16de12140f0ac85f6d241a478299082af8715ea161a6da3cd5c98c5c35bb1ee4ea3b9ba8cd8daec1b6f3d32419fcc58aea79c5a5c7a498cd4027beb41df85086fd5b76fe4406d56728e6b4156c7289c287e861966ee9fda1448abc786e121ba5f28aea4e3813e5115ca9dd2377220d6ec218f3845341a337904bdc7fc79260280d74438303ab5ae0d9c764bce17a4'

const LINK_VAA_FULFILL =
  '0x504e41550100000003b801000000040d02318f2b0babdc66a17b228b71a2099e5348094ef722aacfcb5ff4d15d1991498e0b56688b8e62ce7c6ae584cdc07c54b4d517b9412660e74a232734af7a67a5990003a70bb5dbd20af6f13612259853f78285fddb9224b54bf2a23ee55884d34fb6e748195b5a1327bae2ec6ce567882efee548ef9eac93841b2296caf549f419b9870004c7e99bd5a3a318acaa5232314330a5a5c8730471a937f6ccf72dde53df111f9823962027bbbb7106a8f7ec5fcd7f659dd6e9623dbad8b2eac96db1725207bc6a000610a692fdbf722c86087a974524fad6ca08d4f72d30d042933585f052182199211d21d5d36aed95b08aa1c4efafa8317c3bfe844e62fd4df82fd4bb09485bf64c01072ebcc17d87bcf68e40ab68f107173f34087c052ee5a3a55ff1dd592ad1d9e1dc69ef17c0c530327fa6168106e822c69320302424d4d6e65048cec3e7cd1e0d780009baad049e4ddc22c56c20a18a9df7c6ae26aea27e7b5f8baac48fa8dedc777ea679e58254f5b4d76bdf1e754b11d5f5c6c48a05af1649d8d9c41fbfdb60fc2ece000a3f3258330c5e7124c08eb42895300d13ee6bcd54b8b4dd4a72af1ca4520dcd613799dc95a7fa179018961b2ddd7b86a0df03d5ad43269e8470fca85aa60ddef7000b32057ebe2722ef2d886b3aac81bafe09faebe2a8c8d082043477230cc4e48c4b5dd5d2eb2c9269d19d92d924190227bb0e6d2a52e31884b308bea4ba32c4170c010cca39459df1df05006901ed89674bf898597143c13a5fb51e41f555c201416ade6aa944d8e766e13e25c6d6bd6ed0a8f3df4d2541584947a88930380c8722f79d010dab65117caac79e50fee126f5ebf837c8d5636093a9af8761adcebfc1e08f3b2712213ee9cfa5fbd32d54bbd7cbdc7c76b8c9bd9df566bbcf7f71ba7e971debd9010eeae63f70d4dffb0c90935f6eb09f107497d3f516f372bed17f8b7ca8726bb03f3ba0f385698db04d847693e2b628cc23d6590b2744c4f7db9b99ba05b8573ac1000fcb0013cc2623e420539331d8c7603d3302f50c98c286642c44020f0f88d2d9a222deb80956d31dea959b9ea1293acdf36fd3f2bb85f37a548b1013fb5cc90a5f01128a9cbb6adbb53f335b261b91d9ff61d84052b33f97c11cee5e92326335fc64a0210f6d83aa0d8eb2df9f2b62e01b29ff214a83f7aeff0fec7cba4a7495e4a54701663515ee00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000033d7815014155575600000000000847761900002710a77749cd58b7c470d94026a4a7e90b9e44ca5bd9010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d2210000000052cf6d4b00000000000ed1e8fffffff800000000663515ee00000000663515ed000000005307168a00000000000ea8c70afec8ef595721f90fec9ff1bd57f5be7bed1eb621f1237f0ad4af4f0965e5348bdd20d33f58e6ea445a595fce1d9cb79b23dc5839efe1dfeae8dc593dd71ed6c4a4f1532b4c9beba299681cf15b5a8fa8c912b42e4bc3f53a12e30267d77353e81ac20fd4c020944677c7624835a23de51362b4305f2c3dac69a37cc5776943bc93ca4736e923f97484c736c2b4a2a13ebba9e82f1381a69790a70e51b5e0a1a95115ca9dd2377220d6ec218f3845341a337904bdc7fc79260280d74438303ab5ae0d9c764bce17a4'
