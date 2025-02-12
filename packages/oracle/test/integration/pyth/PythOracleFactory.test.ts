import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { utils } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import {
  ArbGasInfo,
  IERC20Metadata,
  IERC20Metadata__factory,
  IFactory,
  Market__factory,
  MarketFactory,
  MarketFactory__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
  PythFactory__factory,
  IMarket,
  KeeperOracle__factory,
  KeeperOracle,
  PowerTwo__factory,
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  GuaranteeStorageLocalLib__factory,
  GuaranteeStorageGlobalLib__factory,
  OrderStorageLocalLib__factory,
  OrderStorageGlobalLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
  GasOracle,
  GasOracle__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'
import { IInstance } from '../../../types/generated/@equilibria/root/attribute/interfaces'

const { ethers } = HRE
const { constants } = ethers

const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const PYTH_BTC_USD_PRICE_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
const PYTH_USDC_USD_PRICE_FEED = '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
const PYTH_ARB_USD_PRICE_FEED = '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5'
const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_HOLDER = '0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

// fork timestamp starts at 1686198911, so this gives us 70 seconds of setup time
const STARTING_TIME = 1686198981

// This VAA has timestamp 1686198987 (STARTING_TIME + 6)
const VAA =
  '0x01000000030d0046d9570837d4d2cfcc50fd3346bf18df10179011a1e125e27467bb47bc26f8ce194ed59b48793f4dec9dc919f2e22d43e33fe6ac263980da08f502b894e0fe6f00026a8d75df8f46b144e48ebf6bd6a63267e90dafe353021bbecb9909b0bef0434e56f696870e41ce16b9b8b40c22548815c5fe157915cd08366cb439c5eb51029001040c1775df612c74d4e18da4daa0f42b8953d92340aadf757b6b6ee1e549d1ddfe0115628a360168a23a05684afa5389dd75c431eb5228aaa528de450aae38a50f01084aeacdb58103612ab202ac887d53dc14cd10c4e7d788f95685e0944fb919f8ec64b5cdaa4ede600a9f89ed9aaa3be86facac6ede2ed08760101f6c5c23ce6b29010a2847bd95a0dd2d14302ee732f8f3547ea7e1bfcc9f258ab07d33ca9c62fc837621e8a7dcdb41b06db6f8e768e7e5510f3954029fcdf6e8f3d6b4072da73b51ae010b3a693388722a579f8e7ce44bceb0fac79a4dffbd1076b99a79c55286cc2cf28f2feda95aaf1823f6da2922d9f675619931107bd0538e9dbd53025463a95f2b7b010c732680bb2ba4843b67ba4c493d29cbfe737729cb872aec4ac9b8d83eb0fec898556d02bdeae8995870dc6e75187feacc9b9f714ddd9d97ba5a5abbe07d8884f2010debe8a41fe1715b27fbf2aba19e9564bb4e0bde1fc29412c69347950d216a201130e301f43a5aeec8e7464c9839a114e22efe65d49128b4908b9fa618476cc519010e33495ea1a8df32bc3e7e6f353a4d0371e8d5538e33e354e56784e2877f3765ef5e774abb0c50973686f8236adf5979225ff6f6c68ed942197f40c4fed59331bc010fead2505d4be9161ab5a8da9ed0718afd1ddf0b7905db57997a1ed4741d9d326840e193b84e115eba6256ed910e12e10f68c4563b6abaae211eaac5c0416d1f9601108eddcab6c9952dc0da91900a35821ef75818a5f3898721fd05ff708597c19d5e573f2b63674989365ca9fee0dd660566afaec135230d978e66ee4106c263b124011164788fde3bcf11e6773308a3732a0f0bd73b6876789c2b01f2bbaf84473be6ec2b7a3884d117adc625cbf48710c238d9c122a5f64f283685d9c66f3656d79d4d001247f246ba17092100f8bfc1e93822ad3d07561697ac90d4ebf3d371fce17e399246b18f85b52f74157240cdf16da4bde72146cf0cb976c39a2d6958d7b55773f70064815acc00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8413740150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3fa23ae00000000117b5092fffffff80000002a9cdd1528000000000f4ab712010000000a0000000c0000000064815acc0000000064815acb0000000064815acb0000002aa3fa23ae00000000117b50920000000064815acbe6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c5ffd594000000000086bfba4fffffff80000002c55aaa600000000000a73c7010100000007000000080000000064815acc0000000064815acb0000000064815acb0000002c5ffd594000000000086bfba40000000064815acbc67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002acc544cc90000000006747a77fffffff80000002ac4a4eba8000000000456d9f30100000017000000200000000064815acc0000000064815acb0000000064815acb0000002acc544cc90000000006747a770000000064815acb8d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac880a3200000000010e67139fffffff80000002abc130ec0000000001b3bcc6401000000090000000a0000000064815acc0000000064815acb0000000064815acb0000002ac880a3200000000010e671390000000064815acb543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815acc0000000064815aca0000000000000000000000000000000000000000000000000000000000000000'

// This VAA has timestamp 1686198989 (STARTING_TIME + 8)
const OTHER_VAA =
  '0x01000000030d00a87bb4f45a7ba5924b7f528f1563dcc3be57a88e75b77ea58c5e492e768b71ce36fc3f0c5399afd2c53bd9b6ae02dee259b1d85d511d9ea1cee3a3ba8a2f9b1e010200369aebb31fcedfc625307802472f751fd030d1386e23d65a31ab6445fca14819fdc142b80a81e5d3d6977b888338a17e6e757d83062e03df2383b04d3693fe01041acc2688a58c12b4b7ace5796f763c9be31ad70e7bb6b98ccacd5c3ee188511634da6bcb92c5e3c99174d0c1f04c0b0fc9ff22d0a4ba721231f0fbf1439734710006fa15d2b248896c629b5ad8f5be1d367f3eda33f86fe5eaf239fcf5c924fa99eb65fa3a9ccb028ada60a14d83537c9760aa87845de8bf0274d56d4501da39099c000a881c1f94bed5fda4b492606be77b8a1d215b1cefa6a76553214015152828b504735e9cdff068c1c2f16a15c98da2f030f4806d95cda06676bde86a5b2322d402010bf01b66ee9fde5e18892de416b05b3aeaa2b9e7cf4b88a81ebe327881c9ae79a52c6bf6fa0a9a05e095f5b1eb1b2e0510b6654f328da598f059a5075e6da266ef000c66e366f97cb5b6479398c4a90ed3a084558a9b653ef263015a46b4628caa2f1c066173e63c99f1e72fc9fd2e8778580df72ebef36e7bab6ceda71927aa543ae8000d26b1ac6eddf58d4a206558b423b1f6b4c2aa79eef7c9a4a112aacd0f12f3f6f616782ef53f4c5128954835d7c9fa7e8f3a999c1bc4a206e44459bab2f4a97762000ee75540ac332dde0b2396608d8afd45475b25c9a38c19e4a761b601e7419ba049566b0b4a43add83a4873a955ed1a575944ed18cb84af53dde08c90a3e20cb741010f05e8754cdb035a819162f897bfd692652a8959ad9a276901dcde0547d6b45af33395695e8089fe727903b365d54c4db48f79b9c4832245e87f14cbf18daaa05a0010e43cfa7d5f358c054452fa1f769bb2e0b3aca50675af9a37b23bceb894b747020bc045c853bb11be810fc26a3198cd45bdb56f3103b6e4f63cb065118c641d840011adfddcc762849d28586c211cf696a22700a2e509dc8e66d3a83c3532d847967e16c42379ecb0705c85fcf4e98abea9288336366bd7076fab3e3a1a231e16262e0112822e96a61fe31459fd98e6718ac1bc776ee8f0eba68b8e6afbf334e582c692d808b768c91eb03f7329e1680f4224447e47b4da3f1eff401aa71eb6be927f18600164815ace00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8413a60150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3d3fd2d0000000011a17713fffffff80000002a9cde49c0000000000f4b14df010000000a0000000c0000000064815ace0000000064815ace0000000064815acd0000002aa3d3fd2d0000000011a177130000000064815acce6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c5ffd594000000000086bfba4fffffff80000002c55acc4f8000000000a7364600100000007000000080000000064815ace0000000064815acd0000000064815acd0000002c5ffd594000000000086bfba40000000064815acdc67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002acc918fe7000000000618b2d9fffffff80000002ac4a5d9f00000000004570ac20100000017000000200000000064815ace0000000064815acd0000000064815acd0000002acc7758c0000000000632ea000000000064815acd8d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac880a3200000000010e67139fffffff80000002abc15b288000000001b39428201000000090000000a0000000064815ace0000000064815acd0000000064815acd0000002ac880a3200000000010e671390000000064815acd543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815ace0000000064815ace0000000000000000000000000000000000000000000000000000000000000000'

// This VAA has timestamp 1686199046 (STARTING_TIME + 65)
const VAA_AFTER_EXPIRATION =
  '0x01000000030d00bfb661157be7ad89a7e9c0f814fd991111260a063da76b9d6feceb23805d293031cae0d90acedc6272261b2b342d8528026bc2c4ca2bee14d2a9c37f54f5ff430101182784762cbbb5b288b9bce0e4809130ff6d0c32e54a43b83ca3df9429fb5f1c6954520ee536def601e4ae2cc96904d6255fe3b0a2680b04002a6215f8b7d05f0102c5e5bb34bc0e0a29050d528add872a84fb0dedfd87a7b212751efad4db9fdb8a268d6d652edd42977b45efa4b113cf64ba2cd574f8421829bf488b70c7708e5401048525c3dbe7e9982e73b57d1fb25f844ca89d5b0b70081331b494a7539bafd4081d58ef70e60b45e1aba5abf2aabfcb8e6ed5f98f0500e9f2bdd49828b4998b72010640c2b4fe8b742460244bb8727e73be77cde68e138793f35b5e4a0ceb244b9b583f2676c1b62bc00757f310fc15d7f89ddabe0ff2cfcf069e6a88fa557fe0abee0109c73d8eb1b3dcafda9b63cb3567aaa6ed5d08f945143087ce08b010d98985f2e372405c189b13e34dc263bdbf2e65907703daaf0c7952f8282c5e6f173dc7ed93010a99d8e194e2b3e7541a3321d1f130ef43cfeca479d35450fe2fdfb830c983b6152c61aa15a625bd25159202b8819dd49ac772af9403a1839897fce2629513aa1c000b7d28b5197c734b97beaa120bfe60347ddfc0daa0201435ec157cab6fe3f606fd573dbd0adf70c087b65f7ac3c8a635248d0a2af594ddf3ca8efc22aa68472b9c010d6cb1d8e21dc3496c271217a6881a7c0e7889f4d1ce28bcf41a6239c8231b25d33e08aaf3101baedb6967deb7c3463575d3985c7df414180c6b9c1a432afabb25010eb63ac25e0e08b961c4fe09a40d151a9cdefcc6dcd0b9e515e39a51538d9d56002c31a034f0fa2c7074a0b49bd9664085fda7576b88fac9c4d9bfd4e78dcf04f7010f8ac4211c75d9b3b3dd6561ca78a6d0e5b48978999622550e2ee8c96349cbe1a15297d9821a636e7243035a8109c0e1e8837f685fd8a543551d861b8d206bcd7100118f9cebf15e664f2d61fcdfb513f73063c98631cea238441193f3c530978c762e2dbbb34cb506339acf0e307dba791163e423777f7a6630041fa194ec361b519a011226603dae57d5f0830366bc2de410bca394104448bcbd265786d1778906a20a71413e7789c1e023f0e9aa801c1c3ea88577c01484747030cc14e019f96b3b4b8c0064815b0600000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b84185b0150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3a2542c000000000cff29d4fffffff80000002a9cfc4970000000000f4fed45010000000a0000000c0000000064815b060000000064815b060000000064815b050000002aa0efd01e000000000f1906450000000064815b05e6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c59c2ce20000000000929ebaafffffff80000002c55dbcff0000000000a6b691c0100000007000000080000000064815b060000000064815b060000000064815b050000002c59c2ce20000000000929ebaa0000000064815b05c67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002ac7759bc000000000052b5730fffffff80000002ac4bd9810000000000459d2670100000017000000200000000064815b060000000064815b060000000064815b050000002ac7759bc00000000003a9eecc0000000064815b058d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac114eb000000000011e1b38ffffffff80000002abc59e390000000001aefec2201000000090000000a0000000064815b060000000064815b050000000064815b050000002ac114eb000000000011e1b38f0000000064815b05543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815b060000000064815b020000000000000000000000000000000000000000000000000000000000000000'

// This VAA has timestamp 1686199146 (STARTING_TIME + 165)
const VAA_WAY_AFTER_EXPIRATION =
  '0x01000000030d00759894dd446d5bbb720d73f32fea0c728cfecc474369fd46de94c1ee3d4f6a326eafdaa907c8b4c2fd027d7047af501103f513d9ed7cbde0a404516c7fa866c80001a2c0276919ba58edea3f3f395fbeaac7a8c3e0a8688f9e5d5c925396b503e90b4e652bd85e8672878a0960ff65515226651f12ad49721a0665f0bb2e5c28fb0c0102dde9e7d36aaef1a7528bed0f95f7d52d6ca33169afee85604669115454b90bbf36eb6de59decdcc4517cdb849efaef0626c83b318efbdf34b5373fd9e2a7c7f6000479d697d129cd515036eb19dfc17e08dd6628073204f5177042636682f9c268350abb39ee46dd119dd3dca48324f43bd72e8be84afa6ccde91c5d7d76ef7dd56e010ac6c6d3d4d7ed37747282478a628a7208e45aa609323ee54af0ab974755e3bdcc1e0fc45de741a3f629591a8f465e99de5b0670943bb1e74e7661d668fae491a5010b13f2c4cd06b86ad65495ab9b16b1ba8605a4a30207ab65a36a7e207f576983c50b3a06351c4acacac5d0b6c6491a575bc265ce4f58cd882fa2df4e1179730830000cfb174a0ce4426bff92f9b98387ec915f2f799ede09e75ccf916ddfa2e6b9da162fdc215ee99b02885468c23a36e66e2ce4265d222e0435cdc464239406021605010dc6e6437bd2395449d08890ee69b20451ae2b8b9ef33d5589c031d00164a824aa749dc420f1d7404441c79be128bf5cab830404b6efa2210d1a823a18479bf342000eeebc6b5b1ae0d9bec0b78e629b8548bcc37ec455bb99f6d2d312c37bbccc043716860daa6c998614ca9d67a3a6336b5da352d7dfd4b99a44034df0e4c8d90bd7000f363aa0eaa28bf27f5e7faab756500a57fb5a2b2eceea02b574586d12b73504fc035f863a497d8a3ed23e2383ca05272df7f1dd01989fc0113b9aef9eeef371990010ad23fcf0262170cb429491de2d34e2591733eee440d4067657e233a5c83dcf647d1b8c9bccd06bde731bad3726957d067422ff327f71cab36402e8f677268cf100119f33cd0d885b9ae579753c8c24b2f2a322053588c1e0b081eaa51341f7bda7df252330808b0d3a042da1a4cc45a6627cf61127cc153dfd47f7197cf97ef52c7f0112ac663714bf20c6d0dcbd53f7cb816b3dd3d730301605a0e710241c663e0023933b64337001cb6faad9c1f7b368af993a7004dace776de4400c2e27dfd33cb83f0064815b6a00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8420db0150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa2158047000000000df3561dfffffff80000002a9d293958000000000f470500010000000a0000000c0000000064815b6a0000000064815b6a0000000064815b690000002aa2063e07000000000e02985d0000000064815b69e6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c59e152a00000000009c186cafffffff80000002c56052dc8000000000a631ce80100000007000000080000000064815b6a0000000064815b6a0000000064815b690000002c59e152a00000000009c186ca0000000064815b69c67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002ac802c09000000000060e60dbfffffff80000002ac4d3008800000000045ee4460100000018000000200000000064815b6a0000000064815b6a0000000064815b690000002ac802c09000000000060e60db0000000064815b698d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002abfdc1ce0000000001a634b48fffffff80000002abc79db28000000001abdd5ca01000000090000000a0000000064815b6a0000000064815b6a0000000064815b690000002abfdc1ce0000000001a634b480000000064815b69543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815b6a0000000064815b690000000000000000000000000000000000000000000000000000000000000000'

// New Multi-Update payload w/ (ETH / BTC) Publish Time: 1697317340
const VAA_WITH_MULTIPLE_UPDATES_2 =
  '0x504e41550100000003b801000000030d0010fc3ccba0af48851af3e44f56c8f6b607df3f920f9645fbce556879553ee3642054812dd938a427b7c6663c49be0da851cc1dbce9bec900d2f137f63abfdbb4000158fd9af9c87f09ee08532a584afe0edde5e18c13c18c633898c26afad9a7d9a8025ed13e09ab6ea50aa1bbbd114f027dba5fb4e4ea9e05df02cc69f11e540d140002f6dde33ffcc265df48402d690e39c5bfa3ba1a90739ff2626d7d77688994ee1304be4d132b8828e0965096c3d19ad1c4536bb0e1649a6d52765a8966e7f68623010697d31b8a98a1a5d80cf9e82f717b6b905d74eee5f71941f4fed1657200dd69ed7f7b9b0d98f85152c115aab7e9f82605c9e57be16cbcc3cb51cdc8c348a8b52000073d870e8ac1a8a127df58612df5c75b4aa0a207347676bb9dfce4874b62fbfe12714cf737d286b805d62ad64b72ec6f72a58fcecf2876516675227d595fa84ee00108512340a2b57d6e2ba1fe06a221251f97acb9992b66ad9e1196482c39d0cc04a132337c2dad528f063391d42f976a3dd6cd341bb7c8b732d9134ea3b9071afe70000a8b037d1078fe7986a0786f34c2119c924227b7ef6fbe6e82ace4d1648873112e3539e6cc537d1bb9e3898800b20d9e3392a194f259398022d4988e36eedb4fa6000bc9556474ec5cf5959be645ac7b3cd37bb567e033b99946c6bcc94d4ca1671197692cb034433a6911e2776ff82846ff7c1bf0a39aa5cde1b324cc3372b5c7e91d010d36dcf4f8c94502a9227ae1bfb648db9f8d5a8aafebc8e1841ce34f5c9121b4c35693eae191bb59e0622e4a41c7a0aa9ec256e3b09b4e6b917c16a6855fc5a3a7000e6529e2de38971afba15bdf8c7dda6a331975c0526695be05384d70a8ecbc32e76ba6c952fd5ac711b8053d27e21a3336d7b78eb4b591847c4f2f4e436ebe5d43000f4d7c85fdce3c5b76b10dec27f892d39a5931554d22301db82c86a58ffabda1596029decd53c145fd1359dcf30673905fd7c7c2d6a200d6ad5ba15721d285537d0011ee19ed6f05f83ae8e94f8eeaf4a836e2c965e00830b09dc62080cc9d5dca502e09c34b0385b0b9d545025cf83d6d59ff822290241fd218d912b5974fdd1a4b6901129aa2e02afff0bbf0c794c131bddb6016cc4d9051c51e93de744d28f962eddeeb230b27a2302ca5cf7572964e811934544591df48ac144aa29d1aa5f8bcf6305301652b01dd00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000011b804e01415557560000000000061ec52f00002710a2fa33b99d0b9673b28d532f7fd24b10799c24e902005500ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace000000244a0adcec0000000002eaf093fffffff800000000652b01dc00000000652b01dc00000024346bd9d0000000000384e7cb09fd052ff1a1f0fd3638fc34ad246bc2b004ec0e6736c1b541a1eb6bcd693c8112ed565c73172a905605a01e2504d9f0c06e7e7cb0cf24116098ca202ac5f6ade2e8f5a12ec006b16d46be1f0228b94d95115af802d65322ad2f3cd882fc1b60975ce13af3d5a54791aa79e1ab25e9814cd33845c52af2a95396fc64a987ef498fe6cbd8656f4fc911e77c8194dd38f0da18fcb0f7ead4d1de56db6c0442b94883ac3566efd0575b43e8d2ed03d4c2f1bced59eb71005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b4300000271b88758760000000044e07b0afffffff800000000652b01dc00000000652b01dc00000271562c3de0000000003f9f8988094a92c643d1aa3b8e4a70f1e0f4cd33a7a5ea3b0ef4a6239e0c0c49ebd6ef0f6979b45c4d952ce4330bef33ee63bc0484ef89ec054f6c5cd433c78dbfb5fcd4e6e0fc5d192b899766b4f4e84c9fbdb3111b4e76a83ce4fdebc4dded43686ff3440b82414db36a74e16723b6c1480753b3da86df63c7375d0e96fc64a987ef498fe6cbd8656f4fc911e77c8194dd38f0da18fcb0f7ead4d1de56db6c0442b94883ac3566efd0575b43e8d2ed03d4c2f1bced59eb71'

const testOracles = [
  {
    name: 'KeeperOracle',
    Oracle: KeeperOracle__factory,
    gasMock: async () => {
      const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
        address: '0x000000000000000000000000000000000000006C',
      })
      gasInfo.getL1BaseFeeEstimate.returns(0)
    },
  },
]

