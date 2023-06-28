import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { utils } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { IERC20Metadata, IERC20Metadata__factory, PythOracle, PythOracle__factory } from '../../../types/generated'

const { config, ethers } = HRE

const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'

const STARTING_TIME = 1686198973

// This VAA has timestamp 1686198987 (STARTING_TIME + 14)
const VAA =
  '0x01000000030d0046d9570837d4d2cfcc50fd3346bf18df10179011a1e125e27467bb47bc26f8ce194ed59b48793f4dec9dc919f2e22d43e33fe6ac263980da08f502b894e0fe6f00026a8d75df8f46b144e48ebf6bd6a63267e90dafe353021bbecb9909b0bef0434e56f696870e41ce16b9b8b40c22548815c5fe157915cd08366cb439c5eb51029001040c1775df612c74d4e18da4daa0f42b8953d92340aadf757b6b6ee1e549d1ddfe0115628a360168a23a05684afa5389dd75c431eb5228aaa528de450aae38a50f01084aeacdb58103612ab202ac887d53dc14cd10c4e7d788f95685e0944fb919f8ec64b5cdaa4ede600a9f89ed9aaa3be86facac6ede2ed08760101f6c5c23ce6b29010a2847bd95a0dd2d14302ee732f8f3547ea7e1bfcc9f258ab07d33ca9c62fc837621e8a7dcdb41b06db6f8e768e7e5510f3954029fcdf6e8f3d6b4072da73b51ae010b3a693388722a579f8e7ce44bceb0fac79a4dffbd1076b99a79c55286cc2cf28f2feda95aaf1823f6da2922d9f675619931107bd0538e9dbd53025463a95f2b7b010c732680bb2ba4843b67ba4c493d29cbfe737729cb872aec4ac9b8d83eb0fec898556d02bdeae8995870dc6e75187feacc9b9f714ddd9d97ba5a5abbe07d8884f2010debe8a41fe1715b27fbf2aba19e9564bb4e0bde1fc29412c69347950d216a201130e301f43a5aeec8e7464c9839a114e22efe65d49128b4908b9fa618476cc519010e33495ea1a8df32bc3e7e6f353a4d0371e8d5538e33e354e56784e2877f3765ef5e774abb0c50973686f8236adf5979225ff6f6c68ed942197f40c4fed59331bc010fead2505d4be9161ab5a8da9ed0718afd1ddf0b7905db57997a1ed4741d9d326840e193b84e115eba6256ed910e12e10f68c4563b6abaae211eaac5c0416d1f9601108eddcab6c9952dc0da91900a35821ef75818a5f3898721fd05ff708597c19d5e573f2b63674989365ca9fee0dd660566afaec135230d978e66ee4106c263b124011164788fde3bcf11e6773308a3732a0f0bd73b6876789c2b01f2bbaf84473be6ec2b7a3884d117adc625cbf48710c238d9c122a5f64f283685d9c66f3656d79d4d001247f246ba17092100f8bfc1e93822ad3d07561697ac90d4ebf3d371fce17e399246b18f85b52f74157240cdf16da4bde72146cf0cb976c39a2d6958d7b55773f70064815acc00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8413740150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3fa23ae00000000117b5092fffffff80000002a9cdd1528000000000f4ab712010000000a0000000c0000000064815acc0000000064815acb0000000064815acb0000002aa3fa23ae00000000117b50920000000064815acbe6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c5ffd594000000000086bfba4fffffff80000002c55aaa600000000000a73c7010100000007000000080000000064815acc0000000064815acb0000000064815acb0000002c5ffd594000000000086bfba40000000064815acbc67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002acc544cc90000000006747a77fffffff80000002ac4a4eba8000000000456d9f30100000017000000200000000064815acc0000000064815acb0000000064815acb0000002acc544cc90000000006747a770000000064815acb8d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac880a3200000000010e67139fffffff80000002abc130ec0000000001b3bcc6401000000090000000a0000000064815acc0000000064815acb0000000064815acb0000002ac880a3200000000010e671390000000064815acb543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815acc0000000064815aca0000000000000000000000000000000000000000000000000000000000000000'

