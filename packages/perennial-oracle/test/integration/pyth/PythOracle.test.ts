import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { utils } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
  PythFactory__factory,
  PythOracle,
  PythOracle__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { config, ethers } = HRE

const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_HOLDER = '0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd'

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

// This VAA has timestamp 1686199146 (STARTING_TIME + 173)
const VAA_WAY_AFTER_EXPIRATION =
  '0x01000000030d00759894dd446d5bbb720d73f32fea0c728cfecc474369fd46de94c1ee3d4f6a326eafdaa907c8b4c2fd027d7047af501103f513d9ed7cbde0a404516c7fa866c80001a2c0276919ba58edea3f3f395fbeaac7a8c3e0a8688f9e5d5c925396b503e90b4e652bd85e8672878a0960ff65515226651f12ad49721a0665f0bb2e5c28fb0c0102dde9e7d36aaef1a7528bed0f95f7d52d6ca33169afee85604669115454b90bbf36eb6de59decdcc4517cdb849efaef0626c83b318efbdf34b5373fd9e2a7c7f6000479d697d129cd515036eb19dfc17e08dd6628073204f5177042636682f9c268350abb39ee46dd119dd3dca48324f43bd72e8be84afa6ccde91c5d7d76ef7dd56e010ac6c6d3d4d7ed37747282478a628a7208e45aa609323ee54af0ab974755e3bdcc1e0fc45de741a3f629591a8f465e99de5b0670943bb1e74e7661d668fae491a5010b13f2c4cd06b86ad65495ab9b16b1ba8605a4a30207ab65a36a7e207f576983c50b3a06351c4acacac5d0b6c6491a575bc265ce4f58cd882fa2df4e1179730830000cfb174a0ce4426bff92f9b98387ec915f2f799ede09e75ccf916ddfa2e6b9da162fdc215ee99b02885468c23a36e66e2ce4265d222e0435cdc464239406021605010dc6e6437bd2395449d08890ee69b20451ae2b8b9ef33d5589c031d00164a824aa749dc420f1d7404441c79be128bf5cab830404b6efa2210d1a823a18479bf342000eeebc6b5b1ae0d9bec0b78e629b8548bcc37ec455bb99f6d2d312c37bbccc043716860daa6c998614ca9d67a3a6336b5da352d7dfd4b99a44034df0e4c8d90bd7000f363aa0eaa28bf27f5e7faab756500a57fb5a2b2eceea02b574586d12b73504fc035f863a497d8a3ed23e2383ca05272df7f1dd01989fc0113b9aef9eeef371990010ad23fcf0262170cb429491de2d34e2591733eee440d4067657e233a5c83dcf647d1b8c9bccd06bde731bad3726957d067422ff327f71cab36402e8f677268cf100119f33cd0d885b9ae579753c8c24b2f2a322053588c1e0b081eaa51341f7bda7df252330808b0d3a042da1a4cc45a6627cf61127cc153dfd47f7197cf97ef52c7f0112ac663714bf20c6d0dcbd53f7cb816b3dd3d730301605a0e710241c663e0023933b64337001cb6faad9c1f7b368af993a7004dace776de4400c2e27dfd33cb83f0064815b6a00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8420db0150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa2158047000000000df3561dfffffff80000002a9d293958000000000f470500010000000a0000000c0000000064815b6a0000000064815b6a0000000064815b690000002aa2063e07000000000e02985d0000000064815b69e6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c59e152a00000000009c186cafffffff80000002c56052dc8000000000a631ce80100000007000000080000000064815b6a0000000064815b6a0000000064815b690000002c59e152a00000000009c186ca0000000064815b69c67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002ac802c09000000000060e60dbfffffff80000002ac4d3008800000000045ee4460100000018000000200000000064815b6a0000000064815b6a0000000064815b690000002ac802c09000000000060e60db0000000064815b698d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002abfdc1ce0000000001a634b48fffffff80000002abc79db28000000001abdd5ca01000000090000000a0000000064815b6a0000000064815b6a0000000064815b690000002abfdc1ce0000000001a634b480000000064815b69543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815b6a0000000064815b690000000000000000000000000000000000000000000000000000000000000000'

