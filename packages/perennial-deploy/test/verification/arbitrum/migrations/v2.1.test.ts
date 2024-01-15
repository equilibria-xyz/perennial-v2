import HRE from 'hardhat'
import { expect } from 'chai'
import { impersonateWithBalance } from '../../../../../common/testutil/impersonate'
import { increase, increaseTo, reset } from '../../../../../common/testutil/time'
import { ArbGasInfo, IERC20, MarketFactory, OracleFactory, ProxyAdmin, PythFactory } from '../../../../types/generated'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { smock } from '@defi-wonderland/smock'

const RunMigrationDeployScript = false

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

  beforeEach(async () => {
    await reset()

    DSU = await ethers.getContractAt('IERC20', (await get('DSU')).address)
    USDC = await ethers.getContractAt('IERC20', (await get('USDC')).address)

    if (RunMigrationDeployScript) {
      // Deploy migration
      await fixture('v2_1_Migration', { keepExistingDeployments: true })
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
  })
})

// Publish Time: 1704922300
const ETH_VAA_UPDATE =
  '0x504e41550100000003b801000000030d012407c04be8061a9ab6190ee9ce5249ef99ea8eb5fa2fffc36be1581ba89d22124cb7eab12b3ab9ac02b262bda987200f586d70da317abc05cebae6e7f23a17cf0002ca392b2b543f0703717f1761659e7699ce3fc5a1dc18112f7756c5f9af5f063159d459e24621b2817e27f854128f287844cfd6f65f851aa7dec8fd8c275ce087010324f2197ba69d6331c7196e3f57108c6ca3d9841a80b83db85163abb61ee4d4392ab291f67ac9e14c40528ffa719fbd3c783663a940700ca1a62bb6b7ee060ca30004f1f6eb66281e16629f7cfd4a1439d54787d04305e0aec8670f2e7fa3b6cd49962f8b65d3290b64967136a831f40950846985f4bf24a4fd84ab7c6a266ff60a320006874eb6442d9df5ebc820c0236a532c06a8647595e872db40a3d7a49eb136ab880173bf05a0f8f9996ebcda4ba5d4b912ae92f3923e22669254e855cadef172520107d82d5d03f085dc35138589a6f207eda1310097201772952fe6915f798ed33ba0316978e81d87c5a87c00a881e85b52f2d725f91f92458c391b490cd7f4fe531a0108762fb96f665eb22c5d5b91a9f849a44a77cde17e968333d3e259731761b0e9ed36bb4177a507bfd9550b60c5941187f68751b2148dbf7799dbb2476ebe69387e000c12674cdb41a3be23483e7691cafcc0b547dbdfa5f786a88cecd8026276095d1f27ea565c48ed313d1f8e43ec207e2d3e7aa527f1971c127c392d43e0c7a5ead7000d1cf473655fea94b75d2c34aeac7b568914187106dc1d6da126269dca303c97a35e8fb8f73a0e8289f3c305ba6373be9b2c6a7923d0dc5a1954f92ec4e853da9f000e76462431f18adcb528d7298323bd3321803f1ce497ec71f563b5dd5dada7de9300cd29b4034a850a13f02766b26e024bf8a761acc3ad4e0f72c2084b04cbeff9000f0fcfa3762815c554e94cdf4080e417b89a601c982b0a27f8c29408346be1ca204eaa3f4b554c059d8feb99119637726857a5d93d88f7fbe8a9b4010074384c7a0010dd7eb052e571758b9111f1df1a713946c036a578fd86cbf33a955c2a142f57533714e8d4e8d380899c72a12005a2b8c59084efc722ba288d5f15614e9d39290b001253d1a000d44dd8c3c707d1523b13d3bf48546389c79852ceaaaf2e031acb43080a84b0b81191aefb9a7302b1f17a8ed737c94d104eda27926a0f89ecb53d38d00065a56d8c00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a755b014155575600000000000731ba6c0000271061e2bf4e728c4bbad7df337e16fcbbe50892382701005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003af0be90c9000000000a54f82efffffff80000000065a56d8c0000000065a56d8b0000003acbd2fba8000000000a867a250a142fb6bfa0a6d34b27570a40267255409fdd03ac694052bb501b2460f711f965bfa27dd35c5cdf96dbcbfbd4cd17d7175a6554bb5ff74a9868fedf1106ccb37c2965b1c1685da9eb63391ceb3266b215fe856739a7da0830c618b7a300d346786447f021fa51c424287aa622a30957327dd49c0a421b30a3440c2ca22ab4918e7150421e2e574c0e64d24cd7754c971d2fae9fc9d8a7a454cc063b5487a1ac8e0c88d3e484a427fe5137acd351dd7767f27918b00be96df3650254a5ce6979d0cfdf2c4df46072e7'

