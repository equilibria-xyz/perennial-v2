import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { utils } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import {
  IERC20Metadata,
  MultiInvoker,
  Oracle,
  OracleFactory,
  Oracle__factory,
  PythFactory,
  PythFactory__factory,
  PythOracle,
  PythOracle__factory,
} from '../../../types/generated'

import { InstanceVars, createInvoker, deployProtocol } from '../helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_HOLDER = '0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd'

const STARTING_TIME = 1686198973

// This VAA has timestamp 1686198987 (STARTING_TIME + 14)
const VAA =
  '0x01000000030d0046d9570837d4d2cfcc50fd3346bf18df10179011a1e125e27467bb47bc26f8ce194ed59b48793f4dec9dc919f2e22d43e33fe6ac263980da08f502b894e0fe6f00026a8d75df8f46b144e48ebf6bd6a63267e90dafe353021bbecb9909b0bef0434e56f696870e41ce16b9b8b40c22548815c5fe157915cd08366cb439c5eb51029001040c1775df612c74d4e18da4daa0f42b8953d92340aadf757b6b6ee1e549d1ddfe0115628a360168a23a05684afa5389dd75c431eb5228aaa528de450aae38a50f01084aeacdb58103612ab202ac887d53dc14cd10c4e7d788f95685e0944fb919f8ec64b5cdaa4ede600a9f89ed9aaa3be86facac6ede2ed08760101f6c5c23ce6b29010a2847bd95a0dd2d14302ee732f8f3547ea7e1bfcc9f258ab07d33ca9c62fc837621e8a7dcdb41b06db6f8e768e7e5510f3954029fcdf6e8f3d6b4072da73b51ae010b3a693388722a579f8e7ce44bceb0fac79a4dffbd1076b99a79c55286cc2cf28f2feda95aaf1823f6da2922d9f675619931107bd0538e9dbd53025463a95f2b7b010c732680bb2ba4843b67ba4c493d29cbfe737729cb872aec4ac9b8d83eb0fec898556d02bdeae8995870dc6e75187feacc9b9f714ddd9d97ba5a5abbe07d8884f2010debe8a41fe1715b27fbf2aba19e9564bb4e0bde1fc29412c69347950d216a201130e301f43a5aeec8e7464c9839a114e22efe65d49128b4908b9fa618476cc519010e33495ea1a8df32bc3e7e6f353a4d0371e8d5538e33e354e56784e2877f3765ef5e774abb0c50973686f8236adf5979225ff6f6c68ed942197f40c4fed59331bc010fead2505d4be9161ab5a8da9ed0718afd1ddf0b7905db57997a1ed4741d9d326840e193b84e115eba6256ed910e12e10f68c4563b6abaae211eaac5c0416d1f9601108eddcab6c9952dc0da91900a35821ef75818a5f3898721fd05ff708597c19d5e573f2b63674989365ca9fee0dd660566afaec135230d978e66ee4106c263b124011164788fde3bcf11e6773308a3732a0f0bd73b6876789c2b01f2bbaf84473be6ec2b7a3884d117adc625cbf48710c238d9c122a5f64f283685d9c66f3656d79d4d001247f246ba17092100f8bfc1e93822ad3d07561697ac90d4ebf3d371fce17e399246b18f85b52f74157240cdf16da4bde72146cf0cb976c39a2d6958d7b55773f70064815acc00000000001af8cd23c2ab91237730770bbea08d61005cdda0984348f3f6eecb559638c0bba0000000001b8413740150325748000300010001020005009d04028fba493a357ecde648d51375a445ce1cb9681da1ea11e562b53522a5d3877f981f906d7cfe93f618804f1de89e0199ead306edc022d3230b3e8305f391b00000002aa3fa23ae00000000117b5092fffffff80000002a9cdd1528000000000f4ab712010000000a0000000c0000000064815acc0000000064815acb0000000064815acb0000002aa3fa23ae00000000117b50920000000064815acbe6c020c1a15366b779a8c870e065023657c88c82b82d58a9fe856896a4034b0415ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce57170000002c5ffd594000000000086bfba4fffffff80000002c55aaa600000000000a73c7010100000007000000080000000064815acc0000000064815acb0000000064815acb0000002c5ffd594000000000086bfba40000000064815acbc67940be40e0cc7ffaa1acb08ee3fab30955a197da1ec297ab133d4d43d86ee6ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace0000002acc544cc90000000006747a77fffffff80000002ac4a4eba8000000000456d9f30100000017000000200000000064815acc0000000064815acb0000000064815acb0000002acc544cc90000000006747a770000000064815acb8d7c0971128e8a4764e757dedb32243ed799571706af3a68ab6a75479ea524ff846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b50000002ac880a3200000000010e67139fffffff80000002abc130ec0000000001b3bcc6401000000090000000a0000000064815acc0000000064815acb0000000064815acb0000002ac880a3200000000010e671390000000064815acb543b71a4c292744d3fcf814a2ccda6f7c00f283d457f83aa73c41e9defae034ba0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe1300000000000000000000000000000000fffffff8000000000000000000000000000000000000000000000000080000000064815acc0000000064815aca0000000000000000000000000000000000000000000000000000000000000000'

describe('PythOracle', () => {
  let instanceVars: InstanceVars
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let oracle: Oracle
  let pythOracle: PythOracle
  let pythOracleFactory: PythFactory
  let oracleFactory: OracleFactory
  let dsu: IERC20Metadata
  let oracleSigner: SignerWithAddress
  let multiInvoker: MultiInvoker

  beforeEach(async () => {
    await time.reset(17433260)

    instanceVars = await deployProtocol()
    ;({ dsu, oracleFactory, owner, user } = instanceVars)

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

    multiInvoker = await createInvoker(instanceVars)
    await time.increaseTo(STARTING_TIME - 1)
    // block.timestamp of the next call will be STARTING_TIME (1686198973)
  })

  describe('PerennialAction.COMMIT_PRICE', async () => {
    it('commits a requested pyth version', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
      await pythOracle.connect(oracleSigner).request(user.address)

      // Base fee isn't working properly in coverage, so we need to set it manually
      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
      await multiInvoker.connect(user).invoke(
        [
          {
            action: 6,
            args: utils.defaultAbiCoder.encode(
              ['address', 'uint256', 'bytes'],
              [pythOracle.address, STARTING_TIME, VAA],
            ),
          },
        ],
        {
          value: 1,
          gasPrice: 10000,
        },
      )

      expect((await pythOracle.callStatic.latest()).timestamp).to.equal(STARTING_TIME)
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
      expect(newDSUBalance.sub(originalDSUBalance)).to.be.greaterThan(0)
    })

    it('commits a non-requested pyth version', async () => {
      const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)

      // Base fee isn't working properly in coverage, so we need to set it manually
      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
      await multiInvoker.connect(user).invoke(
        [
          {
            action: 6,
            args: utils.defaultAbiCoder.encode(
              ['address', 'uint256', 'bytes'],
              [pythOracle.address, STARTING_TIME, VAA],
            ),
          },
        ],
        {
          value: 1,
          gasPrice: 10000,
        },
      )

      expect((await pythOracle.callStatic.latest()).timestamp).to.equal(STARTING_TIME)
      const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
      expect(newDSUBalance.sub(originalDSUBalance)).to.equal(0)
    })
  })
})