describe('PythOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let oracle: Oracle
  let pythOracle: PythOracle
  let pythOracleFactory: PythFactory
  let oracleFactory: OracleFactory
  let dsu: IERC20Metadata
  let oracleSigner: SignerWithAddress

  beforeEach(async () => {
    await time.reset()
    ;[owner, user] = await ethers.getSigners()

    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)

    const oracleImpl = await new Oracle__factory(owner).deploy()
    oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize(dsu.address)
    await oracleFactory.updateMaxClaim(parse6decimal('10'))

    const pythOracleImpl = await new PythOracle__factory(owner).deploy(PYTH_ADDRESS)
    pythOracleFactory = await new PythFactory__factory(owner).deploy(
      pythOracleImpl.address,
      CHAINLINK_ETH_USD_FEED,
      dsu.address,
    )
    await pythOracleFactory.initialize(oracleFactory.address)
    await oracleFactory.register(pythOracleFactory.address)
    await pythOracleFactory.authorize(oracleFactory.address)

    pythOracle = PythOracle__factory.connect(await pythOracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED), owner)
    await pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED)

    oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address),
      owner,
    )
    await oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address)

    oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))

    const dsuHolder = await impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    await dsu.connect(dsuHolder).transfer(oracleFactory.address, utils.parseEther('100000'))

    await time.increaseTo(STARTING_TIME - 1)
    // block.timestamp of the next call will be STARTING_TIME (1686198973)
  })

  describe('#initialize', async () => {
    it('only initializes with a valid priceId', async () => {
      const invalidPriceId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0acd'
      const oracle = await new PythOracle__factory(owner).deploy(PYTH_ADDRESS)
      await expect(oracle.initialize(invalidPriceId, CHAINLINK_ETH_USD_FEED, dsu.address))
        .to.be.revertedWithCustomError(oracle, 'PythOracleInvalidPriceIdError')
        .withArgs(invalidPriceId)
    })
  })

  describe('#commitRequested', async () => {
    it('commits successfully and incentivizes the keeper', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
      await pythOracle.connect(oracleSigner).request(user.address)
      // Base fee isn't working properly in coverage, so we need to set it manually
      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
      await pythOracle.connect(user).commitRequested(0, VAA, {
        value: 1,
        maxFeePerGas: 100000000,
      })
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)

      expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(
        ethers.utils.parseEther('0.10'),
        utils.parseEther('0.11'),
      )
    })

    it('does not allow committing versions with out of order VAA publish times', async () => {
      await time.increase(1)
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(oracleSigner).request(user.address)

      await pythOracle.connect(user).commitRequested(0, OTHER_VAA, {
        value: 1,
      })

      await expect(
        pythOracle.connect(user).commitRequested(1, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleNonIncreasingPublishTimes')
    })

    it('fails to commit if update fee is not provided', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await expect(pythOracle.connect(user).commitRequested(0, VAA)).to.revertedWithoutReason()
    })

    it('does not commit a version that has already been committed', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commitRequested(0, VAA, {
        value: 1,
      })
      await pythOracle.connect(oracleSigner).request(user.address)
      await expect(
        pythOracle.connect(user).commitRequested(0, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleVersionIndexTooLowError')
    })

    it('cannot commit if no version has been requested', async () => {
      await expect(
        pythOracle.connect(user).commitRequested(0, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleNoNewVersionToCommitError')
    })

    it('rejects invalid update data', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await expect(
        pythOracle.connect(user).commitRequested(0, '0x00', {
          value: 1,
        }),
      ).to.reverted
    })

    it('does not skip a version if the grace period has not expired', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(oracleSigner).request(user.address)
      await expect(
        pythOracle.connect(user).commitRequested(1, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleGracePeriodHasNotExpiredError')
    })

    it('does not skip a version if the update is valid for the previous version', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(oracleSigner).request(user.address)
      await time.increase(100)
      await expect(
        pythOracle.connect(user).commitRequested(1, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleUpdateValidForPreviousVersionError')
    })

    it('skips a version if the grace period has expired', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await time.increase(59)
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commitRequested(1, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('does not allow committing a version earlier than the latest committed version', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await time.increase(59)
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commitRequested(1, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
      await pythOracle.connect(oracleSigner).request(user.address)
      await expect(
        pythOracle.connect(user).commitRequested(0, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleVersionIndexTooLowError')
    })
  })

  describe('#commit', async () => {
    it('commits unincentivized if there are no requested or committed versions, does not incentivize keeper, updates latest', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
      await pythOracle.connect(user).commit(STARTING_TIME, VAA, {
        value: 1,
      })
      const version = await pythOracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.true
      expect(version.price).to.equal('18381670317700000000000000')

      // Didn't incentivize keeper
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
      expect(newDSUBalance.sub(originalDSUBalance)).to.equal(0)

      const latestVersion = await pythOracle.connect(user).latest()
      expect(latestVersion).to.deep.equal(version)
    })

    it('fails to commit if update fee is not provided', async () => {
      await expect(pythOracle.connect(user).commit(STARTING_TIME, VAA)).to.revertedWithoutReason()
    })

    it('can commit if there are requested versions but no committed versions', async () => {
      await time.increase(30)
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commit(STARTING_TIME, VAA, {
        value: 1,
      })
    })

    it('can commit if there are committed versions but no requested versions', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commit(STARTING_TIME, VAA, {
        value: 1,
      })
      await pythOracle.connect(user).commit(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('can commit if there are committed versions and requested versions', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commit(STARTING_TIME, VAA, { value: 1 })
      await time.increaseTo(1686199133)
      await pythOracle.connect(oracleSigner).request(user.address)
      const secondRequestedVersion = await currentBlockTimestamp()
      const nonRequestedOracleVersion = STARTING_TIME + 60
      await pythOracle.connect(user).commit(nonRequestedOracleVersion, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
      expect((await pythOracle.connect(user).latest()).timestamp).to.equal(nonRequestedOracleVersion)

      await pythOracle.connect(user).commit(secondRequestedVersion, VAA_WAY_AFTER_EXPIRATION, {
        value: 1,
      })
      expect((await pythOracle.connect(user).latest()).timestamp).to.equal(secondRequestedVersion)
    })

    it('cannot commit invalid VAAs for the oracle version', async () => {
      await expect(
        pythOracle.connect(user).commit(STARTING_TIME - 60, VAA, {
          value: 1,
        }),
      ).to.reverted
    })

    it('must be more recent than the most recently committed version', async () => {
      await time.increase(60)
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commit(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })

      await expect(
        pythOracle.connect(user).commit(STARTING_TIME, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleVersionTooOldError')
    })

    it('tries to commitRequested if more recent than the next requested version to commit', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
      await pythOracle.connect(oracleSigner).request(user.address)
      // Base fee isn't working properly in coverage, so we need to set it manually
      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
      await pythOracle.connect(user).commit(STARTING_TIME, VAA, {
        value: 1,
        gasPrice: 100000000,
      })
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)

      expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(
        ethers.utils.parseEther('0.10'),
        ethers.utils.parseEther('0.11'),
      )
    })

    it('can commit multiple non-requested versions, as long as they are in order', async () => {
      await pythOracle.connect(user).commit(STARTING_TIME, VAA, {
        value: 1,
      })
      await pythOracle.connect(user).commit(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })
    })

    it('fails to commit non-requested version out of order', async () => {
      await pythOracle.connect(user).commit(STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
        value: 1,
      })

      await expect(
        pythOracle.connect(user).commit(STARTING_TIME, VAA, {
          value: 1,
        }),
      ).to.revertedWithCustomError(pythOracle, 'PythOracleVersionTooOldError')
    })
  })

  describe('#status', async () => {
    it('returns the correct versions', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commitRequested(0, VAA, {
        value: 1,
      })
      const [latestVersion, currentVersion] = await pythOracle.status()
      expect(latestVersion.valid).to.be.true
      expect(latestVersion.price).to.equal('18381670317700000000000000')
      expect(currentVersion).to.equal(await currentBlockTimestamp())
    })

    it('returns empty versions if no version has ever been committed', async () => {
      const [latestVersion, currentVersion] = await pythOracle.status()
      expect(currentVersion).to.equal(await currentBlockTimestamp())
      expect(latestVersion.timestamp).to.equal(0)
      expect(latestVersion.price).to.equal(0)
      expect(latestVersion.valid).to.be.false
    })
  })

  describe('#request', async () => {
    it('can request a version', async () => {
      // No requested versions
      await expect(pythOracle.callStatic.versionList(0)).to.be.reverted
      await pythOracle.connect(oracleSigner).request(user.address)
      // Now there is exactly one requested version
      expect(await pythOracle.callStatic.versionList(0)).to.equal(STARTING_TIME)
      await expect(pythOracle.callStatic.versionList(1)).to.be.reverted
    })

    it('does not allow unauthorized users to request', async () => {
      await expect(pythOracle.connect(user).request(user.address)).to.be.reverted
    })
  })

  describe('#latest', async () => {
    it('returns the latest version', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commitRequested(0, VAA, {
        value: 1,
      })
      const latestVersion = await pythOracle.connect(user).latest()
      expect(latestVersion.valid).to.be.true
      expect(latestVersion.price).to.equal('18381670317700000000000000')
    })

    it('returns empty version if no version has ever been committed', async () => {
      const latestVersion = await pythOracle.connect(user).latest()
      expect(latestVersion.timestamp).to.equal(0)
      expect(latestVersion.price).to.equal(0)
      expect(latestVersion.valid).to.be.false
    })
  })

  describe('#current', async () => {
    it('returns the current timestamp', async () => {
      expect(await pythOracle.connect(user).current()).to.equal(await currentBlockTimestamp())
    })

    it('returns the current timestamp w/ granularity == 0', async () => {
      await expect(pythOracleFactory.connect(owner).updateGranularity(0)).to.be.revertedWithCustomError(
        pythOracleFactory,
        'PythFactoryInvalidGranularityError',
      )
    })

    it('returns the current timestamp w/ granularity > MAX', async () => {
      await expect(pythOracleFactory.connect(owner).updateGranularity(3601)).to.be.revertedWithCustomError(
        pythOracleFactory,
        'PythFactoryInvalidGranularityError',
      )
      await expect(pythOracleFactory.connect(owner).updateGranularity(3600)).to.be.not.reverted
    })

    it('returns the current timestamp w/ fresh granularity > 1', async () => {
      await pythOracleFactory.connect(owner).updateGranularity(10)

      const granularity = await pythOracleFactory.granularity()
      expect(granularity.latestGranularity).to.equal(1)
      expect(granularity.currentGranularity).to.equal(10)
      expect(granularity.effectiveAfter).to.equal(await currentBlockTimestamp())

      expect(await pythOracle.connect(user).current()).to.equal(await currentBlockTimestamp())
    })

    it('returns the current timestamp w/ settled granularity > 1', async () => {
      const granularity = await pythOracleFactory.granularity()
      expect(granularity.latestGranularity).to.equal(0)
      expect(granularity.currentGranularity).to.equal(1)
      expect(granularity.effectiveAfter).to.equal(0)

      await pythOracleFactory.connect(owner).updateGranularity(10)

      const granularity2 = await pythOracleFactory.granularity()
      expect(granularity2.latestGranularity).to.equal(1)
      expect(granularity2.currentGranularity).to.equal(10)
      expect(granularity2.effectiveAfter).to.equal(await currentBlockTimestamp())

      await time.increase(1)

      expect(await pythOracle.connect(user).current()).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)
    })

    it('returns the current timestamp w/ fresh + fresh granularity > 1', async () => {
      await pythOracleFactory.connect(owner).updateGranularity(10)
      // hardhat automatically moves 1 second ahead so we have to do this twice
      await pythOracleFactory.connect(owner).updateGranularity(100)
      await expect(pythOracleFactory.connect(owner).updateGranularity(1000)).to.be.revertedWithCustomError(
        pythOracleFactory,
        'PythFactoryInvalidGranularityError',
      )
    })

    it('returns the current timestamp w/ settled + fresh granularity > 1', async () => {
      await pythOracleFactory.connect(owner).updateGranularity(10)
      await time.increase(1)

      await pythOracleFactory.connect(owner).updateGranularity(100)
      const granularity = await pythOracleFactory.granularity()
      expect(granularity.latestGranularity).to.equal(10)
      expect(granularity.currentGranularity).to.equal(100)
      expect(granularity.effectiveAfter).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)

      expect(await pythOracle.connect(user).current()).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)
    })

    it('returns the current timestamp w/ settled + settled granularity > 1', async () => {
      await pythOracleFactory.connect(owner).updateGranularity(10)
      await time.increase(1)

      await pythOracleFactory.connect(owner).updateGranularity(100)
      const granularity = await pythOracleFactory.granularity()
      expect(granularity.latestGranularity).to.equal(10)
      expect(granularity.currentGranularity).to.equal(100)
      expect(granularity.effectiveAfter).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)

      const previousCurrent = Math.ceil((await currentBlockTimestamp()) / 10) * 10
      await time.increase(previousCurrent - (await currentBlockTimestamp()) + 1)

      expect(await pythOracle.connect(user).current()).to.equal(Math.ceil((await currentBlockTimestamp()) / 100) * 100)
    })
  })

  describe('#atVersion', async () => {
    it('returns the correct version', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      await pythOracle.connect(user).commitRequested(0, VAA, {
        value: 1,
      })
      const version = await pythOracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.true
      expect(version.price).to.equal('18381670317700000000000000')
    })

    it('returns invalid version if that version was not requested', async () => {
      const version = await pythOracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.false
    })

    it('returns invalid version if that version was requested but not committed', async () => {
      await pythOracle.connect(oracleSigner).request(user.address)
      const version = await pythOracle.connect(user).at(STARTING_TIME)
      expect(version.valid).to.be.false
    })
  })

  describe('#nextVersionIndexToCommit', async () => {
    context('no requested version', () => {
      it('returns 0', async () => {
        expect(await pythOracle.nextVersionIndexToCommit()).to.equal(0)
      })
    })

    context('multiple requested versions', () => {
      it('returns the next index', async () => {
        await pythOracle.connect(oracleSigner).request(user.address)
        await pythOracle.connect(user).commitRequested(0, VAA, {
          value: 1,
        })
        await pythOracle.connect(oracleSigner).request(user.address)
        await time.increase(1)
        await pythOracle.connect(oracleSigner).request(user.address)

        expect(await pythOracle.nextVersionIndexToCommit()).to.equal(1)
      })
    })
  })

  describe('#nextVersionToCommit', async () => {
    context('no requested version', () => {
      it('returns 0', async () => {
        expect(await pythOracle.nextVersionToCommit()).to.equal(0)
      })
    })

    context('no next version to commit', () => {
      it('returns 0', async () => {
        await pythOracle.connect(oracleSigner).request(user.address)
        await pythOracle.connect(user).commitRequested(0, VAA, {
          value: 1,
        })

        expect(await pythOracle.nextVersionToCommit()).to.equal(0)
      })
    })

    context('multiple requested versions', () => {
      it('returns the next version', async () => {
        await pythOracle.connect(oracleSigner).request(user.address)
        await pythOracle.connect(user).commitRequested(0, VAA, {
          value: 1,
        })
        await time.increaseTo(1686198985)
        await pythOracle.connect(oracleSigner).request(user.address)
        await time.increaseTo(1686198990)
        await pythOracle.connect(oracleSigner).request(user.address)

        expect(await pythOracle.nextVersionToCommit()).to.equal(1686198986)
      })
    })
  })
})