const BTC_VAA_UPDATE =
  '0x504e41550100000003b801000000030d02ca392b2b543f0703717f1761659e7699ce3fc5a1dc18112f7756c5f9af5f063159d459e24621b2817e27f854128f287844cfd6f65f851aa7dec8fd8c275ce087010324f2197ba69d6331c7196e3f57108c6ca3d9841a80b83db85163abb61ee4d4392ab291f67ac9e14c40528ffa719fbd3c783663a940700ca1a62bb6b7ee060ca30004f1f6eb66281e16629f7cfd4a1439d54787d04305e0aec8670f2e7fa3b6cd49962f8b65d3290b64967136a831f40950846985f4bf24a4fd84ab7c6a266ff60a320006874eb6442d9df5ebc820c0236a532c06a8647595e872db40a3d7a49eb136ab880173bf05a0f8f9996ebcda4ba5d4b912ae92f3923e22669254e855cadef172520107d82d5d03f085dc35138589a6f207eda1310097201772952fe6915f798ed33ba0316978e81d87c5a87c00a881e85b52f2d725f91f92458c391b490cd7f4fe531a0108762fb96f665eb22c5d5b91a9f849a44a77cde17e968333d3e259731761b0e9ed36bb4177a507bfd9550b60c5941187f68751b2148dbf7799dbb2476ebe69387e000aee5a47698917bd9a6ab3cdfddb733bfd3b46e4354eb68ccb667c32d86e02a68c01808830f5ef6efd3ccd1c7990d52cf70530299da9aeb6fd72d0c242d0e5a6ec000c12674cdb41a3be23483e7691cafcc0b547dbdfa5f786a88cecd8026276095d1f27ea565c48ed313d1f8e43ec207e2d3e7aa527f1971c127c392d43e0c7a5ead7000d1cf473655fea94b75d2c34aeac7b568914187106dc1d6da126269dca303c97a35e8fb8f73a0e8289f3c305ba6373be9b2c6a7923d0dc5a1954f92ec4e853da9f000e76462431f18adcb528d7298323bd3321803f1ce497ec71f563b5dd5dada7de9300cd29b4034a850a13f02766b26e024bf8a761acc3ad4e0f72c2084b04cbeff9000f0fcfa3762815c554e94cdf4080e417b89a601c982b0a27f8c29408346be1ca204eaa3f4b554c059d8feb99119637726857a5d93d88f7fbe8a9b4010074384c7a0010dd7eb052e571758b9111f1df1a713946c036a578fd86cbf33a955c2a142f57533714e8d4e8d380899c72a12005a2b8c59084efc722ba288d5f15614e9d39290b001253d1a000d44dd8c3c707d1523b13d3bf48546389c79852ceaaaf2e031acb43080a84b0b81191aefb9a7302b1f17a8ed737c94d104eda27926a0f89ecb53d38d00065a56d8c00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a755b014155575600000000000731ba6c0000271061e2bf4e728c4bbad7df337e16fcbbe50892382701005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43000003e1770f0d00000000008721e10ffffffff80000000065a56d8c0000000065a56d8b000003ddd689a28000000000a5684f5c0ad38a555c177f63f5881944cdcdc891da088be2c0f169109fa725946077d39640514d9f7285d1ef1a38f8aa44137822b563dd16e6c7aa3a9b892ada24d46d6b732aef83d95eed1cebf88468a93c3c5987f01c8c13c3e199e0dc4fc75d81b5afd8d7dfdf922c92c58872ed8dc000d1158d43ead942382308003f09539e1ee2f526fc02ad689a5ba10c7f600ffb1ac02d612cad4ee115222d1b2e2972618616c8ba0c88d3e484a427fe5137acd351dd7767f27918b00be96df3650254a5ce6979d0cfdf2c4df46072e7'