// This VAA has timestamp 1686198989 (STARTING_TIME + 16)
const OTHER_VAA =
  '0x01000000030d00a87bb4f45a7ba5924b7f528f1563dcc3be57a88e75b77ea58c5e492e768b71ce36fc3f0c5399afd2c53bd9b6ae02dee259b1d85d511d9ea1cee3a3ba8a2f9b1e010200369aebb31fcedfc625307802472f751fd030d1386e23d65a31ab6445fca14819fdc142b80a81e5d3d6977b888338a17e6e757d83062e03df2383b04d3693fe01041acc2688a58c12b4b7ace5796f763c9be31ad70e7bb6b98ccacd5c3ee188511634da6bcb92c5e3c99174d0c1f04c0b0fc9ff22d0a4ba721231f0fbf1439734710006fa15d2b248896c629b5ad8f5be1d367f3eda33f86fe5eaf239fcf5c924fa99eb65fa3a9ccb028ada60a14d83537c9760aa87845de8bf0274d56d4501da39099c000a881c1f94bed5fda4b492606be77b8a1d215b1cefa6a76553214015152828b504735e9cdff068c1c2f16a15c98da2f030f4806d95cda06676bde86a5b2322d402010bf01b66ee9fde5e18892de416b05b3aeaa2b9e7cf4b88a81ebe327881c9ae79a52c6bf6fa0a9a05e095f5b1eb1b2e0510b6654f328da598f059a5075e6da266ef000c66e366f97cb5b6479398c4a90ed3a084558a9b653ef263015a46b4628caa2f1c066173e63c99f1e72fc9fd2e8778580df72ebef36e7bab6ceda71927aa543ae8000d26b1ac6eddf58d4a206558b423b1f6b4c2aa79eef7c9a4a112aacd0f12f3f6f616782ef53f4c5128954835d7c9fa7e8f3a999c1bc4a206e44459bab2f4a97762000ee75540ac332dde0b2396608d8afd45475b25c9a38c19e4a761b601e7419ba049566b0b4a43add83a4873a955ed1a575944ed18cb84af53dde08c90a3e20cb741010f05e8754cdb035a819162f897bfd692652a8959ad9a276901dcde0547d6b45af33395695e8089fe727903b365d54c4db48f79b9c4832245e87f14cbf18daaa05a0010e43cfa7d5f358c054452fa1f769bb2e0b3aca50675af9a37b23bceb894b747020bc045c853bb11be810fc26a3198cd45bdb56f3103b6e4f63cb065118c641d840011adfddcc762849d28586c211cf696a22700a2e509dc8e66d3a83c3532d847967e16c42379ecb0705c85fcf4e98abea9288336366bd7076fab3e3a1a231e16262e0112822e96a61fe31459fd98e6718ac1bc776ee8f0eba68b8e6afbf334e582c692d808b768c91eb03f7329e1680f4224447e47b4da3f1eff401aa71eb6be927f18600164815ace00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8413a60150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3d3fd2d0000000011a17713fffffff80000002a9cde49c0000000000f4b14df010000000a0000000c0000000064815ace0000000064815ace0000000064815acd0000002aa3d3fd2d0000000011a177130000000064815acce6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c5ffd594000000000086bfba4fffffff80000002c55acc4f8000000000a7364600100000007000000080000000064815ace0000000064815acd0000000064815acd0000002c5ffd594000000000086bfba40000000064815acdc67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002acc918fe7000000000618b2d9fffffff80000002ac4a5d9f00000000004570ac20100000017000000200000000064815ace0000000064815acd0000000064815acd0000002acc7758c0000000000632ea000000000064815acd8d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac880a3200000000010e67139fffffff80000002abc15b288000000001b39428201000000090000000a0000000064815ace0000000064815acd0000000064815acd0000002ac880a3200000000010e671390000000064815acd543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815ace0000000064815ace0000000000000000000000000000000000000000000000000000000000000000'

