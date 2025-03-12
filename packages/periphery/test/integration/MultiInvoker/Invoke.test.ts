import { ethers } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import {
  IMargin,
  IMarket,
  IVault,
  IVaultFactory,
  MultiInvoker,
  IOracleProvider,
  IMultiInvoker,
  VaultFactory,
  MakerVault__factory,
  SolverVault__factory,
} from '../../../types/generated'
import { InstanceVars, createVault, resetSubOracle } from './setupHelpers'

import {
  Actions,
  buildApproveTarget,
  buildClaimFee,
  buildUpdateIntent,
  buildUpdateMarket,
  buildUpdateVault,
} from '../../helpers/MultiInvoker/invoke'

import {
  DEFAULT_GUARANTEE,
  DEFAULT_ORDER,
  expectOrderEq,
  OracleReceipt,
  parse6decimal,
} from '../../../../common/testutil/types'
import { IERC20Metadata } from '@perennial/v2-core/types/generated'
import { createMarket } from '../../helpers/marketHelpers'
import { OracleVersionStruct } from '@perennial/v2-oracle/types/generated/contracts/Oracle'
import { currentBlockTimestamp } from '../../../../common/testutil/time'

use(smock.matchers)

const LEGACY_ORACLE_DELAY = 3600
const PRICE = utils.parseEther('3535.533906') // 113.882975  // 125.000000