const LINK_VAA_UPDATE =
  '0x504e41550100000003b801000000030d02ca392b2b543f0703717f1761659e7699ce3fc5a1dc18112f7756c5f9af5f063159d459e24621b2817e27f854128f287844cfd6f65f851aa7dec8fd8c275ce087010324f2197ba69d6331c7196e3f57108c6ca3d9841a80b83db85163abb61ee4d4392ab291f67ac9e14c40528ffa719fbd3c783663a940700ca1a62bb6b7ee060ca30004f1f6eb66281e16629f7cfd4a1439d54787d04305e0aec8670f2e7fa3b6cd49962f8b65d3290b64967136a831f40950846985f4bf24a4fd84ab7c6a266ff60a320006874eb6442d9df5ebc820c0236a532c06a8647595e872db40a3d7a49eb136ab880173bf05a0f8f9996ebcda4ba5d4b912ae92f3923e22669254e855cadef172520107d82d5d03f085dc35138589a6f207eda1310097201772952fe6915f798ed33ba0316978e81d87c5a87c00a881e85b52f2d725f91f92458c391b490cd7f4fe531a0108762fb96f665eb22c5d5b91a9f849a44a77cde17e968333d3e259731761b0e9ed36bb4177a507bfd9550b60c5941187f68751b2148dbf7799dbb2476ebe69387e000aee5a47698917bd9a6ab3cdfddb733bfd3b46e4354eb68ccb667c32d86e02a68c01808830f5ef6efd3ccd1c7990d52cf70530299da9aeb6fd72d0c242d0e5a6ec000c12674cdb41a3be23483e7691cafcc0b547dbdfa5f786a88cecd8026276095d1f27ea565c48ed313d1f8e43ec207e2d3e7aa527f1971c127c392d43e0c7a5ead7000d1cf473655fea94b75d2c34aeac7b568914187106dc1d6da126269dca303c97a35e8fb8f73a0e8289f3c305ba6373be9b2c6a7923d0dc5a1954f92ec4e853da9f000e76462431f18adcb528d7298323bd3321803f1ce497ec71f563b5dd5dada7de9300cd29b4034a850a13f02766b26e024bf8a761acc3ad4e0f72c2084b04cbeff9000f0fcfa3762815c554e94cdf4080e417b89a601c982b0a27f8c29408346be1ca204eaa3f4b554c059d8feb99119637726857a5d93d88f7fbe8a9b4010074384c7a0010dd7eb052e571758b9111f1df1a713946c036a578fd86cbf33a955c2a142f57533714e8d4e8d380899c72a12005a2b8c59084efc722ba288d5f15614e9d39290b001253d1a000d44dd8c3c707d1523b13d3bf48546389c79852ceaaaf2e031acb43080a84b0b81191aefb9a7302b1f17a8ed737c94d104eda27926a0f89ecb53d38d00065a56d8c00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a755b014155575600000000000731ba6c0000271061e2bf4e728c4bbad7df337e16fcbbe508923827010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221000000005c48ac74000000000010f98afffffff80000000065a56d8c0000000065a56d8b000000005c19e36a000000000013db370adbd977b92fae10a07f2da30beee60f384cf082ce269f57a57193e4a049e494356c02170c494760c8391010b27432ef38f789ebcc46daa5b7b61c7fa3969c6816a652912309b41ecb563e6222c29295e8d972de1299d74d2bae33c165bad0687fed0346e7ecff0e9be437b2ad851d6681a789240ad56614b2ca5624df712544b6621ce111769a56cf5ad43747f77934c77fd408c37bac30a61d775f92bbc2222b8b80fadcbc272416b0de68231f3b90ab9b66ef190be96df3650254a5ce6979d0cfdf2c4df46072e7'