export async function fundWallet(dsu: IERC20Metadata, wallet: SignerWithAddress): Promise<void> {
  const dsuMinter = await impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await dsuMinter.sendTransaction({
    to: dsu.address,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [utils.parseEther('200000')]),
  })
  await dsu.connect(dsuMinter).transfer(wallet.address, utils.parseEther('200000'))
}

testOracles.forEach(testOracle => {
  describe(testOracle.name, () => {
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let user2: SignerWithAddress
    let commitmentGasOracle: GasOracle
    let settlementGasOracle: GasOracle
    let oracle: Oracle
    let oracleBtc: Oracle
    let oracle2: Oracle
    let keeperOracle: KeeperOracle
    let keeperOracle2: KeeperOracle
    let keeperOracleBtc: KeeperOracle
    let pythOracleFactory: PythFactory
    let oracleFactory: OracleFactory
    let marketFactory: MarketFactory
    let market: IMarket
    let marketBtc: IMarket
    let market2: IMarket
    let dsu: IERC20Metadata
    let factorySigner: SignerWithAddress

    const fixture = async () => {
      await time.reset()
      await setup()
    }

    const fixture2 = async () => {
      await time.reset(18028156)
      await setup()
    }

    const setup = async () => {
      ;[owner, user, user2] = await ethers.getSigners()

      dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
      await fundWallet(dsu, user)

      const powerTwoPayoff = await new PowerTwo__factory(owner).deploy()

      const oracleImpl = await new Oracle__factory(owner).deploy()
      oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
      await oracleFactory.initialize()
      await oracleFactory.connect(owner).updateParameter({
        maxGranularity: 10000,
        maxSettlementFee: parse6decimal('1000'),
        maxOracleFee: parse6decimal('0.5'),
      })

      commitmentGasOracle = await new GasOracle__factory(owner).deploy(
        CHAINLINK_ETH_USD_FEED,
        8,
        1_000_000,
        ethers.utils.parseEther('1.02'),
        1_000_000,
        0,
        0,
        0,
      )
      settlementGasOracle = await new GasOracle__factory(owner).deploy(
        CHAINLINK_ETH_USD_FEED,
        8,
        200_000,
        ethers.utils.parseEther('1.02'),
        500_000,
        0,
        0,
        0,
      )
      const keeperOracleImpl = await new testOracle.Oracle(owner).deploy(60)
      pythOracleFactory = await new PythFactory__factory(owner).deploy(
        PYTH_ADDRESS,
        commitmentGasOracle.address,
        settlementGasOracle.address,
        keeperOracleImpl.address,
      )
      await pythOracleFactory.initialize(oracleFactory.address)
      await oracleFactory.register(pythOracleFactory.address)
      await pythOracleFactory.register(powerTwoPayoff.address)

      keeperOracle = testOracle.Oracle.connect(
        await pythOracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
          provider: ethers.constants.AddressZero,
          decimals: 0,
        }),
        owner,
      )
      await pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })
      keeperOracleBtc = testOracle.Oracle.connect(
        await pythOracleFactory.callStatic.create(
          '0x0000000000000000000000000000000000000000000000000000000000000017',
          PYTH_BTC_USD_PRICE_FEED,
          { provider: ethers.constants.AddressZero, decimals: 0 },
        ),
        owner,
      )
      await pythOracleFactory.create(
        '0x0000000000000000000000000000000000000000000000000000000000000017',
        PYTH_BTC_USD_PRICE_FEED,
        { provider: ethers.constants.AddressZero, decimals: 0 },
      )
      keeperOracle2 = testOracle.Oracle.connect(
        await pythOracleFactory.callStatic.create(
          '0x0000000000000000000000000000000000000000000000000000000000000021',
          PYTH_ETH_USD_PRICE_FEED,
          { provider: powerTwoPayoff.address, decimals: -3 },
        ),
        owner,
      )
      await pythOracleFactory.create(
        '0x0000000000000000000000000000000000000000000000000000000000000021',
        PYTH_ETH_USD_PRICE_FEED,
        { provider: powerTwoPayoff.address, decimals: -3 },
      )
      await pythOracleFactory.create(PYTH_USDC_USD_PRICE_FEED, PYTH_USDC_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })

      oracle = Oracle__factory.connect(
        await oracleFactory.callStatic.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD'),
        owner,
      )
      await oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD')
      oracleBtc = Oracle__factory.connect(
        await oracleFactory.callStatic.create(
          '0x0000000000000000000000000000000000000000000000000000000000000017',
          pythOracleFactory.address,
          'BTC-USD',
        ),
        owner,
      )
      await oracleFactory.create(
        '0x0000000000000000000000000000000000000000000000000000000000000017',
        pythOracleFactory.address,
        'BTC-USD',
      )
      oracle2 = Oracle__factory.connect(
        await oracleFactory.callStatic.create(
          '0x0000000000000000000000000000000000000000000000000000000000000021',
          pythOracleFactory.address,
          'ETH²-USD',
        ),
        owner,
      )
      await oracleFactory.create(
        '0x0000000000000000000000000000000000000000000000000000000000000021',
        pythOracleFactory.address,
        'ETH²-USD',
      )

      const verifierImpl = await new VersionStorageLib__factory(owner).deploy()

      // TODO: refactor Market implementation deployment into a helper
      const marketImpl = await new Market__factory(
        {
          '@perennial/v2-core/contracts/libs/CheckpointLib.sol:CheckpointLib': (
            await new CheckpointLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/libs/InvariantLib.sol:InvariantLib': (
            await new InvariantLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/libs/VersionLib.sol:VersionLib': (
            await new VersionLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Global.sol:GlobalStorageLib': (
            await new GlobalStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
            await new MarketParameterStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Position.sol:PositionStorageGlobalLib': (
            await new PositionStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Position.sol:PositionStorageLocalLib': (
            await new PositionStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
            await new RiskParameterStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Version.sol:VersionStorageLib': (
            await new VersionStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': (
            await new GuaranteeStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': (
            await new GuaranteeStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Order.sol:OrderStorageLocalLib': (
            await new OrderStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Order.sol:OrderStorageGlobalLib': (
            await new OrderStorageGlobalLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy(verifierImpl.address)
      marketFactory = await new MarketFactory__factory(owner).deploy(
        oracleFactory.address,
        verifierImpl.address,
        marketImpl.address,
      )
      await marketFactory.initialize()
      await marketFactory.updateParameter({
        maxFee: parse6decimal('0.01'),
        maxLiquidationFee: parse6decimal('5'),
        maxCut: parse6decimal('0.50'),
        maxRate: parse6decimal('10.00'),
        minMaintenance: parse6decimal('0.01'),
        minEfficiency: parse6decimal('0.1'),
        referralFee: 0,
        minScale: parse6decimal('0.001'),
        maxStaleAfter: 7200,
      })

      const riskParameter = {
        margin: parse6decimal('0.3'),
        maintenance: parse6decimal('0.3'),
        takerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100'),
        },
        makerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100'),
        },
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('5'),
        utilizationCurve: {
          minRate: 0,
          maxRate: parse6decimal('5.00'),
          targetRate: parse6decimal('0.80'),
          targetUtilization: parse6decimal('0.80'),
        },
        pController: {
          k: parse6decimal('40000'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
        minMargin: parse6decimal('5'),
        minMaintenance: parse6decimal('5'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }
      const marketParameter = {
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        oracleFee: 0,
        riskFee: 0,
        makerFee: 0,
        takerFee: 0,
        maxPendingGlobal: 8,
        maxPendingLocal: 8,
        maxPriceDeviation: parse6decimal('0.1'),
        closed: false,
        settle: false,
      }
      market = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracle.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracle.address,
      })
      await market.updateParameter(marketParameter)
      await market.updateRiskParameter(riskParameter)

      market2 = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracle2.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracle2.address,
      })
      await market2.updateParameter(marketParameter)
      await market2.updateRiskParameter(riskParameter)

      marketBtc = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracleBtc.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracleBtc.address,
      })
      await marketBtc.updateParameter(marketParameter)
      await marketBtc.updateRiskParameter(riskParameter)

      await keeperOracle.register(oracle.address)
      await keeperOracleBtc.register(oracleBtc.address)
      await keeperOracle2.register(oracle2.address)
      await oracle.register(market.address)
      await oracleBtc.register(marketBtc.address)
      await oracle2.register(market2.address)

      await dsu.connect(user).approve(market.address, constants.MaxUint256)
      await dsu.connect(user).approve(market2.address, constants.MaxUint256)

      factorySigner = await impersonateWithBalance(pythOracleFactory.address, utils.parseEther('10'))

      await testOracle.gasMock()
      console.log('finished creating fixture', await time.currentBlockTimestamp())
    }

    describe('without initial price', async () => {
      const MIN_DELAY = 4
      const BATCHED_TIMESTAMP = 1697317340

      beforeEach(async () => {
        await loadFixture(fixture2)
      })

      it('can update single from batched update', async () => {
        await pythOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)

        await time.includeAt(
          async () =>
            await pythOracleFactory
              .connect(user)
              .commit([PYTH_ETH_USD_PRICE_FEED], BATCHED_TIMESTAMP - MIN_DELAY, VAA_WITH_MULTIPLE_UPDATES_2, {
                value: 2,
              }),
          BATCHED_TIMESTAMP + 60,
        )

        expect((await keeperOracle.latest()).timestamp).to.equal(BATCHED_TIMESTAMP - MIN_DELAY)
        expect((await keeperOracle.latest()).valid).to.equal(true)
      })

      it('can update multiple from batched update', async () => {
        await pythOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)

        await time.includeAt(
          async () =>
            await pythOracleFactory
              .connect(user)
              .commit(
                [PYTH_ETH_USD_PRICE_FEED, '0x0000000000000000000000000000000000000000000000000000000000000017'],
                BATCHED_TIMESTAMP - MIN_DELAY,
                VAA_WITH_MULTIPLE_UPDATES_2,
                { value: 2 },
              ),
          BATCHED_TIMESTAMP + 60,
        )

        expect((await keeperOracle.latest()).timestamp).to.equal(BATCHED_TIMESTAMP - MIN_DELAY)
        expect((await keeperOracle.latest()).valid).to.equal(true)
        expect((await keeperOracleBtc.latest()).timestamp).to.equal(BATCHED_TIMESTAMP - MIN_DELAY)
        expect((await keeperOracleBtc.latest()).valid).to.equal(true)
      })

      it('reverts if feed not included in batched update', async () => {
        await time.increaseTo(BATCHED_TIMESTAMP + 60)

        await expect(
          pythOracleFactory
            .connect(user)
            .commit(
              [
                PYTH_ETH_USD_PRICE_FEED,
                '0x0000000000000000000000000000000000000000000000000000000000000017',
                PYTH_USDC_USD_PRICE_FEED,
              ],
              BATCHED_TIMESTAMP - MIN_DELAY,
              VAA_WITH_MULTIPLE_UPDATES_2,
              { value: 2 },
            ),
        ).to.be.revertedWithCustomError(
          { interface: new ethers.utils.Interface(['error PriceFeedNotFoundWithinRange()']) },
          'PriceFeedNotFoundWithinRange',
        )
      })

      it('reverts if feed not created', async () => {
        await time.increaseTo(BATCHED_TIMESTAMP + 60)

        await expect(
          pythOracleFactory
            .connect(user)
            .commit(
              [
                PYTH_ETH_USD_PRICE_FEED,
                '0x0000000000000000000000000000000000000000000000000000000000000017',
                PYTH_ARB_USD_PRICE_FEED,
              ],
              BATCHED_TIMESTAMP - MIN_DELAY,
              VAA_WITH_MULTIPLE_UPDATES_2,
              { value: 2 },
            ),
        ).to.be.revertedWithCustomError(
          { interface: new ethers.utils.Interface(['error KeeperFactoryNotCreatedError()']) },
          'KeeperFactoryNotCreatedError',
        )
      })

      it('reverts if feed included twice in batched update', async () => {
        await time.increaseTo(BATCHED_TIMESTAMP + 60)

        await expect(
          pythOracleFactory
            .connect(user)
            .commit(
              [
                PYTH_ETH_USD_PRICE_FEED,
                '0x0000000000000000000000000000000000000000000000000000000000000017',
                '0x0000000000000000000000000000000000000000000000000000000000000017',
              ],
              BATCHED_TIMESTAMP - MIN_DELAY,
              VAA_WITH_MULTIPLE_UPDATES_2,
              { value: 2 },
            ),
        ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryVersionOutsideRangeError') // already committed
      })
    })

    describe('with initial price', async () => {
      beforeEach(async () => {
        await loadFixture(fixture)
        const stagingTime = STARTING_TIME - 10
        if ((await time.currentBlockTimestamp()) >= stagingTime)
          throw new Error('Fork block does not allow sufficient time for test setup')
        await time.increaseTo(stagingTime)

        await time.includeAt(async () => {
          await pythOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)
          await pythOracleFactory.commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME - 1, VAA, { value: 1 })
          await pythOracleFactory.commit(
            ['0x0000000000000000000000000000000000000000000000000000000000000021'],
            STARTING_TIME - 1,
            VAA,
            { value: 1 },
          )
        }, STARTING_TIME - 1)
      })

      describe('PythFactory', async () => {
        context('#initialize', async () => {
          it('reverts if already initialized', async () => {
            const pythOracleFactory2 = await new PythFactory__factory(owner).deploy(
              PYTH_ADDRESS,
              commitmentGasOracle.address,
              settlementGasOracle.address,
              await pythOracleFactory.implementation(),
            )
            await pythOracleFactory2.initialize(oracleFactory.address)
            await expect(pythOracleFactory2.initialize(oracleFactory.address))
              .to.be.revertedWithCustomError(pythOracleFactory2, 'InitializableAlreadyInitializedError')
              .withArgs(1)
          })
        })

        context('#create', async () => {
          it('cant recreate price id', async () => {
            await expect(
              pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
                provider: ethers.constants.AddressZero,
                decimals: 0,
              }),
            ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryAlreadyCreatedError')
          })

          it('cant recreate invalid price id', async () => {
            await expect(
              pythOracleFactory.create(
                PYTH_ETH_USD_PRICE_FEED,
                '0x0000000000000000000000000000000000000000000000000000000000000000',
                { provider: ethers.constants.AddressZero, decimals: 0 },
              ),
            ).to.be.revertedWithCustomError(pythOracleFactory, 'PythFactoryInvalidIdError')
          })

          it('reverts when not owner', async () => {
            await expect(
              pythOracleFactory.connect(user).create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
                provider: ethers.constants.AddressZero,
                decimals: 0,
              }),
            ).to.be.revertedWithCustomError(pythOracleFactory, 'OwnableNotOwnerError')
          })
        })

        context('#updateParameter', async () => {
          it('reverts when not owner', async () => {
            await expect(pythOracleFactory.connect(user).updateParameter(10, 13, 14, 15)).to.be.revertedWithCustomError(
              pythOracleFactory,
              'OwnableNotOwnerError',
            )
          })
        })

        context('#register', async () => {
          it('reverts when not owner', async () => {
            await expect(
              pythOracleFactory.connect(user).register(ethers.constants.AddressZero),
            ).to.be.revertedWithCustomError(pythOracleFactory, 'OwnableNotOwnerError')
          })
        })
      })

      describe('#initialize', async () => {
        it('only initializes with a valid priceId', async () => {
          const oracle = await new KeeperOracle__factory(owner).deploy(60)
          await expect(oracle.initialize()).to.emit(oracle, 'Initialized').withArgs(1)
        })

        it('reverts if already initialized', async () => {
          const oracle = await new KeeperOracle__factory(owner).deploy(60)
          await oracle.initialize()
          await expect(oracle.initialize())
            .to.be.revertedWithCustomError(oracle, 'InitializableAlreadyInitializedError')
            .withArgs(1)
        })
      })

      describe('#constants', async () => {
        it('#MIN_VALID_TIME_AFTER_VERSION', async () => {
          expect((await pythOracleFactory.parameter()).validFrom).to.equal(4)
        })

        it('#MAX_VALID_TIME_AFTER_VERSION', async () => {
          expect((await pythOracleFactory.parameter()).validTo).to.equal(10)
        })

        it('#GRACE_PERIOD', async () => {
          expect(await keeperOracle.timeout()).to.equal(60)
        })
      })

      describe('#commit', async () => {
        it('commits successfully and incentivizes the keeper', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )

          expect(await keeperOracle.localCallbacks(STARTING_TIME)).to.deep.eq([user.address])

          // Base fee isn't working properly in coverage, so we need to set it manually
          await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
              value: 1,
              maxFeePerGas: 100000000,
            }),
          )
            .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
            .withArgs({ timestamp: STARTING_TIME, price: '1838167031', valid: true })

          const reward = utils.parseEther('0.370586')
          expect(await dsu.balanceOf(user.address)).to.be.equal(
            utils.parseEther('200000').sub(utils.parseEther('10')).add(reward),
          )

          expect((await market.position()).timestamp).to.equal(STARTING_TIME)
        })

        it('commits successfully with payoff and incentivizes the keeper', async () => {
          await time.includeAt(
            async () =>
              await market2
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect(await keeperOracle2.localCallbacks(STARTING_TIME)).to.deep.eq([user.address])

          // Base fee isn't working properly in coverage, so we need to set it manually
          await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
          expect(await keeperOracle2.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle2.next()).to.be.equal(STARTING_TIME)
          await expect(
            pythOracleFactory
              .connect(user)
              .commit(['0x0000000000000000000000000000000000000000000000000000000000000021'], STARTING_TIME, VAA, {
                value: 1,
                maxFeePerGas: 100000000,
              }),
          )
            .to.emit(keeperOracle2, 'OracleProviderVersionFulfilled')
            .withArgs({ timestamp: STARTING_TIME, price: '3378858036', valid: true })

          const reward = utils.parseEther('0.370586')
          expect(await dsu.balanceOf(user.address)).to.be.equal(
            utils.parseEther('200000').sub(utils.parseEther('10')).add(reward),
          )
        })

        it('fails to commit if update fee is not provided', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA),
          ).to.be.revertedWithCustomError(
            { interface: new ethers.utils.Interface(['error InsufficientFee()']) },
            'InsufficientFee',
          )
        })

        it('fails to commit if version is outside of time range', async () => {
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME - 5, VAA, { value: 1 }),
          ).to.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryVersionOutsideRangeError')

          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 3, VAA, { value: 1 }),
          ).to.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryVersionOutsideRangeError')

          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        })

        it('does not commit a version that has already been committed', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 2, 0, 0, 0, false) // make request to oracle (new price)
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
              value: 1,
            }),
          ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('rejects invalid update data', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, '0x', {
              value: 1,
            }),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
        })

        it('cannot skip a version', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 2, 0, 0, 0, false), // make request to oracle (new price)
            STARTING_TIME + 1,
          )

          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.requests(2)).to.be.equal(STARTING_TIME + 1)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 1, VAA, {
              value: 1,
            }),
          ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('cannot skip a version if the grace period has expired', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 2, 0, 0, 0, false), // make request to oracle (new price)
            STARTING_TIME + 60,
          )
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.requests(2)).to.be.equal(STARTING_TIME + 60)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          await expect(
            pythOracleFactory
              .connect(user)
              .commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
                value: 1,
              }),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('commits unincentivized if there are no requested or committed versions, does not incentivize keeper, updates latest', async () => {
          await time.increase(1)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
          const version = await keeperOracle.connect(user).at(STARTING_TIME)
          expect(version[0].valid).to.be.true
          expect(version[0].price).to.equal('1838167031')

          // Didn't incentivize keeper
          expect(await dsu.balanceOf(user.address)).to.be.equal(utils.parseEther('200000'))

          expect(await keeperOracle.connect(user).latest()).to.deep.equal(version[0])
        })

        it('reverts if not called from factory', async () => {
          await expect(
            keeperOracle
              .connect(user)
              .commit({ timestamp: STARTING_TIME, price: parse6decimal('1000'), valid: true }, user.address, 1),
          ).to.be.revertedWithCustomError(keeperOracle, 'InstanceNotFactoryError')
        })

        it('reverts if version is zero', async () => {
          await expect(
            keeperOracle.connect(factorySigner).commit({ timestamp: 0, price: 0, valid: false }, user.address, 1),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('can commit if there are requested versions but no committed versions', async () => {
          await time.increase(30)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false) // make request to oracle (new price)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
        })

        it('can commit if there are committed versions but no requested versions', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
          await time.increase(60)
          await pythOracleFactory
            .connect(user)
            .commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
              value: 1,
            })
        })

        it('can commit if there are committed versions and requested versions', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          await time.increase(1)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, { value: 1 })
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 2, 0, 0, 0, false), // make request to oracle (new price)
            1686199141,
          )
          const secondRequestedVersion = await time.currentBlockTimestamp()
          const nonRequestedOracleVersion = STARTING_TIME + 60
          await pythOracleFactory
            .connect(user)
            .commit([PYTH_ETH_USD_PRICE_FEED], nonRequestedOracleVersion, VAA_AFTER_EXPIRATION, {
              value: 1,
            })
          expect((await keeperOracle.connect(user).latest()).timestamp).to.equal(nonRequestedOracleVersion)

          await pythOracleFactory
            .connect(user)
            .commit([PYTH_ETH_USD_PRICE_FEED], secondRequestedVersion, VAA_WAY_AFTER_EXPIRATION, {
              value: 1,
            })
          expect((await keeperOracle.connect(user).latest()).timestamp).to.equal(secondRequestedVersion)
        })

        it('cannot commit invalid VAAs for the oracle version', async () => {
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME - 60, VAA, {
              value: 1,
            }),
          ).to.reverted
        })

        it('must be more recent than the most recently committed version', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME + 2,
          )
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 2, VAA, {
            value: 1,
          })

          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 1, OTHER_VAA, {
              value: 1,
            }),
          ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('does not commitRequested if oracleVersion is incorrect', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME + 1,
          )
          // Base fee isn't working properly in coverage, so we need to set it manually
          await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
            gasPrice: 100000000,
          })

          // Keeper isn't incentivized because we did not go through commitRequested
          expect(await dsu.balanceOf(user.address)).to.be.equal(utils.parseEther('200000').sub(utils.parseEther('10')))
        })

        it('can commit multiple non-requested versions, as long as they are in order', async () => {
          await time.increase(1)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
          await time.increase(60)
          await pythOracleFactory
            .connect(user)
            .commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
              value: 1,
            })
        })

        it('cant commit non-requested version until after an invalid has passed grace period', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect((await keeperOracle.global()).latestIndex).to.equal(0)

          await time.increase(59)
          await expect(
            pythOracleFactory
              .connect(user)
              .commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
                value: 1,
              }),
          ).to.be.reverted
        })

        it('can commit non-requested version after an invalid', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect((await keeperOracle.global()).latestIndex).to.equal(0)

          await time.increase(60)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, '0x')
          await pythOracleFactory
            .connect(user)
            .commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 60, VAA_AFTER_EXPIRATION, {
              value: 1,
            })
          expect((await keeperOracle.latest()).timestamp).to.equal(STARTING_TIME + 60)
          expect((await keeperOracle.global()).latestIndex).to.equal(1)

          expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
              value: 1,
            }),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('reverts if committing invalid non-requested version', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ),
            STARTING_TIME,
          )
          expect((await keeperOracle.global()).latestIndex).to.equal(0)

          await time.increase(60)
          await expect(
            pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME - 1, '0x'),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
        })

        it('can update multiple payoffs from single update', async () => {
          await time.includeAt(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false)
            await market2
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false)
          }, STARTING_TIME)

          expect(await keeperOracle.localCallbacks(STARTING_TIME)).to.deep.eq([user.address])
          expect(await keeperOracle2.localCallbacks(STARTING_TIME)).to.deep.eq([user.address])

          await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
          await expect(
            pythOracleFactory
              .connect(user)
              .commit(
                [PYTH_ETH_USD_PRICE_FEED, '0x0000000000000000000000000000000000000000000000000000000000000021'],
                STARTING_TIME,
                VAA,
                {
                  value: 1,
                  maxFeePerGas: 100000000,
                },
              ),
          )
            .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
            .withArgs({ timestamp: STARTING_TIME, price: '1838167031', valid: true })
            .to.emit(keeperOracle2, 'OracleProviderVersionFulfilled')
            .withArgs({ timestamp: STARTING_TIME, price: '3378858036', valid: true })

          const reward = utils.parseEther('0.370586')
          expect(await dsu.balanceOf(user.address)).to.be.equal(
            utils.parseEther('200000').sub(utils.parseEther('20')).add(reward.mul(2)),
          )

          expect((await market.position()).timestamp).to.equal(STARTING_TIME)
          expect((await market2.position()).timestamp).to.equal(STARTING_TIME)
        })
      })

      describe('#settle', async () => {
        it('settles successfully and incentivizes the keeper', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ), // make request to oracle (new price)
            STARTING_TIME,
          )
          // Base fee isn't working properly in coverage, so we need to set it manually
          await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
          const balanceBeforeCommit = await dsu.balanceOf(user.address)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
            maxFeePerGas: 100000000,
          })
          expect((await market.position()).timestamp).to.equal(STARTING_TIME)
          // ensure keeper was compensated for committing a price
          const balanceBeforeSettle = await dsu.balanceOf(user.address)
          expect(balanceBeforeSettle.sub(balanceBeforeCommit)).to.equal(utils.parseEther('0.370586'))

          await expect(
            pythOracleFactory.connect(user).settle([PYTH_ETH_USD_PRICE_FEED], [STARTING_TIME], [1], {
              maxFeePerGas: 100000000,
            }),
          ).to.emit(keeperOracle, 'CallbackFulfilled')
          // .withArgs([market.address, user.address, STARTING_TIME]) cannot parse indexed tuples in events

          expect((await market.positions(user.address)).timestamp).to.equal(STARTING_TIME)
          // ensure keeper was compensated for settling
          expect((await dsu.balanceOf(user.address)).sub(balanceBeforeSettle)).to.equal(utils.parseEther('0.129155'))
        })

        it('reverts if array lengths mismatch', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ), // make request to oracle (new price)
            STARTING_TIME,
          )
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })

          await expect(
            pythOracleFactory.connect(user).settle([PYTH_ETH_USD_PRICE_FEED], [STARTING_TIME, STARTING_TIME], [1]),
          ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryInvalidSettleError')

          await expect(
            pythOracleFactory.connect(user).settle([PYTH_ETH_USD_PRICE_FEED], [STARTING_TIME], [1, 1]),
          ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryInvalidSettleError')
        })

        it('reverts if calldata is ids is empty', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ), // make request to oracle (new price)
            STARTING_TIME,
          )
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })

          await expect(pythOracleFactory.connect(user).settle([], [], [])).to.be.revertedWithCustomError(
            pythOracleFactory,
            'KeeperFactoryInvalidSettleError',
          )
        })
      })

      describe('#status', async () => {
        it('returns the correct versions', async () => {
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false) // make request to oracle (new price)
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
          const [latestIndex, currentIndex] = await keeperOracle.status()
          expect(latestIndex.valid).to.be.true
          expect(latestIndex.price).to.equal('1838167031')
          expect(currentIndex).to.equal(await time.currentBlockTimestamp())
        })
      })

      describe('#request', async () => {
        it('can request a version', async () => {
          // No requested versions
          expect((await keeperOracle.global()).currentIndex).to.equal(0)
          await expect(
            time.includeAt(
              async () =>
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    1,
                    0,
                    0,
                    parse6decimal('10'),
                    false,
                  ), // make request to oracle (new price)
              STARTING_TIME,
            ),
          )
            .to.emit(keeperOracle, 'OracleProviderVersionRequested')
            .withArgs('1686198981', true)
          // Now there is exactly one requested version
          expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
          expect((await keeperOracle.global()).currentIndex).to.equal(1)
        })

        it('can request a version w/ granularity', async () => {
          const parameter = await pythOracleFactory.parameter()
          await pythOracleFactory.updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)

          // No requested versions
          expect((await keeperOracle.global()).currentIndex).to.equal(0)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false) // make request to oracle (new price)
          const currentTimestamp = await pythOracleFactory.current()

          // Now there is exactly one requested version
          expect(await keeperOracle.requests(1)).to.be.equal(currentTimestamp)
          expect((await keeperOracle.global()).currentIndex).to.equal(1)
        })

        it('does not allow unauthorized instances to request', async () => {
          const badInstance = await smock.fake<IInstance>('IInstance')
          const badFactory = await smock.fake<IFactory>('IFactory')
          badInstance.factory.returns(badFactory.address)
          badFactory.instances.returns(true)
          const badSigner = await impersonateWithBalance(badInstance.address, utils.parseEther('10'))

          await expect(
            keeperOracle.connect(badSigner).request(market.address, user.address),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleNotOracleError')
        })

        it('a version can only be requested once (new, new)', async () => {
          await ethers.provider.send('evm_setAutomine', [false])
          await ethers.provider.send('evm_setIntervalMining', [0])

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false) // make request to oracle (new price)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 2, 0, 0, 0, false) // make request to oracle (new price)

          await ethers.provider.send('evm_mine', [])

          const currentTimestamp = await pythOracleFactory.current()
          expect(await keeperOracle.requests(1)).to.be.equal(currentTimestamp)
          expect(await keeperOracle.requests(2)).to.be.equal(0)
        })
      })

      describe('#latest', async () => {
        it('returns the latest version', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ), // make request to oracle (new price)
            STARTING_TIME,
          )
          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME, VAA, {
            value: 1,
          })
          const latestValue = await keeperOracle.connect(user).latest()
          expect(latestValue.valid).to.be.true
          expect(latestValue.price).to.equal('1838167031')
        })
      })

      describe('#current', async () => {
        it('returns the current timestamp', async () => {
          expect(await keeperOracle.connect(user).current()).to.equal(await time.currentBlockTimestamp())
        })

        it('returns the current timestamp w/ granularity == 0', async () => {
          const parameter = await pythOracleFactory.parameter()
          await expect(
            pythOracleFactory
              .connect(owner)
              .updateParameter(0, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperOracleParameterStorageInvalidError')
        })

        it('returns the current timestamp w/ granularity > MAX', async () => {
          const parameter = await pythOracleFactory.parameter()
          await expect(
            pythOracleFactory
              .connect(owner)
              .updateParameter(10001, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryInvalidParameterError')
          await expect(
            pythOracleFactory
              .connect(owner)
              .updateParameter(10000, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.not.reverted
        })

        it('returns the current timestamp w/ fresh granularity > 1', async () => {
          const parameter = await pythOracleFactory.parameter()
          await pythOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)

          const parameter2 = await pythOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(1)
          expect(parameter2.currentGranularity).to.equal(10)
          expect(parameter2.effectiveAfter).to.equal(await time.currentBlockTimestamp())

          expect(await keeperOracle.connect(user).current()).to.equal(await time.currentBlockTimestamp())
        })

        it('returns the current timestamp w/ settled granularity > 1', async () => {
          const parameter = await pythOracleFactory.parameter()
          expect(parameter.latestGranularity).to.equal(1)
          expect(parameter.currentGranularity).to.equal(1)
          expect(parameter.effectiveAfter).to.equal(STARTING_TIME - 1)

          await pythOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)

          const parameter2 = await pythOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(1)
          expect(parameter2.currentGranularity).to.equal(10)
          expect(parameter2.effectiveAfter).to.equal(await time.currentBlockTimestamp())

          await time.increase(1)

          expect(await keeperOracle.connect(user).current()).to.equal(
            Math.ceil((await time.currentBlockTimestamp()) / 10) * 10,
          )
        })

        it('returns the current timestamp w/ fresh + fresh granularity > 1', async () => {
          const parameter = await pythOracleFactory.parameter()
          await pythOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          // hardhat automatically moves 1 second ahead so we have to do this twice
          await pythOracleFactory
            .connect(owner)
            .updateParameter(100, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          await expect(
            pythOracleFactory
              .connect(owner)
              .updateParameter(1000, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.revertedWithCustomError(pythOracleFactory, 'KeeperFactoryInvalidParameterError')
        })

        it('returns the current timestamp w/ settled + fresh granularity > 1', async () => {
          const parameter = await pythOracleFactory.parameter()
          await pythOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          await time.increase(1)

          await pythOracleFactory
            .connect(owner)
            .updateParameter(100, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          const parameter2 = await pythOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(10)
          expect(parameter2.currentGranularity).to.equal(100)
          expect(parameter2.effectiveAfter).to.equal(Math.ceil((await time.currentBlockTimestamp()) / 10) * 10)

          expect(await keeperOracle.connect(user).current()).to.equal(
            Math.ceil((await time.currentBlockTimestamp()) / 10) * 10,
          )
        })

        it('returns the current timestamp w/ settled + settled granularity > 1', async () => {
          const parameter = await pythOracleFactory.parameter()
          await pythOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          await time.increase(1)

          await pythOracleFactory
            .connect(owner)
            .updateParameter(100, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          const parameter2 = await pythOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(10)
          expect(parameter2.currentGranularity).to.equal(100)
          expect(parameter2.effectiveAfter).to.equal(Math.ceil((await time.currentBlockTimestamp()) / 10) * 10)

          const previousCurrent = Math.ceil((await time.currentBlockTimestamp()) / 10) * 10
          await time.increase(previousCurrent - (await time.currentBlockTimestamp()) + 1)

          expect(await keeperOracle.connect(user).current()).to.equal(
            Math.ceil((await time.currentBlockTimestamp()) / 100) * 100,
          )
        })
      })

      describe('#atVersion', async () => {
        it('returns the correct version', async () => {
          const parameter = await pythOracleFactory.parameter()
          await pythOracleFactory
            .connect(owner)
            .updateParameter(1, parse6decimal('0.1'), parameter.validFrom, parameter.validTo)
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  1,
                  0,
                  0,
                  parse6decimal('10'),
                  false,
                ), // make request to oracle (new price)
            STARTING_TIME + 1,
          )

          await pythOracleFactory.connect(user).commit([PYTH_ETH_USD_PRICE_FEED], STARTING_TIME + 1, VAA, {
            value: 1,
          })
          const reward = utils.parseUnits('0.073476', 6)
          const version = await keeperOracle.connect(user).at(STARTING_TIME + 1)
          expect(version[0].price).to.equal('1838167031')
          expect(version[0].valid).to.equal(true)
          expect(version[1].settlementFee).to.be.within(1, utils.parseUnits('0.1', 6))
          expect(version[1].oracleFee).to.equal(parse6decimal('0.1'))
        })

        it('returns invalid version if that version was not requested', async () => {
          const version = await keeperOracle.connect(user).at(STARTING_TIME)
          expect(version[0].valid).to.be.false
        })

        it('returns invalid version if that version was requested but not committed', async () => {
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, parse6decimal('10'), false) // make request to oracle (new price)
          const version = await keeperOracle.connect(user).at(STARTING_TIME)
          expect(version[0].valid).to.be.false
        })
      })
    })
  })
})