export function RunInvokerTests(
  getFixture: () => Promise<InstanceVars>,
  createInvoker: (
    instanceVars: InstanceVars,
    makerVaultFactory?: VaultFactory,
    solverVaultFactory?: VaultFactory,
    withBatcher?: boolean,
  ) => Promise<MultiInvoker>,
  fundWalletDSU: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  fundWalletUSDC: (wallet: SignerWithAddress, amount: BigNumber) => Promise<void>,
  advanceToPrice: (price?: BigNumber, withPayoff?: boolean) => Promise<void>,
  initialOracleVersionEth: OracleVersionStruct,
  initialOracleVersionBtc: OracleVersionStruct,
): void {
  describe('Invoke', () => {
    let instanceVars: InstanceVars
    let multiInvoker: MultiInvoker
    let market: IMarket
    let makerVault: IVault
    let solverVault: IVault
    let makerVaultFactory: IVaultFactory
    let solverVaultFactory: IVaultFactory
    let makerEthSubOracle: FakeContract<IOracleProvider>
    let makerBtcSubOracle: FakeContract<IOracleProvider>
    let solverEthSubOracle: FakeContract<IOracleProvider>
    let solverBtcSubOracle: FakeContract<IOracleProvider>
    let withBatcher: boolean

    async function updateVaultOracle(
      newEthPrice?: BigNumber,
      newPriceBtc?: BigNumber,
      newEthReceipt?: OracleReceipt,
      newBtcReceipt?: OracleReceipt,
    ) {
      await _updateVaultOracle(makerEthSubOracle, newEthPrice, newEthReceipt)
      await _updateVaultOracle(makerBtcSubOracle, newPriceBtc, newBtcReceipt)
      await _updateVaultOracle(solverEthSubOracle, newEthPrice, newEthReceipt)
      await _updateVaultOracle(solverBtcSubOracle, newPriceBtc, newBtcReceipt)
    }

    async function _updateVaultOracle(
      subOracle: FakeContract<IOracleProvider>,
      newPrice?: BigNumber,
      newReceipt?: OracleReceipt,
    ) {
      const [currentTimestamp, currentPrice] = await subOracle.latest()
      const [, currentReceipt] = await subOracle.at(currentTimestamp)
      const newVersion = {
        timestamp: currentTimestamp.add(LEGACY_ORACLE_DELAY),
        price: newPrice ?? currentPrice,
        valid: true,
      }
      subOracle.status.returns([newVersion, newVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
      subOracle.request.returns()
      subOracle.latest.returns(newVersion)
      subOracle.current.returns(newVersion.timestamp.add(LEGACY_ORACLE_DELAY))
      subOracle.at.whenCalledWith(newVersion.timestamp).returns([newVersion, newReceipt ?? currentReceipt])
    }

    const fixture = async () => {
      instanceVars = await getFixture()
      ;[makerVault, makerVaultFactory, makerEthSubOracle, makerBtcSubOracle] = await createVault(
        instanceVars,
        await new MakerVault__factory(instanceVars.owner).deploy(),
        initialOracleVersionEth,
        initialOracleVersionBtc,
      )
      ;[solverVault, solverVaultFactory, solverEthSubOracle, solverBtcSubOracle] = await createVault(
        instanceVars,
        await new SolverVault__factory(instanceVars.owner).deploy(),
        initialOracleVersionEth,
        initialOracleVersionBtc,
        '0x0000000000000000000000000000000000000000000000000000000000000003',
        '0x0000000000000000000000000000000000000000000000000000000000000004',
      )
      market = await createMarket(instanceVars.owner, instanceVars.marketFactory, instanceVars.oracle)
      await instanceVars.oracle.register(market.address)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
      // locks up if done within fixture
      multiInvoker = await createInvoker(instanceVars, makerVaultFactory, solverVaultFactory, true)
      // allow all accounts to interact with the vault
      await makerVault.connect(instanceVars.owner).updateAllowed(constants.AddressZero, true)
      await solverVault.connect(instanceVars.owner).updateAllowed(constants.AddressZero, true)
    })

    afterEach(async () => {
      resetSubOracle(makerEthSubOracle, initialOracleVersionEth)
      resetSubOracle(makerBtcSubOracle, initialOracleVersionBtc)
      resetSubOracle(solverEthSubOracle, initialOracleVersionEth)
      resetSubOracle(solverBtcSubOracle, initialOracleVersionBtc)
    })

    it('constructs correctly', async () => {
      const { usdc, dsu } = instanceVars

      expect(await multiInvoker.batcher()).to.eq(
        instanceVars.dsuBatcher ? instanceVars.dsuBatcher.address : constants.AddressZero,
      )
      expect(await multiInvoker.reserve()).to.eq(instanceVars.dsuReserve.address)
      expect(await multiInvoker.USDC()).to.eq(usdc.address)
      expect(await multiInvoker.DSU()).to.eq(dsu.address)
    })

    it('initializes correctly', async () => {
      const { owner, dsu, usdc, dsuBatcher, dsuReserve, chainlinkKeptFeed } = instanceVars

      if (dsuBatcher) {
        expect(await dsu.allowance(multiInvoker.address, dsuBatcher.address)).to.eq(ethers.constants.MaxUint256)
        expect(await dsu.allowance(multiInvoker.address, dsuBatcher.address)).to.eq(ethers.constants.MaxUint256)
      }
      expect(await usdc.allowance(multiInvoker.address, dsuReserve.address)).to.eq(ethers.constants.MaxUint256)
      expect(await usdc.allowance(multiInvoker.address, dsuReserve.address)).to.eq(ethers.constants.MaxUint256)

      await expect(multiInvoker.connect(owner).initialize(chainlinkKeptFeed.address)).to.be.revertedWithCustomError(
        multiInvoker,
        'InitializableAlreadyInitializedError',
      )
    })

    it('reverts on bad target approval', async () => {
      const { user, userB } = instanceVars

      await expect(
        multiInvoker.connect(user)['invoke((uint8,bytes)[])'](buildApproveTarget(userB.address)),
      ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
    })

    const testCases = [
      {
        context: 'From user',
        setup: async () => true,
        invoke: async (args: IMultiInvoker.InvocationStruct[]) => {
          const { user } = instanceVars
          return multiInvoker.connect(user)['invoke((uint8,bytes)[])'](args)
        },
      },
      {
        context: 'From delegate',
        setup: async () => {
          const { marketFactory, user, userD } = instanceVars
          await marketFactory.connect(user).updateOperator(userD.address, true)
        },
        invoke: async (args: IMultiInvoker.InvocationStruct[]) => {
          const { user, userD } = instanceVars
          return multiInvoker.connect(userD)['invoke(address,(uint8,bytes)[])'](user.address, args)
        },
      },
    ]

    const buildMarketUpdateAction = async ({
      market,
      makerDelta = BigNumber.from(0),
      longDelta = BigNumber.from(0),
      shortDelta = BigNumber.from(0),
      collateral = BigNumber.from(0),
      handleWrap,
      referrer,
      additiveFee,
    }: {
      market: IMarket
      makerDelta?: BigNumber
      longDelta?: BigNumber
      shortDelta?: BigNumber
      collateral?: BigNumber
      handleWrap?: boolean
      referrer?: string
      additiveFee?: BigNumber
    }): Promise<Actions> => {
      const { user, margin } = instanceVars
      collateral = collateral ?? (await margin.isolatedBalances(user.address, market.address)).mul(-1)

      return buildUpdateMarket({
        market: market.address,
        makerDelta: makerDelta,
        longDelta: longDelta,
        shortDelta: shortDelta,
        collateral: collateral,
        handleWrap: handleWrap,
        referrer: referrer,
        additiveFee: additiveFee,
      })
    }

    testCases.forEach(({ context: contextStr, setup, invoke }) => {
      context(contextStr, async () => {
        beforeEach(async () => {
          await setup()
        })

        describe('#happy path', async () => {
          const collateral = parse6decimal('1000')
          const dsuCollateral = collateral.mul(1e12)

          it('deposits into market', async () => {
            const { user, dsu, margin } = instanceVars

            const userBalanceBefore = await dsu.balanceOf(user.address)

            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral })))
              .to.emit(dsu, 'Transfer')
              .withArgs(user.address, multiInvoker.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, margin.address, dsuCollateral)

            expect(await margin.isolatedBalances(user.address, market.address)).to.eq(collateral)

            const userBalanceAfter = await dsu.balanceOf(user.address)
            expect(userBalanceBefore.sub(userBalanceAfter)).to.eq(dsuCollateral)
          })

          it('withdraws from market', async () => {
            const { user, dsu, margin } = instanceVars

            const userInitialBalance = await dsu.balanceOf(user.address)

            // deposit into market
            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted
            await expect(invoke(await buildMarketUpdateAction({ market: market, collateral: collateral }))).to.not.be
              .reverted

            const userBalanceBefore = await dsu.balanceOf(user.address)
            await expect(invoke(await buildMarketUpdateAction({ market: market, collateral: collateral.mul(-1) })))
              .to.emit(dsu, 'Transfer')
              .withArgs(margin.address, multiInvoker.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, user.address, dsuCollateral)

            const userBalanceAfter = await dsu.balanceOf(user.address)

            expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(dsuCollateral)
            expect(userBalanceAfter).to.eq(userInitialBalance)
          })

          withBatcher &&
            it('wraps USDC to DSU and deposits into market using BATCHER', async () => {
              const { user, usdc, dsu, dsuBatcher } = instanceVars

              const userBalanceBefore = await usdc.balanceOf(user.address)

              await usdc.connect(user).approve(multiInvoker.address, collateral)
              await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

              await expect(
                invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
              )
                .to.emit(usdc, 'Transfer')
                .withArgs(user.address, multiInvoker.address, collateral)
                .to.emit(dsuBatcher, 'Wrap')
                .withArgs(multiInvoker.address, dsuCollateral)

              const userBalanceAfter = await usdc.balanceOf(user.address)

              expect(userBalanceBefore.sub(userBalanceAfter).eq(collateral))
              expect(await dsu.balanceOf(market.address)).to.eq(dsuCollateral)
            })

          withBatcher &&
            it('wraps USDC to DSU and deposits into market using RESERVE if BATCHER balance < collateral', async () => {
              const { user, userB, usdc, dsu, dsuBatcher, dsuReserve } = instanceVars

              if (dsuBatcher) {
                // userB uses collateral - 1 from batcher wrap
                const drainBatcherByFixed6 = (await dsu.balanceOf(dsuBatcher.address))
                  .div(1e12)
                  .sub(collateral)
                  .add(parse6decimal('1'))
                await fundWalletUSDC(userB, drainBatcherByFixed6)

                await usdc.connect(userB).approve(multiInvoker.address, drainBatcherByFixed6)
                await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

                await expect(
                  multiInvoker
                    .connect(userB)
                    ['invoke((uint8,bytes)[])'](
                      buildUpdateMarket({ market: market.address, collateral: drainBatcherByFixed6, handleWrap: true }),
                    ),
                )
                  .to.emit(dsuBatcher, 'Wrap')
                  .withArgs(multiInvoker.address, drainBatcherByFixed6.mul(1e12))

                await usdc.connect(user).approve(multiInvoker.address, collateral)
                await expect(
                  invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
                )
                  .to.emit(dsuReserve, 'Mint')
                  .withArgs(multiInvoker.address, dsuCollateral, anyValue)
                  .to.emit(dsu, 'Transfer')
                  .withArgs(multiInvoker.address, market.address, dsuCollateral)
              }
            })

          it('wraps USDC to DSU and deposits into market using RESERVE if BATCHER address == 0', async () => {
            const { user, usdc, dsuReserve } = instanceVars

            // deploy multiinvoker with batcher == 0 address
            multiInvoker = await createInvoker(instanceVars, makerVaultFactory, solverVaultFactory, false)
            await setup()
            expect(await multiInvoker.batcher()).to.eq(constants.AddressZero)

            await usdc.connect(user).approve(multiInvoker.address, collateral)
            await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
            )
              .to.emit(dsuReserve, 'Mint')
              .withArgs(multiInvoker.address, dsuCollateral, anyValue)
          })

          withBatcher &&
            it('withdraws from market and unwraps DSU to USDC using BATCHER', async () => {
              const { user, userB, dsu, usdc, dsuBatcher } = instanceVars

              if (dsuBatcher) {
                const userUSDCBalanceBefore = await usdc.balanceOf(user.address)

                await fundWalletUSDC(userB, parse6decimal('1000'))
                await usdc.connect(userB).transfer(dsuBatcher.address, collateral)

                await fundWalletUSDC(user, parse6decimal('1000'))
                await usdc.connect(user).approve(multiInvoker.address, collateral)
                await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
                await invoke(buildApproveTarget(market.address))

                await expect(
                  invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
                ).to.not.be.reverted

                await expect(
                  await invoke(
                    buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true }),
                  ),
                )
                  .to.emit(dsu, 'Transfer')
                  .withArgs(market.address, multiInvoker.address, dsuCollateral)
                  .to.emit(dsuBatcher, 'Unwrap')
                  .withArgs(user.address, dsuCollateral)

                expect((await usdc.balanceOf(user.address)).sub(userUSDCBalanceBefore)).to.eq(collateral)
              }
            })

          withBatcher &&
            it('withdraws from market and unwraps DSU to USDC using RESERVE if BATCHER balance < collateral', async () => {
              const { user, userB, usdc, dsu, dsuBatcher, dsuReserve } = instanceVars

              if (dsuBatcher) {
                // userB uses collateral - 1 from batcher wrap
                const drainBatcherByFixed6 = (await usdc.balanceOf(dsuBatcher.address)).sub(collateral).add(1)
                await fundWalletDSU(userB, drainBatcherByFixed6)
                await dsu.connect(userB).approve(multiInvoker.address, drainBatcherByFixed6.mul(1e12))
                await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

                await expect(
                  multiInvoker.connect(userB)['invoke((uint8,bytes)[])'](
                    buildUpdateMarket({
                      market: market.address,
                      collateral: drainBatcherByFixed6,
                      handleWrap: false,
                    }),
                  ),
                ).to.not.be.reverted

                // drain batcher usdc balance on withdraw and unwrap by batcher balance - collateral + 1
                await expect(
                  multiInvoker.connect(userB)['invoke((uint8,bytes)[])'](
                    buildUpdateMarket({
                      market: market.address,
                      collateral: drainBatcherByFixed6.mul(-1),
                      handleWrap: true,
                    }),
                  ),
                ).to.not.be.reverted

                // user deposits DSU then withdraws and unwraps USDC
                await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
                await invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: false }))
                await expect(
                  invoke(
                    buildUpdateMarket({ market: market.address, collateral: collateral.mul('-1'), handleWrap: true }),
                  ),
                )
                  .to.emit(dsuReserve, 'Redeem')
                  .withArgs(multiInvoker.address, dsuCollateral, anyValue)
                  .to.emit(dsu, 'Transfer')
                  .withArgs(market.address, multiInvoker.address, dsuCollateral)
              }
            })

          it('withdraws from market and unwraps DSU to USDC using RESERVE if BATCHER address == 0', async () => {
            const { user, dsu, dsuReserve } = instanceVars

            // deploy multiinvoker with batcher == 0 address
            multiInvoker = await createInvoker(instanceVars, makerVaultFactory, solverVaultFactory, false)
            await setup()
            expect(await multiInvoker.batcher()).to.eq(constants.AddressZero)

            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

            await invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: false }))

            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul('-1'), handleWrap: true })),
            )
              .to.emit(dsuReserve, 'Redeem')
              .withArgs(multiInvoker.address, dsuCollateral, anyValue)
          })

          it('deposits / redeems / claims from vault (maker)', async () => {
            const { user, dsu } = instanceVars

            const userBalanceBefore = await dsu.balanceOf(user.address)
            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await expect(invoke(buildApproveTarget(makerVault.address))).to.not.be.reverted

            // deposit into vault
            await expect(
              invoke(
                buildUpdateVault({
                  vault: makerVault.address,
                  depositAssets: collateral,
                  redeemShares: 0,
                  claimAssets: 0,
                  wrap: false,
                }),
              ),
            )
              .to.emit(dsu, 'Transfer')
              .withArgs(user.address, multiInvoker.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, makerVault.address, dsuCollateral)

            expect((await makerVault.accounts(user.address)).deposit).to.eq(collateral)
            expect((await makerVault.accounts(user.address)).redemption).to.eq(0)
            expect((await makerVault.accounts(user.address)).assets).to.eq(0)
            expect((await makerVault.accounts(user.address)).shares).to.eq(0)

            await updateVaultOracle()
            await makerVault.settle(user.address)

            // redeem from vault
            await invoke(
              buildUpdateVault({
                vault: makerVault.address,
                depositAssets: 0,
                redeemShares: ethers.constants.MaxUint256,
                claimAssets: 0,
                wrap: false,
              }),
            )

            expect((await makerVault.accounts(user.address)).deposit).to.eq(0)
            expect((await makerVault.accounts(user.address)).redemption).to.eq(collateral)
            expect((await makerVault.accounts(user.address)).assets).to.eq(0)
            expect((await makerVault.accounts(user.address)).shares).to.eq(0)

            await updateVaultOracle()
            await makerVault.settle(user.address)

            const funding = BigNumber.from('14352')
            // claim from vault
            await expect(
              invoke(
                buildUpdateVault({
                  vault: makerVault.address,
                  depositAssets: 0,
                  redeemShares: 0,
                  claimAssets: ethers.constants.MaxUint256,
                  wrap: false,
                }),
              ),
            )
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, user.address, dsuCollateral.add(funding.mul(1e12)))
              .to.emit(dsu, 'Transfer')
              .withArgs(makerVault.address, multiInvoker.address, dsuCollateral.add(funding.mul(1e12)))

            expect((await makerVault.accounts(user.address)).deposit).to.eq(0)
            expect((await makerVault.accounts(user.address)).redemption).to.eq(0)
            expect((await makerVault.accounts(user.address)).assets).to.eq(0)
            expect((await makerVault.accounts(user.address)).shares).to.eq(0)

            const userBalanceAfter = await dsu.balanceOf(user.address)
            expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(funding.mul(1e12))
          })

          it('deposits / redeems / claims from vault (solver)', async () => {
            const { user, dsu } = instanceVars

            const userBalanceBefore = await dsu.balanceOf(user.address)
            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await expect(invoke(buildApproveTarget(solverVault.address))).to.not.be.reverted

            // deposit into vault
            await expect(
              invoke(
                buildUpdateVault({
                  vault: solverVault.address,
                  depositAssets: collateral,
                  redeemShares: 0,
                  claimAssets: 0,
                  wrap: false,
                }),
              ),
            )
              .to.emit(dsu, 'Transfer')
              .withArgs(user.address, multiInvoker.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, solverVault.address, dsuCollateral)

            expect((await solverVault.accounts(user.address)).deposit).to.eq(collateral)
            expect((await solverVault.accounts(user.address)).redemption).to.eq(0)
            expect((await solverVault.accounts(user.address)).assets).to.eq(0)
            expect((await solverVault.accounts(user.address)).shares).to.eq(0)

            await updateVaultOracle()
            await solverVault.settle(user.address)

            // redeem from vault
            await invoke(
              buildUpdateVault({
                vault: solverVault.address,
                depositAssets: 0,
                redeemShares: ethers.constants.MaxUint256,
                claimAssets: 0,
                wrap: false,
              }),
            )

            expect((await solverVault.accounts(user.address)).deposit).to.eq(0)
            expect((await solverVault.accounts(user.address)).redemption).to.eq(collateral)
            expect((await solverVault.accounts(user.address)).assets).to.eq(0)
            expect((await solverVault.accounts(user.address)).shares).to.eq(0)

            await updateVaultOracle()
            await solverVault.settle(user.address)

            // claim from vault
            await expect(
              invoke(
                buildUpdateVault({
                  vault: solverVault.address,
                  depositAssets: 0,
                  redeemShares: 0,
                  claimAssets: ethers.constants.MaxUint256,
                  wrap: false,
                }),
              ),
            )
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, user.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(solverVault.address, multiInvoker.address, dsuCollateral)

            expect((await solverVault.accounts(user.address)).deposit).to.eq(0)
            expect((await solverVault.accounts(user.address)).redemption).to.eq(0)
            expect((await solverVault.accounts(user.address)).assets).to.eq(0)
            expect((await solverVault.accounts(user.address)).shares).to.eq(0)

            const userBalanceAfter = await dsu.balanceOf(user.address)
            expect(userBalanceAfter.sub(userBalanceBefore)).to.eq(0)
          })

          it('requires market approval to spend invokers DSU', async () => {
            const { user, dsu } = instanceVars

            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.be.reverted
          })

          it('creates a maker position', async () => {
            const { user, dsu, margin } = instanceVars

            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

            await advanceToPrice(PRICE)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral })))
              .to.emit(dsu, 'Transfer')
              .withArgs(user.address, multiInvoker.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, margin.address, dsuCollateral)

            expect(await margin.isolatedBalances(user.address, market.address)).to.eq(collateral)

            await expect(invoke(buildUpdateMarket({ market: market.address, makerDelta: parse6decimal('1') })))
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                anyValue,
                anyValue,
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            expect((await market.pendings(user.address)).makerPos).to.eq(parse6decimal('1'))
          })

          it('creates a maker position with additive fee', async () => {
            const { user, userB, dsu, margin } = instanceVars

            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await expect(invoke(buildApproveTarget(market.address))).to.not.be.reverted

            await advanceToPrice(PRICE)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral })))
              .to.emit(dsu, 'Transfer')
              .withArgs(user.address, multiInvoker.address, dsuCollateral)
              .to.emit(dsu, 'Transfer')
              .withArgs(multiInvoker.address, margin.address, dsuCollateral)

            expect(await margin.isolatedBalances(user.address, market.address)).to.eq(collateral)

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  makerDelta: parse6decimal('1'),
                  additiveFee: parse6decimal('0.01'),
                  referrer: userB.address,
                }),
              ),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(user.address, anyValue, anyValue, constants.AddressZero, userB.address, constants.AddressZero)

            expect((await market.pendings(user.address)).makerPos).to.eq(parse6decimal('1'))
            expect((await market.pendings(user.address)).additiveFee).to.eq(parse6decimal('0.01'))
          })

          it('fills an intent update', async () => {
            const { marketFactory, owner, user, userB, userC, usdc, dsu, margin, verifier, oracle } = instanceVars

            await marketFactory.updateParameter({
              ...(await marketFactory.parameter()),
              referralFee: parse6decimal('0.05'),
            })
            await usdc.connect(user).approve(multiInvoker.address, collateral)
            await dsu.connect(user).approve(multiInvoker.address, dsuCollateral)
            await multiInvoker['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))

            await advanceToPrice(PRICE)

            const intent = {
              amount: parse6decimal('1'),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              additiveFee: 0,
              originator: userC.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: userB.address,
                signer: userB.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: constants.MaxUint256,
              },
            }

            const depositAmount = parse6decimal('1000')
            await dsu.connect(user).approve(margin.address, depositAmount.mul(1e12))
            await dsu.connect(userB).approve(margin.address, depositAmount.mul(1e12))
            await dsu.connect(userC).approve(margin.address, depositAmount.mul(1e12))
            await margin.connect(user).deposit(user.address, depositAmount)
            await market
              .connect(user)
              ['update(address,int256,int256,address)'](
                user.address,
                0,
                ethers.utils.parseUnits('1000', 6),
                constants.AddressZero,
              )
            await margin.connect(userB).deposit(userB.address, depositAmount)
            await market
              .connect(userB)
              ['update(address,int256,int256,address)'](
                userB.address,
                0,
                ethers.utils.parseUnits('1000', 6),
                constants.AddressZero,
              )
            await margin.connect(userC).deposit(userC.address, depositAmount)
            await market
              .connect(userC)
              ['update(address,int256,int256,int256,address)'](
                userC.address,
                parse6decimal('1'),
                0,
                depositAmount,
                constants.AddressZero,
              )

            // set a price which matches the guarantee
            await advanceToPrice(PRICE)
            await invoke(
              await buildUpdateIntent({
                signer: userB,
                verifier: verifier,
                market: market.address,
                intent,
              }),
            )

            const intentTimestamp = await oracle.current()
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: intentTimestamp,
              orders: 1,
              shortPos: parse6decimal('1'),
              collateral: 0,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: intentTimestamp,
              orders: 1,
              longPos: parse6decimal('1'),
              collateral: 0,
              takerReferral: parse6decimal('0.05'),
            })
          })

          describe('#market with claimable fee', async () => {
            let user: SignerWithAddress
            let userB: SignerWithAddress
            let dsu: IERC20Metadata
            let usdc: IERC20Metadata
            let margin: IMargin

            beforeEach(async () => {
              user = instanceVars.user
              userB = instanceVars.userB
              dsu = instanceVars.dsu
              usdc = instanceVars.usdc
              margin = instanceVars.margin
              const { owner, marketFactory } = instanceVars
              await dsu.connect(user).approve(margin.address, parse6decimal('600').mul(1e12))
              await dsu.connect(userB).approve(margin.address, parse6decimal('600').mul(1e12))
              // set up the market to pay out a maker referral fee
              const protocolParameters = await marketFactory.parameter()
              await marketFactory.connect(owner).updateParameter({
                ...protocolParameters,
                referralFee: parse6decimal('0.15'),
              })
              const marketParams = await market.parameter()
              await market.connect(owner).updateParameter({
                ...marketParams,
                makerFee: parse6decimal('0.05'),
              })

              await advanceToPrice(PRICE)

              // userB creates a maker position, referred by user
              await margin.connect(userB).deposit(userB.address, parse6decimal('600'))
              await market
                .connect(userB)
                ['update(address,int256,int256,int256,address)'](
                  userB.address,
                  parse6decimal('3'),
                  0,
                  parse6decimal('600'),
                  user.address,
                )
              await advanceToPrice()
              await market.connect(user).settle(user.address)
              await market.connect(userB).settle(userB.address)
            })

            it('claims fee from a market', async () => {
              const expectedFee = await margin.claimables(user.address)

              // user invokes to claim their fee
              if (instanceVars.dsuBatcher) {
                await expect(invoke(buildClaimFee({ market: market.address, unwrap: true })))
                  .to.emit(margin, 'ClaimableWithdrawn')
                  .withArgs(user.address, multiInvoker.address, expectedFee)
                  .to.emit(instanceVars.dsuBatcher, 'Unwrap')
                  .withArgs(user.address, expectedFee.mul(1e12))
                  .to.emit(usdc, 'Transfer')
                  .withArgs(instanceVars.dsuBatcher.address, user.address, expectedFee)
              } else {
                await expect(invoke(buildClaimFee({ market: market.address, unwrap: true })))
                  .to.emit(margin, 'ClaimableWithdrawn')
                  .withArgs(user.address, multiInvoker.address, expectedFee)
                  .to.emit(instanceVars.dsuReserve, 'Redeem')
                  .withArgs(multiInvoker.address, expectedFee.mul(1e12), anyValue)
                  .to.emit(usdc, 'Transfer')
                  .withArgs(instanceVars.dsuReserve.address, multiInvoker.address, expectedFee)
                  .to.emit(usdc, 'Transfer')
                  .withArgs(multiInvoker.address, user.address, expectedFee)
              }
            })

            it('claims fee from a market without unwrapping', async () => {
              const expectedFee = await margin.claimables(user.address)

              // user invokes to claim their fee
              await expect(invoke(buildClaimFee({ market: market.address, unwrap: false })))
                .to.emit(margin, 'ClaimableWithdrawn')
                .withArgs(user.address, multiInvoker.address, expectedFee)
                .to.emit(dsu, 'Transfer')
                .withArgs(multiInvoker.address, user.address, expectedFee.mul(1e12))
            })
          })

          it('Only allows updates to factory created markets', async () => {
            await expect(
              invoke(buildUpdateMarket({ market: makerVault.address, collateral: collateral })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
          })

          it('Only allows updates to factory created vaults', async () => {
            await expect(invoke(buildUpdateVault({ vault: market.address }))).to.be.revertedWithCustomError(
              multiInvoker,
              'MultiInvokerInvalidInstanceError',
            )
          })

          it('Only allows liquidations to factory created markets', async () => {
            await expect(invoke(buildUpdateMarket({ market: makerVault.address }))).to.be.revertedWithCustomError(
              multiInvoker,
              'MultiInvokerInvalidInstanceError',
            )
          })

          describe('#batcher 0 address', async () => {
            beforeEach(async () => {
              // deploy multiinvoker with batcher == 0 address
              multiInvoker = await createInvoker(instanceVars, makerVaultFactory, solverVaultFactory, false)
              await setup()

              await instanceVars.usdc.connect(instanceVars.user).approve(multiInvoker.address, collateral)
              await multiInvoker
                .connect(instanceVars.user)
                ['invoke((uint8,bytes)[])'](buildApproveTarget(market.address))
            })

            it('Wraps USDC to DSU through RESERVE and unwraps DSU to USDC through RESERVE if BATCHER address == 0', async () => {
              await expect(
                invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
              )
                .to.emit(instanceVars.dsuReserve, 'Mint')
                .withArgs(multiInvoker.address, dsuCollateral, anyValue)

              await expect(
                invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
              )
                .to.emit(instanceVars.dsuReserve, 'Redeem')
                .withArgs(multiInvoker.address, dsuCollateral, anyValue)
            })
          })
        })
      })
    })

    describe('unauthorized invoke', async () => {
      it('reverts on unauthorized invoke', async () => {
        const { user, userB } = instanceVars
        await expect(
          multiInvoker.connect(user)['invoke(address,(uint8,bytes)[])'](userB.address, [
            {
              action: 0,
              args: '0x',
            },
          ]),
        ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerUnauthorizedError')
      })
    })
  })
}