// Publish Time: 1705340314
const ETH_VAA_FULFILL =
  '0x504e41550100000003b801000000030d029233926abe8b47091a8732d99bccb39c8a1f582599d5b86c9b2e29a9f4af8f845d0c89560bd74509feeeb7889442b0615bd1a59020b83f8ff891ed8493715be40003bd3877d2c1e3dbfeeaa63f0243c795a8f30151e30df7d1c3ca17b6a4f22eaa417bc22469c45206e7b0db4a08de4449e37664aa42351f7547bf877ad58a44501e0004e8cc244b4213569b869e99d508c15092d67fd4494934bd03b1d3684ca8ed32535e8f8b6491a5a67e05f84c83c1c776517e1eea7fe5109041ce01dca5826c5d87010622db91443417ca1b129c44fde4c299248cd0a0e1cd5796f55d1538751bc4cb727ee0df1f413cae6b17543e32af455854f42441078816797fbdcf859554c5f83100075c4d8983cfcd487a1182b7896e769e86fc43ee7e1a70a75feba18bcee0f14d1a4a9535599bb025f5f885a639001a53551a6fa47b4769d7ebf5870d26652d9c8d0108899b4573428b0b850fce1d0caaeb5114236ef00b3a04ecae8ced81af335f38b02499ed57069699f289bd13a8e9519bff18da813f75f9ed7f63b128af90c5a569000b5a65799208e818b7360a3044cd875da3d08539915464056d6c7243ff7522c4347d6bafd16f80a8550a1ccf3683f8a344e20e5351bbd03dd3b5b684dd717eda6f010c652ab290b56da6ebd3d508150d3ee6cdf7828c19ca2bd683089ceb6cdda70c250cc34318a2eff108ed4ec581799fad56606270a7bb739276dc2b279aef1ea6f8000d568b5d05bc68600430fb5b9baf29e5573422f0a77b7af203fffb5d1affa6a5887bb546b6461ae3bf4b33a2a33e9f1960e74446b844b20eb2afdd8bc6421640ae000ec27285d82efc3659ebd07bcd88e896431d687802bc20efb465bab2aaeb602b6f72d8af67191a08371d6b7f2f1ac8b9181a4082020dd722215398b3685336956b000f04527970e23f4e97e8ba8f13c4bd2b4efa96549af92bfb4200e02d72b9a7cc7b3045160e4bdf117ba506535aa12c1a2b2b8d4027d1e113ab55279f1cee9df04f001052df944588b88196cae15fd36561f33fab5f69fd78488153e75f2f6e58dbd8a772687d9fd96201e6b65e54422213e6b64e3b1cb432c597238b0ca75991e702c501124614b2615cbfb647780c2af3ccccc8bee38005a0782929bfa1aa272c8387d9520a58fa6df0107762e4bc06bb3dbc1976b5b1b905f827dfc9e7623ad298ff34e90165a56d9a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a7573014155575600000000000731ba8400002710500569ca8f8eb579f76faf1c424901b9fbe7102101005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000003ae90ce0030000000008ca165dfffffff80000000065a56d9a0000000065a56d990000003acbefc6c0000000000a85dec60a10138ab3d2671462714ce1d9f7fb12549d52446b48f96a938f8699a56be7fb9f9a6ce552a014eed88ac01bc9ace8518516b66f6b0534a4ba61163b709d1dd5b9d7de9b01325fec1e5ca08a987c15effe452d9898957fc965fff9544194fa6953bbf53dc6c1e5dea855d2a632b37b723e0c99202f53f31c3297a86c5f02178383f7b9b4e7073b4293fe1ebbf8ac1bda3d8ec771e545ada346ae3290d3a6adf31d5f3b2da5df74233573338348a4e507654520c155deccd90d81ba88894a39f23e935eae758f77ddb3'