// This VAA has timestamp 1686199046 (STARTING_TIME + 73)
const VAA_AFTER_EXPIRATION =
  '0x01000000030d00bfb661157be7ad89a7e9c0f814fd991111260a063da76b9d6feceb23805d293031cae0d90acedc6272261b2b342d8528026bc2c4ca2bee14d2a9c37f54f5ff430101182784762cbbb5b288b9bce0e4809130ff6d0c32e54a43b83ca3df9429fb5f1c6954520ee536def601e4ae2cc96904d6255fe3b0a2680b04002a6215f8b7d05f0102c5e5bb34bc0e0a29050d528add872a84fb0dedfd87a7b212751efad4db9fdb8a268d6d652edd42977b45efa4b113cf64ba2cd574f8421829bf488b70c7708e5401048525c3dbe7e9982e73b57d1fb25f844ca89d5b0b70081331b494a7539bafd4081d58ef70e60b45e1aba5abf2aabfcb8e6ed5f98f0500e9f2bdd49828b4998b72010640c2b4fe8b742460244bb8727e73be77cde68e138793f35b5e4a0ceb244b9b583f2676c1b62bc00757f310fc15d7f89ddabe0ff2cfcf069e6a88fa557fe0abee0109c73d8eb1b3dcafda9b63cb3567aaa6ed5d08f945143087ce08b010d98985f2e372405c189b13e34dc263bdbf2e65907703daaf0c7952f8282c5e6f173dc7ed93010a99d8e194e2b3e7541a3321d1f130ef43cfeca479d35450fe2fdfb830c983b6152c61aa15a625bd25159202b8819dd49ac772af9403a1839897fce2629513aa1c000b7d28b5197c734b97beaa120bfe60347ddfc0daa0201435ec157cab6fe3f606fd573dbd0adf70c087b65f7ac3c8a635248d0a2af594ddf3ca8efc22aa68472b9c010d6cb1d8e21dc3496c271217a6881a7c0e7889f4d1ce28bcf41a6239c8231b25d33e08aaf3101baedb6967deb7c3463575d3985c7df414180c6b9c1a432afabb25010eb63ac25e0e08b961c4fe09a40d151a9cdefcc6dcd0b9e515e39a51538d9d56002c31a034f0fa2c7074a0b49bd9664085fda7576b88fac9c4d9bfd4e78dcf04f7010f8ac4211c75d9b3b3dd6561ca78a6d0e5b48978999622550e2ee8c96349cbe1a15297d9821a636e7243035a8109c0e1e8837f685fd8a543551d861b8d206bcd7100118f9cebf15e664f2d61fcdfb513f73063c98631cea238441193f3c530978c762e2dbbb34cb506339acf0e307dba791163e423777f7a6630041fa194ec361b519a011226603dae57d5f0830366bc2de410bca394104448bcbd265786d1778906a20a71413e7789c1e023f0e9aa801c1c3ea88577c01484747030cc14e019f96b3b4b8c0064815b0600000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b84185b0150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3a2542c000000000cff29d4fffffff80000002a9cfc4970000000000f4fed45010000000a0000000c0000000064815b060000000064815b060000000064815b050000002aa0efd01e000000000f1906450000000064815b05e6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c59c2ce20000000000929ebaafffffff80000002c55dbcff0000000000a6b691c0100000007000000080000000064815b060000000064815b060000000064815b050000002c59c2ce20000000000929ebaa0000000064815b05c67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002ac7759bc000000000052b5730fffffff80000002ac4bd9810000000000459d2670100000017000000200000000064815b060000000064815b060000000064815b050000002ac7759bc00000000003a9eecc0000000064815b058d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac114eb000000000011e1b38ffffffff80000002abc59e390000000001aefec2201000000090000000a0000000064815b060000000064815b050000000064815b050000002ac114eb000000000011e1b38f0000000064815b05543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815b060000000064815b020000000000000000000000000000000000000000000000000000000000000000'

