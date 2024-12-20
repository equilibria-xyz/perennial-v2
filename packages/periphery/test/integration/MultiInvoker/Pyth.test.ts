import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '../../../../common/testutil'
import { parse6decimal } from '../../../../common/testutil/types'
import HRE from 'hardhat'

import {
  GasOracle__factory,
  IERC20Metadata,
  KeeperOracle,
  Market,
  MultiInvoker,
  Oracle,
  OracleFactory,
  PythFactory,
} from '../../../types/generated'
import { InstanceVars, PythVAAVars } from './setupHelpers'
import { createMarket } from '../../helpers/marketHelpers'
import { PYTH_ETH_USD_PRICE_FEED } from '../../helpers/oracleHelpers'
import { AggregatorV3Interface__factory } from '@perennial/v2-oracle/types/generated'
const { ethers } = HRE

export function RunPythOracleTests(
  getFixture: () => Promise<InstanceVars>,
  createInvoker: (instanceVars: InstanceVars) => Promise<MultiInvoker>,
  getKeeperOracle: () => Promise<[PythFactory, KeeperOracle]>,
  fundWalletDSU: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  vaas: PythVAAVars,
): void {
  describe('PythOracleFactory', () => {
    let instanceVars: InstanceVars
    let vaaVars: PythVAAVars
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let oracle: Oracle
    let keeperOracle: KeeperOracle
    let pythOracleFactory: PythFactory
    let oracleFactory: OracleFactory
    let dsu: IERC20Metadata
    let dsuBalanceBefore: BigNumber
    let multiInvoker: MultiInvoker
    let market: Market

    const fixture = async () => {
      instanceVars = await getFixture()
      vaaVars = vaas
      dsu = instanceVars.dsu
      oracleFactory = instanceVars.oracleFactory
      owner = instanceVars.owner
      user = instanceVars.user

      await oracleFactory.updateParameter({
        maxGranularity: 1,
        maxSyncFee: parse6decimal('1'),
        maxAsyncFee: parse6decimal('1'),
        maxOracleFee: parse6decimal('0.5'),
      })
      ;[pythOracleFactory, keeperOracle] = await getKeeperOracle()
      oracle = instanceVars.oracle

      await fundWalletDSU(owner, utils.parseEther('100000'))
      await dsu.connect(owner).transfer(oracleFactory.address, utils.parseEther('100000'))

      multiInvoker = await createInvoker(instanceVars)
      market = await createMarket(owner, instanceVars.marketFactory, dsu, oracle, undefined, undefined, {
        maxFeePerGas: 100000000,
      })

      await dsu.connect(user).approve(market.address, utils.parseEther('200000'))
      await keeperOracle.register(oracle.address)
      await oracle.connect(owner).register(market.address)

      await pythOracleFactory.commit([PYTH_ETH_USD_PRICE_FEED], vaaVars.startingTime - 3, vaaVars.vaaValid, {
        value: 1,
      })
      // block.timestamp of the next call will be vaaVars.startingTime
      await time.increaseTo(vaaVars.startingTime - 5)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
      dsuBalanceBefore = await dsu.balanceOf(user.address)
    })

    describe('PerennialAction.COMMIT_PRICE', async () => {
      it('commits a requested pyth version', async () => {
        const deposit = parse6decimal('1000')
        await dsu.connect(user).approve(instanceVars.margin.address, constants.MaxUint256)
        await expect(instanceVars.margin.connect(user).deposit(user.address, deposit)).to.not.be.reverted
        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 1, 0, 0, deposit, false),
          vaaVars.startingTime,
        )

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        await multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
          [
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [pythOracleFactory.address, 1, [PYTH_ETH_USD_PRICE_FEED], vaaVars.startingTime, vaaVars.vaaValid, true],
              ),
            },
          ],
          {
            value: 1,
            gasPrice: 10000,
          },
        )

        // calculate syncFee rewarded to caller
        const commitmentGasOracle = GasOracle__factory.connect(await pythOracleFactory.commitmentGasOracle(), owner)
        const chanlinkEthFeed = AggregatorV3Interface__factory.connect(await commitmentGasOracle.FEED(), owner)
        const etherPrice = (await chanlinkEthFeed.latestRoundData()).answer
        // decimals: 1e18 baseFee * 1e8 ethPrice -> 1e26, divide by 1e4 twice -> 1e18, then round up to UFixed6
        const reward = BigNumber.from(8273920000).div(1e4).mul(etherPrice.div(1e4)).add(1e12).div(1e12).mul(1e12)

        expect((await keeperOracle.callStatic.latest()).timestamp).to.equal(vaaVars.startingTime)
        expect(await dsu.balanceOf(user.address)).to.be.eq(dsuBalanceBefore.sub(utils.parseEther('1000')).add(reward))
      })

      it('commits a non-requested pyth version', async () => {
        await time.increase(1)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        await multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
          [
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [pythOracleFactory.address, 1, [PYTH_ETH_USD_PRICE_FEED], vaaVars.startingTime, vaaVars.vaaValid, true],
              ),
            },
          ],
          {
            value: 1,
            gasPrice: 10000,
          },
        )

        expect((await keeperOracle.callStatic.latest()).timestamp).to.equal(vaaVars.startingTime)
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        expect(newDSUBalance.sub(dsuBalanceBefore)).to.equal(0)
      })

      it('only passes through value specified', async () => {
        await time.increase(1)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        await expect(
          multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
            [
              {
                action: 6,
                args: utils.defaultAbiCoder.encode(
                  ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                  [
                    pythOracleFactory.address,
                    0,
                    [PYTH_ETH_USD_PRICE_FEED],
                    vaaVars.startingTime,
                    vaaVars.vaaValid,
                    true,
                  ],
                ),
              },
            ],
            {
              value: 1,
              gasPrice: 10000,
            },
          ),
        ).to.be.revertedWithoutReason
      })

      it('commits a non-requested pyth version w/o revert on failure', async () => {
        await time.increase(1)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        await multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
          [
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [pythOracleFactory.address, 1, [PYTH_ETH_USD_PRICE_FEED], vaaVars.startingTime, vaaVars.vaaValid, true],
              ),
            },
          ],
          {
            value: 1,
            gasPrice: 10000,
          },
        )

        expect((await keeperOracle.callStatic.latest()).timestamp).to.equal(vaaVars.startingTime)
        expect(await dsu.balanceOf(user.address)).to.be.eq(dsuBalanceBefore)
      })

      it('doesnt revert on commit failure w/o revert on failure', async () => {
        await time.increase(1)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        await expect(
          multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
            [
              {
                action: 6,
                args: utils.defaultAbiCoder.encode(
                  ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                  [
                    pythOracleFactory.address,
                    1,
                    [PYTH_ETH_USD_PRICE_FEED],
                    vaaVars.startingTime + 60,
                    vaaVars.vaaValid,
                    false,
                  ],
                ),
              },
            ],
            {
              value: 1,
              gasPrice: 10000,
            },
          ),
        ).to.be.not.reverted
      })

      it('soft reverts a bad commit and returns the msg.value to sender on failure', async () => {
        await time.increase(1)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        await expect(
          multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
            [
              {
                action: 6,
                args: utils.defaultAbiCoder.encode(
                  ['address', 'uint256', 'bytes32[]', 'uint256', 'uint256', 'bytes', 'bool'],
                  [
                    pythOracleFactory.address,
                    1,
                    [PYTH_ETH_USD_PRICE_FEED],
                    0,
                    vaaVars.startingTime + 60,
                    vaaVars.vaaInvalid,
                    true,
                  ],
                ),
              },
            ],
            {
              value: 1,
              gasPrice: 10000,
            },
          ),
        ).to.be.reverted

        const startingBalance = await user.getBalance()
        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1000'])
        const tx = await multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
          [
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [
                  pythOracleFactory.address,
                  1,
                  [PYTH_ETH_USD_PRICE_FEED],
                  vaaVars.startingTime + 60,
                  vaaVars.vaaInvalid,
                  false,
                ],
              ),
            },
          ],
          {
            value: 1,
            gasPrice: 10000,
          },
        )
        expect(tx).to.not.be.reverted
        const receipt = await tx.wait()

        expect(startingBalance.sub(receipt.gasUsed.mul(10000))).to.be.eq(await user.getBalance())
      })

      it('does soft revert refund outside of invoke loop to allow for successful commits after failed ones', async () => {
        await time.increase(1)

        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)

        await multiInvoker.connect(user)['invoke((uint8,bytes)[])'](
          [
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [
                  pythOracleFactory.address,
                  1,
                  [PYTH_ETH_USD_PRICE_FEED],
                  vaaVars.startingTime + 60,
                  vaaVars.vaaInvalid,
                  false,
                ],
              ),
            },
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [
                  pythOracleFactory.address,
                  1,
                  [PYTH_ETH_USD_PRICE_FEED],
                  vaaVars.startingTime + 60,
                  vaaVars.vaaInvalid,
                  false,
                ],
              ),
            },
            {
              action: 6,
              args: utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'bytes32[]', 'uint256', 'bytes', 'bool'],
                [pythOracleFactory.address, 1, [PYTH_ETH_USD_PRICE_FEED], vaaVars.startingTime, vaaVars.vaaValid, true],
              ),
            },
          ],
          {
            value: 1,
            maxFeePerGas: 100000000,
          },
        )

        expect((await keeperOracle.callStatic.latest()).timestamp).to.equal(vaaVars.startingTime)
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        expect(newDSUBalance.sub(originalDSUBalance)).to.equal(0)
      })
    })
  })
}