const BTC_VAA_FULFILL =
  '0x504e41550100000003b801000000030d029233926abe8b47091a8732d99bccb39c8a1f582599d5b86c9b2e29a9f4af8f845d0c89560bd74509feeeb7889442b0615bd1a59020b83f8ff891ed8493715be40003bd3877d2c1e3dbfeeaa63f0243c795a8f30151e30df7d1c3ca17b6a4f22eaa417bc22469c45206e7b0db4a08de4449e37664aa42351f7547bf877ad58a44501e0004e8cc244b4213569b869e99d508c15092d67fd4494934bd03b1d3684ca8ed32535e8f8b6491a5a67e05f84c83c1c776517e1eea7fe5109041ce01dca5826c5d87010622db91443417ca1b129c44fde4c299248cd0a0e1cd5796f55d1538751bc4cb727ee0df1f413cae6b17543e32af455854f42441078816797fbdcf859554c5f83100075c4d8983cfcd487a1182b7896e769e86fc43ee7e1a70a75feba18bcee0f14d1a4a9535599bb025f5f885a639001a53551a6fa47b4769d7ebf5870d26652d9c8d0108899b4573428b0b850fce1d0caaeb5114236ef00b3a04ecae8ced81af335f38b02499ed57069699f289bd13a8e9519bff18da813f75f9ed7f63b128af90c5a569000b5a65799208e818b7360a3044cd875da3d08539915464056d6c7243ff7522c4347d6bafd16f80a8550a1ccf3683f8a344e20e5351bbd03dd3b5b684dd717eda6f010c652ab290b56da6ebd3d508150d3ee6cdf7828c19ca2bd683089ceb6cdda70c250cc34318a2eff108ed4ec581799fad56606270a7bb739276dc2b279aef1ea6f8000d568b5d05bc68600430fb5b9baf29e5573422f0a77b7af203fffb5d1affa6a5887bb546b6461ae3bf4b33a2a33e9f1960e74446b844b20eb2afdd8bc6421640ae000ec27285d82efc3659ebd07bcd88e896431d687802bc20efb465bab2aaeb602b6f72d8af67191a08371d6b7f2f1ac8b9181a4082020dd722215398b3685336956b000f04527970e23f4e97e8ba8f13c4bd2b4efa96549af92bfb4200e02d72b9a7cc7b3045160e4bdf117ba506535aa12c1a2b2b8d4027d1e113ab55279f1cee9df04f001052df944588b88196cae15fd36561f33fab5f69fd78488153e75f2f6e58dbd8a772687d9fd96201e6b65e54422213e6b64e3b1cb432c597238b0ca75991e702c501124614b2615cbfb647780c2af3ccccc8bee38005a0782929bfa1aa272c8387d9520a58fa6df0107762e4bc06bb3dbc1976b5b1b905f827dfc9e7623ad298ff34e90165a56d9a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a7573014155575600000000000731ba8400002710500569ca8f8eb579f76faf1c424901b9fbe7102101005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43000003e0e460151d00000000a9d70267fffffff80000000065a56d9a0000000065a56d99000003ddd94910a000000000a55db22c0ad762f4bd496a46f54831d3eb57099ec06e7ff2c2cc69f033dc644bcddc0a311e21292c8fa0ae073caafcf460222ee1fb18cf41b96452ca3be4e155f0f594160920e99b50baaf946164f42afcc0e97a1b1981a02a9f0882f0f0fd3a7352bc119379dbc677f93a5b7a4bc573941f7d8da13bce06233f3fbdc094a3664e549c7b0fa004cffe3a1138797428d6d56d815b108928129cfedb46e808314e41558c10e65f3b2da5df74233573338348a4e507654520c155deccd90d81ba88894a39f23e935eae758f77ddb3'