describe('PythOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let oracle: PythOracle
  let dsu: IERC20Metadata

  beforeEach(async () => {
    await time.reset(config)
    ;[owner, user] = await ethers.getSigners()
    oracle = await new PythOracle__factory(owner).deploy(
      PYTH_ADDRESS,
      '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // Chainlink ETH/USD price feed
      '0x605D26FBd5be761089281d5cec2Ce86eeA667109', // DSU
    )
    await oracle.connect(owner).initialize(
      '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // Pyth ETH/USD priceId
    )
    dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    const dsuHolder = await impersonateWithBalance('0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd', utils.parseEther('10'))
    await dsu.connect(dsuHolder).transfer(oracle.address, utils.parseEther('100000'))
    await time.increaseTo(STARTING_TIME - 1)
    // block.timestamp of the next call will be STARTING_TIME (1686198973)
  })

  describe('#initialize', async () => {
    it('only initializes with a valid priceId', async () => {
      const invalidPriceId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0acd'
      const oracle = await new PythOracle__factory(owner).deploy(
        PYTH_ADDRESS,
        '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        '0x605D26FBd5be761089281d5cec2Ce86eeA667109',
      )
      await expect(oracle.initialize(invalidPriceId))
        .to.be.revertedWithCustomError(oracle, 'PythOracleInvalidPriceIdError')
        .withArgs(invalidPriceId)
    })
  })

  describe('#commit', async () => {
    it('commits successfully and incentivizes the keeper', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)

      // TODO: Test that this number is correct.
      expect(newDSUBalance.sub(originalDSUBalance)).to.be.greaterThan(0)
    })

    it('does not allow committing versions with out of order VAA publish times', async () => {
      await time.increase(1)
      await oracle.connect(user).sync()
      await oracle.connect(user).sync()

      await oracle.connect(user).commit(0, OTHER_VAA, {
        value: 1,
      })

      await expect(
        oracle.connect(user).commit(1, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleNonIncreasingPublishTimes')
    })

    it('fails to commit if update fee is not provided', async () => {
      await oracle.connect(user).sync()
      await expect(oracle.connect(user).commit(0, VAA)).to.revertedWithCustomError(
        oracle,
        'PythOracleInvalidMessageValueError',
      )
    })

    it('does not commit a version that has already been committed', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      await oracle.connect(user).sync()
      await expect(
        oracle.connect(user).commit(0, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleVersionIndexTooLowError')
    })

    it('cannot commit if no version has been requested', async () => {
      await expect(
        oracle.connect(user).commit(0, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleNoNewVersionToCommitError')
    })

    it('rejects invalid update data', async () => {
      await oracle.connect(user).sync()
      await expect(
        oracle.connect(user).commit(0, '0x00', {
          value: 1,
        }),
      ).to.reverted
    })

    it('does not skip a version if the grace period has not expired', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).sync()
      await expect(
        oracle.connect(user).commit(1, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleGracePeriodHasNotExpiredError')
    })

    it('does not skip a version if the update is valid for the previous version', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).sync()
      await time.increase(100)
      await expect(
        oracle.connect(user).commit(1, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleUpdateValidForPreviousVersionError')
    })

    it('skips a version if the grace period has expired', async () => {
      await oracle.connect(user).sync()
      await time.increase(59)
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(1, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('does not allow committing a version earlier than the latest committed version', async () => {
      await oracle.connect(user).sync()
      await time.increase(59)
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(1, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
      await oracle.connect(user).sync()
      await expect(
        oracle.connect(user).commit(0, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleVersionIndexTooLowError')
    })
  })

  describe('#commitNonRequested', async () => {
    it('can commit if there are no requested or committed versions, does not incentivize keeper', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
      await oracle.connect(user).commitNonRequested(STARTING_TIME, VAA, {
        value: 1,
      })
      const version = await oracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.true
      expect(version.price).to.equal('18381670317700000000000000')

      // Didn't incentivize keeper
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
      expect(newDSUBalance.sub(originalDSUBalance)).to.equal(0)
    })

    it('fails to commit if update fee is not provided', async () => {
      await expect(oracle.connect(user).commitNonRequested(STARTING_TIME, VAA)).to.revertedWithCustomError(
        oracle,
        'PythOracleInvalidMessageValueError',
      )
    })

    it('can commit if there are requested versions but no committed versions', async () => {
      await time.increase(30)
      await oracle.connect(user).sync()
      await oracle.connect(user).commitNonRequested(STARTING_TIME, VAA, {
        value: 1,
      })
    })

    it('can commit if there are committed versions but no requested versions', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      await oracle.connect(user).commitNonRequested(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('can commit if there are committed versions and requested versions', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      await time.increase(100)
      await oracle.connect(user).commitNonRequested(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('cannot commit invalid VAAs for the oracle version', async () => {
      await expect(
        oracle.connect(user).commitNonRequested(STARTING_TIME - 60, VAA, {
          value: 1,
        }),
      ).to.reverted
    })

    it('must be more recent than the most recently committed version', async () => {
      await time.increase(60)
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA_AFTER_EXPIRATION, {
        value: 1,
      })

      await expect(
        oracle.connect(user).commitNonRequested(STARTING_TIME, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleNonRequestedTooOldError')
    })

    it('must be before the next requested version to commit', async () => {
      await oracle.connect(user).sync()

      // Even though the oracle version is before the requested version, the VAA is not
      await expect(
        oracle.connect(user).commitNonRequested(STARTING_TIME, VAA, { value: 1 }),
      ).to.revertedWithCustomError(oracle, 'PythOracleNonRequestedTooRecentError')
    })

    it('can commit multiple non-requested versions, as long as they are in order', async () => {
      await oracle.connect(user).commitNonRequested(STARTING_TIME, VAA, {
        value: 1,
      })
      await oracle.connect(user).commitNonRequested(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('fails to commit non-requested version out of order', async () => {
      await oracle.connect(user).commitNonRequested(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })

      await expect(
        oracle.connect(user).commitNonRequested(STARTING_TIME, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(oracle, 'PythOracleNonRequestedOutOfOrderError')
    })
  })

  describe('#sync', async () => {
    it('returns the correct versions', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      const [latestVersion, currentVersion] = await oracle.connect(user).callStatic.sync()
      expect(latestVersion.valid).to.be.true
      expect(latestVersion.price).to.equal('18381670317700000000000000')
      expect(currentVersion).to.equal(await currentBlockTimestamp())
    })

    it('returns empty versions if no version has ever been committed', async () => {
      const syncResult = await oracle.connect(user).callStatic.sync()
      expect(syncResult.currentVersion).to.equal(0)
      const latestVersion = syncResult.latestVersion
      expect(latestVersion.timestamp).to.equal(0)
      expect(latestVersion.price).to.equal(0)
      expect(latestVersion.valid).to.be.false
    })
  })

  describe('#latest', async () => {
    it('returns the latest version', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      const latestVersion = await oracle.connect(user).latest()
      expect(latestVersion.valid).to.be.true
      expect(latestVersion.price).to.equal('18381670317700000000000000')
    })

    it('returns empty version if no version has ever been committed', async () => {
      const latestVersion = await oracle.connect(user).latest()
      expect(latestVersion.timestamp).to.equal(0)
      expect(latestVersion.price).to.equal(0)
      expect(latestVersion.valid).to.be.false
    })
  })

  describe('#current', async () => {
    it('returns the current version accepting new orders', async () => {
      expect(await oracle.connect(user).current()).to.equal(await currentBlockTimestamp())
    })
  })

  describe('#atVersion', async () => {
    it('returns the correct version', async () => {
      await oracle.connect(user).sync()
      await oracle.connect(user).commit(0, VAA, {
        value: 1,
      })
      const version = await oracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.true
      expect(version.price).to.equal('18381670317700000000000000')
    })

    it('returns invalid version if that version was not requested', async () => {
      const version = await oracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.false
    })

    it('returns invalid version if that version was requested but not committed', async () => {
      await oracle.connect(user).sync()
      const version = await oracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.false
    })
  })
})
