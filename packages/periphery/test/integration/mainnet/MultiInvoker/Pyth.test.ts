import { expect } from 'chai'
import { BigNumber, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '../../../../../common/testutil'
import { parse6decimal } from '../../../../../common/testutil/types'
import HRE from 'hardhat'

import {
  IERC20Metadata,
  KeeperOracle,
  Market,
  MultiInvoker,
  Oracle,
  OracleFactory,
  PythFactory,
} from '../../../../types/generated'
import { InstanceVars, PythVAAVars } from './setupHelpers'
import { createMarket } from '../../../helpers/marketHelpers'
import { PYTH_ETH_USD_PRICE_FEED } from '../../../helpers/oracleHelpers'
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
      // TODO: check Arbitrum implementation to ensure correct oracle is being assigned to instanceVars
      // oracle = Oracle__factory.connect(instanceVars.oracle.address, owner)
      owner = instanceVars.owner
      user = instanceVars.user

      await oracleFactory.updateParameter({
        maxGranularity: 1,
        maxSettlementFee: parse6decimal('1.5'),
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
        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('1000'),
                false,
              ),
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

        const reward = utils.parseEther('0.000016')
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