const LINK_VAA_FULFILL =
  '0x504e41550100000003b801000000030d029233926abe8b47091a8732d99bccb39c8a1f582599d5b86c9b2e29a9f4af8f845d0c89560bd74509feeeb7889442b0615bd1a59020b83f8ff891ed8493715be40003bd3877d2c1e3dbfeeaa63f0243c795a8f30151e30df7d1c3ca17b6a4f22eaa417bc22469c45206e7b0db4a08de4449e37664aa42351f7547bf877ad58a44501e0004e8cc244b4213569b869e99d508c15092d67fd4494934bd03b1d3684ca8ed32535e8f8b6491a5a67e05f84c83c1c776517e1eea7fe5109041ce01dca5826c5d87010622db91443417ca1b129c44fde4c299248cd0a0e1cd5796f55d1538751bc4cb727ee0df1f413cae6b17543e32af455854f42441078816797fbdcf859554c5f83100075c4d8983cfcd487a1182b7896e769e86fc43ee7e1a70a75feba18bcee0f14d1a4a9535599bb025f5f885a639001a53551a6fa47b4769d7ebf5870d26652d9c8d0108899b4573428b0b850fce1d0caaeb5114236ef00b3a04ecae8ced81af335f38b02499ed57069699f289bd13a8e9519bff18da813f75f9ed7f63b128af90c5a569000b5a65799208e818b7360a3044cd875da3d08539915464056d6c7243ff7522c4347d6bafd16f80a8550a1ccf3683f8a344e20e5351bbd03dd3b5b684dd717eda6f010c652ab290b56da6ebd3d508150d3ee6cdf7828c19ca2bd683089ceb6cdda70c250cc34318a2eff108ed4ec581799fad56606270a7bb739276dc2b279aef1ea6f8000d568b5d05bc68600430fb5b9baf29e5573422f0a77b7af203fffb5d1affa6a5887bb546b6461ae3bf4b33a2a33e9f1960e74446b844b20eb2afdd8bc6421640ae000ec27285d82efc3659ebd07bcd88e896431d687802bc20efb465bab2aaeb602b6f72d8af67191a08371d6b7f2f1ac8b9181a4082020dd722215398b3685336956b000f04527970e23f4e97e8ba8f13c4bd2b4efa96549af92bfb4200e02d72b9a7cc7b3045160e4bdf117ba506535aa12c1a2b2b8d4027d1e113ab55279f1cee9df04f001052df944588b88196cae15fd36561f33fab5f69fd78488153e75f2f6e58dbd8a772687d9fd96201e6b65e54422213e6b64e3b1cb432c597238b0ca75991e702c501124614b2615cbfb647780c2af3ccccc8bee38005a0782929bfa1aa272c8387d9520a58fa6df0107762e4bc06bb3dbc1976b5b1b905f827dfc9e7623ad298ff34e90165a56d9a00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000022a7573014155575600000000000731ba8400002710500569ca8f8eb579f76faf1c424901b9fbe71021010055008ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221000000005c3e80800000000000137f73fffffff80000000065a56d9a0000000065a56d99000000005c1a0804000000000013d9ca0a72b1dfc9d3ff354cae4e5bd2f7d046ee0c234efe39cfaf353320ddb6d77858275cf8952ba7a1cefab48927d334d00931cb516a5d56c1933dd04af2e2c7e1c1d029646313a29863d4c9220ee5704692708224e28f86c61902d67d910dc7ce3d8b338f3819163951d20ac9ff018f038890f62a0e8cbda945fd4c4848450a3a5f2fa3c6bd4a3f3cd94229f5fbbd2ac1adb0bd5932eb1acf493cdbedb19fdaf50bf5ea0a6f16cbfa43c1d048c68b6f0d6281b62ac682deccd90d81ba88894a39f23e935eae758f77ddb3'
