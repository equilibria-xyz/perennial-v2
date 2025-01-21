import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import {
  MultiInvoker,
  MultiInvoker__factory,
  IMarket,
  IBatcher,
  IEmptySetReserve,
  IERC20,
  IMarketFactory,
  AggregatorV3Interface,
  IVaultFactory,
  IMakerVault,
  ISolverVault,
  IOracleProvider,
  IMultiInvoker,
} from '../../../types/generated'
import { loadFixture, setBalance } from '@nomicfoundation/hardhat-network-helpers'
import {
  buildUpdateMarket,
  buildUpdateVault,
  buildPlaceOrder,
  buildCancelOrder,
  buildExecOrder,
  buildClaimFee,
  VaultUpdate,
  Actions,
  MAX_UINT,
  MAX_UINT64,
  MAX_UINT48,
  MAX_INT64,
  MIN_INT64,
} from '../../helpers/MultiInvoker/invoke'

import { DEFAULT_LOCAL, DEFAULT_POSITION, Local, parse6decimal } from '../../../../common/testutil/types'
import { openTriggerOrder, setGlobalPrice, setMarketPosition, Compare, Dir } from '../../helpers/MultiInvoker/types'

import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { PositionStruct } from '@perennial/v2-core/types/generated/contracts/Market'
import { OracleVersionStruct } from '../../../types/generated/@perennial/v2-oracle/contracts/Oracle'

const ethers = { HRE }
use(smock.matchers)

export function RunMultiInvokerTests(name: string, setup: () => Promise<void>): void {
  describe(name, () => {
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let user2: SignerWithAddress
    let usdc: FakeContract<IERC20>
    let dsu: FakeContract<IERC20>
    let market: FakeContract<IMarket>
    let makerVault: FakeContract<IMakerVault>
    let solverVault: FakeContract<ISolverVault>
    let marketOracle: FakeContract<IOracleProvider>
    let invokerOracle: FakeContract<AggregatorV3Interface>
    let batcher: FakeContract<IBatcher>
    let reserve: FakeContract<IEmptySetReserve>
    let marketFactory: FakeContract<IMarketFactory>
    let makerVaultFactory: FakeContract<IVaultFactory>
    let solverVaultFactory: FakeContract<IVaultFactory>
    let multiInvoker: MultiInvoker

    const multiInvokerFixture = async () => {
      ;[owner, user, user2] = await ethers.HRE.ethers.getSigners()
    }

    beforeEach(async () => {
      await loadFixture(multiInvokerFixture)

      usdc = await smock.fake<IERC20>('IERC20')
      dsu = await smock.fake<IERC20>('IERC20')
      market = await smock.fake<IMarket>('IMarket')
      makerVault = await smock.fake<IMakerVault>('IMakerVault')
      solverVault = await smock.fake<ISolverVault>('ISolverVault')
      marketOracle = await smock.fake<IOracleProvider>('IOracleProvider')
      invokerOracle = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
      batcher = await smock.fake<IBatcher>('IBatcher')
      reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
      marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
      makerVaultFactory = await smock.fake<IVaultFactory>('IVaultFactory')
      solverVaultFactory = await smock.fake<IVaultFactory>('IVaultFactory')

      multiInvoker = await new MultiInvoker__factory(owner).deploy(
        usdc.address,
        dsu.address,
        marketFactory.address,
        makerVaultFactory.address,
        solverVaultFactory.address,
        '0x0000000000000000000000000000000000000000',
        reserve.address,
        500_000,
        1_000_000,
      )

      // Default mkt price: 1150
      const oracleVersion: OracleVersionStruct = {
        timestamp: BigNumber.from(0),
        price: BigNumber.from(1150e6),
        valid: true,
      }

      const aggRoundData = {
        roundId: 0,
        answer: BigNumber.from(1150e8),
        startedAt: 0,
        updatedAt: 0,
        answeredInRound: 0,
      }

      invokerOracle.latestRoundData.returns(aggRoundData)
      market.oracle.returns(marketOracle.address)
      marketOracle.current.returns(0)
      marketOracle.latest.returns(oracleVersion)

      usdc.transferFrom.whenCalledWith(user.address).returns(true)
      marketFactory.instances.whenCalledWith(market.address).returns(true)
      makerVaultFactory.instances.whenCalledWith(makerVault.address).returns(true)
      solverVaultFactory.instances.whenCalledWith(solverVault.address).returns(true)

      dsu.approve.whenCalledWith(market.address || makerVault.address || solverVault.address).returns(true)

      await setup()

      await multiInvoker.initialize(invokerOracle.address)
    })

    afterEach(async () => {
      await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    })

    describe('#updateOperator', () => {
      it('sets operator as enabled', async () => {
        await expect(multiInvoker.connect(user).updateOperator(user2.address, true))
          .to.emit(multiInvoker, 'OperatorUpdated')
          .withArgs(user.address, user2.address, true)
        expect(await multiInvoker.operators(user.address, user2.address)).to.be.true
      })

      it('sets an operator as disabled', async () => {
        await multiInvoker.connect(user).updateOperator(user2.address, true)
        expect(await multiInvoker.operators(user.address, user2.address)).to.be.true
        await expect(multiInvoker.connect(user).updateOperator(user2.address, false))
          .to.emit(multiInvoker, 'OperatorUpdated')
          .withArgs(user.address, user2.address, false)
        expect(await multiInvoker.operators(user.address, user2.address)).to.be.false
      })
    })

    const testCases = [
      {
        context: 'From user',
        setup: async () => true,
        sender: () => user,
        invoke: async (args: IMultiInvoker.InvocationStruct[]) =>
          multiInvoker.connect(user)['invoke((uint8,bytes)[])'](args),
      },
      {
        context: 'From delegate',
        setup: async () => multiInvoker.connect(user).updateOperator(user2.address, true),
        sender: () => user2,
        invoke: async (args: IMultiInvoker.InvocationStruct[]) =>
          multiInvoker.connect(user2)['invoke(address,(uint8,bytes)[])'](user.address, args),
      },
    ]

    testCases.forEach(({ context: contextStr, setup, invoke, sender }) => {
      context(contextStr, () => {
        beforeEach(async () => {
          await setup()
        })

        describe('#invoke', () => {
          const collateral = parse6decimal('10000')
          const dsuCollateral = collateral.mul(1e12)
          let makerVaultUpdate: VaultUpdate
          let solverVaultUpdate: VaultUpdate

          const fixture = async () => {
            makerVaultUpdate = { vault: makerVault.address }
            solverVaultUpdate = { vault: solverVault.address }
            dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral.mul(1e12)).returns(true)
            dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
            usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral).returns(true)
            usdc.transfer.whenCalledWith(user.address, collateral).returns(true)

            makerVault.update.returns(true)
            solverVault.update.returns(true)
            market['update(address,uint256,uint256,uint256,int256,bool,address)'].returns(true)
          }

          beforeEach(async () => {
            await loadFixture(fixture)
          })

          it('deposits collateral', async () => {
            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be
              .reverted

            expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral.mul(1e12))
            expect(market['update(address,uint256,uint256,uint256,int256,bool,address)']).to.have.been.calledWith(
              user.address,
              MAX_UINT,
              MAX_UINT,
              MAX_UINT,
              collateral,
              false,
              constants.AddressZero,
            )
          })

          it('wraps and deposits collateral', async () => {
            dsu.balanceOf.whenCalledWith(batcher.address).returns(constants.MaxUint256)

            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
            ).to.not.be.reverted

            expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
            expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral)
          })

          it('wraps USDC to DSU using RESERVE if amount is greater than batcher balance', async () => {
            dsu.balanceOf.whenCalledWith(batcher.address).returns(0)

            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
            ).to.not.be.reverted

            // old Token6 takes 18 decimals as argument for transfer, actual balance change is 6 decimals
            expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral)
            expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
            expect(dsu.transfer).to.not.have.been.called
          })

          it('withdraws collateral', async () => {
            dsu.balanceOf.reset()
            dsu.balanceOf.returnsAtCall(0, 0)
            dsu.balanceOf.returnsAtCall(1, dsuCollateral)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1) }))).to.not
              .be.reverted

            expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
            expect(market['update(address,uint256,uint256,uint256,int256,bool,address)']).to.have.been.calledWith(
              user.address,
              MAX_UINT,
              MAX_UINT,
              MAX_UINT,
              collateral.mul(-1),
              false,
              constants.AddressZero,
            )
          })

          it('withdraws and unwraps collateral', async () => {
            // simulate market update withdrawing collateral
            dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
            dsu.transferFrom.whenCalledWith(multiInvoker.address, batcher.address).returns(true)
            usdc.balanceOf.whenCalledWith(batcher.address).returns(collateral)

            dsu.balanceOf.reset()
            dsu.balanceOf.returnsAtCall(0, 0)
            dsu.balanceOf.returnsAtCall(1, dsuCollateral)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, collateral)

            await expect(
              invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
            ).to.not.be.reverted

            expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
          })

          context('maker vault', () => {
            it('deposits assets to vault', async () => {
              makerVaultUpdate.depositAssets = collateral
              const v = buildUpdateVault(makerVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(makerVault.update).to.have.been.calledWith(user.address, makerVaultUpdate.depositAssets, '0', '0')
              expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, dsuCollateral)
            })

            it('wraps and deposits assets to vault', async () => {
              makerVaultUpdate.depositAssets = collateral
              makerVaultUpdate.wrap = true
              const v = buildUpdateVault(makerVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
              expect(makerVault.update).to.have.been.calledWith(user.address, makerVaultUpdate.depositAssets, '0', '0')
              expect(usdc.transferFrom).to.have.been.calledWith(
                user.address,
                multiInvoker.address,
                makerVaultUpdate.depositAssets,
              )
            })

            it('redeems from vault', async () => {
              makerVaultUpdate.redeemShares = collateral
              const v = buildUpdateVault(makerVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(makerVault.update).to.have.been.calledWith(user.address, '0', makerVaultUpdate.redeemShares, '0')
              expect(dsu.transferFrom).to.not.have.been.called
              expect(usdc.transferFrom).to.not.have.been.called
            })

            it('claims assets from vault', async () => {
              makerVaultUpdate.claimAssets = collateral
              const v = buildUpdateVault(makerVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(makerVault.update).to.have.been.calledWith(user.address, '0', '0', makerVaultUpdate.claimAssets)
            })

            it('claims and unwraps assets from vault', async () => {
              makerVaultUpdate.claimAssets = collateral
              makerVaultUpdate.wrap = true
              const v = buildUpdateVault(makerVaultUpdate)

              dsu.balanceOf.returnsAtCall(0, 0)
              dsu.balanceOf.returnsAtCall(1, dsuCollateral)

              usdc.balanceOf.returnsAtCall(0, 0)
              usdc.balanceOf.returnsAtCall(1, collateral)

              await expect(invoke(v)).to.not.be.reverted

              expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
              expect(makerVault.update).to.have.been.calledWith(user.address, '0', '0', makerVaultUpdate.claimAssets)
            })

            it('approves market and vault', async () => {
              // approve address not deployed from either factory fails
              let i: Actions = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [user.address]) }]

              await expect(
                multiInvoker.connect(owner)['invoke((uint8,bytes)[])'](i),
              ).to.have.been.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')

              // approve market succeeds
              i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }]
              await expect(invoke(i)).to.not.be.reverted
              expect(dsu.approve).to.have.been.calledWith(market.address, constants.MaxUint256)

              // approve vault succeeds
              i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [makerVault.address]) }]
              await expect(invoke(i)).to.not.be.reverted
              expect(dsu.approve).to.have.been.calledWith(makerVault.address, constants.MaxUint256)
            })
          })

          context('solver vault', () => {
            it('deposits assets to vault', async () => {
              solverVaultUpdate.depositAssets = collateral
              const v = buildUpdateVault(solverVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(solverVault.update).to.have.been.calledWith(
                user.address,
                solverVaultUpdate.depositAssets,
                '0',
                '0',
              )
              expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, dsuCollateral)
            })

            it('wraps and deposits assets to vault', async () => {
              solverVaultUpdate.depositAssets = collateral
              solverVaultUpdate.wrap = true
              const v = buildUpdateVault(solverVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
              expect(solverVault.update).to.have.been.calledWith(
                user.address,
                solverVaultUpdate.depositAssets,
                '0',
                '0',
              )
              expect(usdc.transferFrom).to.have.been.calledWith(
                user.address,
                multiInvoker.address,
                solverVaultUpdate.depositAssets,
              )
            })

            it('redeems from vault', async () => {
              solverVaultUpdate.redeemShares = collateral
              const v = buildUpdateVault(solverVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(solverVault.update).to.have.been.calledWith(user.address, '0', solverVaultUpdate.redeemShares, '0')
              expect(dsu.transferFrom).to.not.have.been.called
              expect(usdc.transferFrom).to.not.have.been.called
            })

            it('claims assets from vault', async () => {
              solverVaultUpdate.claimAssets = collateral
              const v = buildUpdateVault(solverVaultUpdate)

              await expect(invoke(v)).to.not.be.reverted

              expect(solverVault.update).to.have.been.calledWith(user.address, '0', '0', solverVaultUpdate.claimAssets)
            })

            it('claims and unwraps assets from vault', async () => {
              solverVaultUpdate.claimAssets = collateral
              solverVaultUpdate.wrap = true
              const v = buildUpdateVault(solverVaultUpdate)

              dsu.balanceOf.returnsAtCall(0, 0)
              dsu.balanceOf.returnsAtCall(1, dsuCollateral)

              usdc.balanceOf.returnsAtCall(0, 0)
              usdc.balanceOf.returnsAtCall(1, collateral)

              await expect(invoke(v)).to.not.be.reverted

              expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
              expect(solverVault.update).to.have.been.calledWith(user.address, '0', '0', solverVaultUpdate.claimAssets)
            })

            it('approves market and vault', async () => {
              // approve address not deployed from either factory fails
              let i: Actions = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [user.address]) }]

              await expect(
                multiInvoker.connect(owner)['invoke((uint8,bytes)[])'](i),
              ).to.have.been.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')

              // approve market succeeds
              i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }]
              await expect(invoke(i)).to.not.be.reverted
              expect(dsu.approve).to.have.been.calledWith(market.address, constants.MaxUint256)

              // approve vault succeeds
              i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [solverVault.address]) }]
              await expect(invoke(i)).to.not.be.reverted
              expect(dsu.approve).to.have.been.calledWith(solverVault.address, constants.MaxUint256)
            })
          })

          it('charges an interface fee on deposit and pushes DSU from collateral to the receiver', async () => {
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)

            const feeAmt = collateral.div(10)

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral,
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, false)).to.not.be.reverted
            expect(dsu.transfer).to.have.been.calledWith(owner.address, dsuCollateral.div(10))
          })

          it('charges multiple interface fees on deposit and pushes DSU from collateral to the receivers', async () => {
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)

            const feeAmt = collateral.div(10)
            const feeAmt2 = collateral.div(20)

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral,
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                  interfaceFee2: {
                    receiver: user2.address,
                    amount: feeAmt2,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt2, user2.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, false)).to.not.be.reverted
            expect(dsu.transfer).to.have.been.calledWith(owner.address, dsuCollateral.div(10))
            await expect(multiInvoker.connect(user2).claim(user2.address, false)).to.not.be.reverted
            expect(dsu.transfer).to.have.been.calledWith(user2.address, dsuCollateral.div(20))
          })

          it('charges an interface fee on deposit, unwraps DSU from collateral to USDC, and pushes USDC to the receiver', async () => {
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)
            usdc.transfer.returns(true)

            const feeAmt = collateral.div(10)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt)

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral,
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, true)).to.not.be.reverted
            expect(usdc.transfer).to.have.been.calledWith(owner.address, collateral.div(10))
          })

          it('charges multiple interface fees on deposit, unwraps DSU from collateral to USDC, and pushes USDC to the receivers', async () => {
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)
            usdc.transfer.returns(true)

            const feeAmt = collateral.div(10)
            const feeAmt2 = collateral.div(20)

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral,
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                  interfaceFee2: {
                    receiver: user2.address,
                    amount: feeAmt2,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt2, user2.address])

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt)
            await expect(multiInvoker.connect(owner).claim(owner.address, true)).to.not.be.reverted
            expect(reserve.redeem).to.have.been.calledWith(collateral.div(10).mul(1e12))
            expect(usdc.transfer).to.have.been.calledWith(owner.address, collateral.div(10))
            usdc.balanceOf.reset()

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt2)
            await expect(multiInvoker.connect(user2).claim(user2.address, true)).to.not.be.reverted
            expect(reserve.redeem).to.have.been.calledWith(collateral.div(20).mul(1e12))
            expect(usdc.transfer).to.have.been.calledWith(user2.address, collateral.div(20))
            usdc.balanceOf.reset()
          })

          it('charges multiple interface fees on deposit, unwraps one to USDC, and pushes to receive', async () => {
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)
            usdc.transfer.returns(true)

            const feeAmt = collateral.div(10)
            const feeAmt2 = collateral.div(20)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt)

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral,
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                  interfaceFee2: {
                    receiver: user2.address,
                    amount: feeAmt2,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt2, user2.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, true)).to.not.be.reverted
            expect(usdc.transfer).to.have.been.calledWith(owner.address, collateral.div(10))
            await expect(multiInvoker.connect(user2).claim(user2.address, false)).to.not.be.reverted
            expect(dsu.transfer).to.have.been.calledWith(user2.address, dsuCollateral.div(20))
          })

          it('charges an interface fee on withdrawal and pushes DSU from collateral to the receiver', async () => {
            usdc.transferFrom.returns(true)
            dsu.transfer.returns(true)

            const feeAmt = collateral.div(10)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be
              .reverted

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral.sub(feeAmt).mul(-1),
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, false)).to.not.be.reverted
            expect(dsu.transfer).to.have.been.calledWith(owner.address, feeAmt.mul(1e12))
          })

          it('charges an interface fee on withdrawal, wraps DSU from collateral to USDC, and pushes USDC to the receiver', async () => {
            usdc.transferFrom.returns(true)
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)
            usdc.transfer.returns(true)

            const feeAmt = collateral.div(10)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be
              .reverted

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral.sub(feeAmt).mul(-1),
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, true)).to.not.be.reverted
            expect(usdc.transfer).to.have.been.calledWith(owner.address, feeAmt)
          })

          it('sets subtractive fee referrer as interface1.receiver if set', async () => {
            usdc.transferFrom.returns(true)
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)
            usdc.transfer.returns(true)

            const feeAmt = collateral.div(10)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be
              .reverted

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral.sub(feeAmt).mul(-1),
                  interfaceFee1: {
                    receiver: owner.address,
                    amount: feeAmt,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, owner.address])

            await expect(multiInvoker.connect(owner).claim(owner.address, true)).to.not.be.reverted
            expect(usdc.transfer).to.have.been.calledWith(owner.address, feeAmt)
            expect(market['update(address,uint256,uint256,uint256,int256,bool,address)']).to.have.been.calledWith(
              user.address,
              MAX_UINT,
              MAX_UINT,
              MAX_UINT,
              collateral.sub(feeAmt).mul(-1),
              false,
              owner.address,
            )
          })

          it('sets subtractive fee referrer as interfaceFee2.receiver if interfaceFee1.receiver is not set', async () => {
            usdc.transferFrom.returns(true)
            dsu.transferFrom.returns(true)
            dsu.transfer.returns(true)
            usdc.transfer.returns(true)

            const feeAmt = collateral.div(10)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, feeAmt)

            await expect(invoke(buildUpdateMarket({ market: market.address, collateral: collateral }))).to.not.be
              .reverted

            await expect(
              invoke(
                buildUpdateMarket({
                  market: market.address,
                  collateral: collateral.sub(feeAmt).mul(-1),
                  interfaceFee1: {
                    receiver: constants.AddressZero,
                    amount: 0,
                  },
                  interfaceFee2: {
                    receiver: user2.address,
                    amount: feeAmt,
                  },
                }),
              ),
            )
              .to.emit(multiInvoker, 'InterfaceFeeCharged')
              .withArgs(user.address, market.address, [feeAmt, user2.address])

            await expect(multiInvoker.connect(user2).claim(user2.address, true)).to.not.be.reverted
            expect(usdc.transfer).to.have.been.calledWith(user2.address, feeAmt)
            expect(market['update(address,uint256,uint256,uint256,int256,bool,address)']).to.have.been.calledWith(
              user.address,
              MAX_UINT,
              MAX_UINT,
              MAX_UINT,
              collateral.sub(feeAmt).mul(-1),
              false,
              user2.address,
            )
          })

          it('claims fee from a market', async () => {
            const fee = parse6decimal('0.123')
            usdc.transfer.returns(true)
            market.claimFee.returns(fee)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, fee)

            await expect(invoke(buildClaimFee({ market: market.address, unwrap: true }))).to.not.be.reverted
            expect(market.claimFee).to.have.been.calledWith(user.address)
            expect(reserve.redeem).to.have.been.calledWith(fee.mul(1e12))
            expect(usdc.transfer).to.have.been.calledWith(user.address, fee)
          })

          it('claims fee from a market when DSU reserve redeemPrice is not 1', async () => {
            const fee = parse6decimal('0.123')
            const unwrappedFee = parse6decimal('0.121')
            usdc.transfer.returns(true)
            market.claimFee.returns(fee)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, unwrappedFee)

            await expect(invoke(buildClaimFee({ market: market.address, unwrap: true }))).to.not.be.reverted
            expect(market.claimFee).to.have.been.calledWith(user.address)
            expect(reserve.redeem).to.have.been.calledWith(fee.mul(1e12))
            expect(usdc.transfer).to.have.been.calledWith(user.address, unwrappedFee)
          })

          it('claims fee from a market without unwrapping', async () => {
            const fee = parse6decimal('0.0654')
            dsu.transfer.returns(true)
            market.claimFee.returns(fee)

            await expect(invoke(buildClaimFee({ market: market.address, unwrap: false }))).to.not.be.reverted
            expect(market.claimFee).to.have.been.calledWith(user.address)
            expect(reserve.redeem).to.not.have.been.called
            expect(dsu.transfer).to.have.been.calledWith(user.address, fee.mul(1e12))
          })

          it('reverts if claiming fee from a non-market', async () => {
            await expect(
              invoke(buildClaimFee({ market: batcher.address, unwrap: true })),
            ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
          })

          describe('ETH return', async () => {
            it('returns excess ETH in contract to msg.sender on invoke', async () => {
              const ethValue = utils.parseEther('1.01')
              await setBalance(multiInvoker.address, ethValue)

              await expect(invoke([])).to.changeEtherBalance(sender(), ethValue)
              expect(await HRE.ethers.provider.getBalance(multiInvoker.address)).to.equal(0)
            })
          })
        })

        describe('#keeper order invoke', () => {
          const collateral = parse6decimal('10000')
          const position = parse6decimal('10')
          const price = BigNumber.from(1150e6)

          const defaultLocal: Local = {
            ...DEFAULT_LOCAL,
            currentId: 1,
          }

          const defaultPosition: PositionStruct = {
            timestamp: 1,
            maker: 0,
            long: position,
            short: position,
          }

          beforeEach(async () => {
            setGlobalPrice(market, BigNumber.from(1150e6))
            setMarketPosition(market, user, defaultPosition)
            market.locals.whenCalledWith(user.address).returns(defaultLocal)
            dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral.mul(1e12)).returns(true)
            usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral).returns(true)
          })

          it('places a limit order', async () => {
            const trigger = openTriggerOrder({
              delta: position,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
              price: price,
            })

            const txn = await invoke(
              buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger }),
            )

            setMarketPosition(market, user, defaultPosition)

            await expect(txn)
              .to.emit(multiInvoker, 'OrderPlaced')
              .withArgs(user.address, market.address, 1, {
                side: 1,
                comparison: -1,
                fee: 10e6,
                price: trigger.price,
                delta: position,
                interfaceFee1: { amount: 0, receiver: constants.AddressZero },
                interfaceFee2: { amount: 0, receiver: constants.AddressZero },
              })

            expect(await multiInvoker.latestNonce()).to.eq(1)

            const orderState = await multiInvoker.orders(user.address, market.address, 1)

            expect(
              orderState.side == trigger.side &&
                orderState.fee.eq(await trigger.fee) &&
                orderState.price.eq(await trigger.price) &&
                orderState.delta.eq(await trigger.delta),
            ).to.be.true
          })

          it('places a limit order w/ interface fee', async () => {
            const trigger = openTriggerOrder({
              delta: position,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
              price: price,
              interfaceFee1: {
                receiver: owner.address,
                amount: 100e6,
              },
            })

            const txn = await invoke(
              buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              }),
            )

            setMarketPosition(market, user, defaultPosition)

            await expect(txn)
              .to.emit(multiInvoker, 'OrderPlaced')
              .withArgs(user.address, market.address, 1, {
                side: 1,
                comparison: -1,
                fee: 10e6,
                price: trigger.price,
                delta: position,
                interfaceFee1: { amount: 100e6, receiver: owner.address },
                interfaceFee2: { amount: 0, receiver: constants.AddressZero },
              })

            expect(await multiInvoker.latestNonce()).to.eq(1)

            const orderState = await multiInvoker.orders(user.address, market.address, 1)

            expect(orderState.side).to.equal(trigger.side)
            expect(orderState.fee).to.equal(trigger.fee)
            expect(orderState.price).to.equal(trigger.price)
            expect(orderState.delta).to.equal(trigger.delta)
            expect(orderState.interfaceFee1.amount).to.equal(100e6)
            expect(orderState.interfaceFee1.receiver).to.equal(owner.address)
            expect(orderState.interfaceFee2.amount).to.equal(0)
            expect(orderState.interfaceFee2.receiver).to.equal(constants.AddressZero)
          })

          it('places a limit order w/ multiple interface fees', async () => {
            const trigger = openTriggerOrder({
              delta: position,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
              price: price,
              interfaceFee1: {
                receiver: owner.address,
                amount: 100e6,
              },
              interfaceFee2: {
                receiver: user2.address,
                amount: 50e6,
              },
            })

            const txn = await invoke(
              buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              }),
            )

            setMarketPosition(market, user, defaultPosition)

            await expect(txn)
              .to.emit(multiInvoker, 'OrderPlaced')
              .withArgs(user.address, market.address, 1, {
                side: 1,
                comparison: -1,
                fee: 10e6,
                price: trigger.price,
                delta: position,
                interfaceFee1: { amount: 100e6, receiver: owner.address },
                interfaceFee2: { amount: 50e6, receiver: user2.address },
              })

            expect(await multiInvoker.latestNonce()).to.eq(1)

            const orderState = await multiInvoker.orders(user.address, market.address, 1)

            expect(orderState.side).to.equal(trigger.side)
            expect(orderState.fee).to.equal(trigger.fee)
            expect(orderState.price).to.equal(trigger.price)
            expect(orderState.delta).to.equal(trigger.delta)
            expect(orderState.interfaceFee1.amount).to.equal(100e6)
            expect(orderState.interfaceFee1.receiver).to.equal(owner.address)
            expect(orderState.interfaceFee2.amount).to.equal(50e6)
            expect(orderState.interfaceFee2.receiver).to.equal(user2.address)
          })

          it('places a limit order w/ interface fee (unwrap)', async () => {
            const trigger = openTriggerOrder({
              delta: position,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
              price: price,
              interfaceFee1: {
                receiver: owner.address,
                amount: 100e6,
              },
              interfaceFee2: {
                receiver: constants.AddressZero,
                amount: 0,
              },
            })

            const txn = await invoke(
              buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              }),
            )

            setMarketPosition(market, user, defaultPosition)

            await expect(txn)
              .to.emit(multiInvoker, 'OrderPlaced')
              .withArgs(user.address, market.address, 1, {
                side: 1,
                comparison: -1,
                fee: 10e6,
                price: trigger.price,
                delta: position,
                interfaceFee1: { amount: 100e6, receiver: owner.address },
                interfaceFee2: { amount: 0, receiver: constants.AddressZero },
              })

            expect(await multiInvoker.latestNonce()).to.eq(1)

            const orderState = await multiInvoker.orders(user.address, market.address, 1)

            expect(orderState.side).to.equal(trigger.side)
            expect(orderState.fee).to.equal(trigger.fee)
            expect(orderState.price).to.equal(trigger.price)
            expect(orderState.delta).to.equal(trigger.delta)
            expect(orderState.interfaceFee1.amount).to.equal(100e6)
            expect(orderState.interfaceFee1.receiver).to.equal(owner.address)
            expect(orderState.interfaceFee2.amount).to.equal(0)
            expect(orderState.interfaceFee2.receiver).to.equal(constants.AddressZero)
          })

          it('places a tp order', async () => {
            let trigger = openTriggerOrder({
              delta: position.mul(-1),
              price: BigNumber.from(1100e6),
              side: Dir.S,
              comparison: Compare.ABOVE_MARKET,
            })
            let i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
            await expect(invoke(i)).to.not.be.reverted

            // mkt price >= trigger price (false)
            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false
            trigger = openTriggerOrder({
              delta: position.mul(-1),
              price: BigNumber.from(1200e6),
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
            })
            i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })

            expect(await invoke(i)).to.not.be.reverted

            // mkt price <= trigger price (true)
            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
          })

          it('places a sl order', async () => {
            // order cannot be stopped
            let trigger = openTriggerOrder({
              delta: position.mul(-1),
              price: BigNumber.from(1200e6),
              side: Dir.S,
              comparison: Compare.BELOW_MARKET,
            })
            let i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
            setMarketPosition(market, user, defaultPosition)

            await expect(invoke(i)).to.not.be.reverted

            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

            // order can be stopped
            trigger = openTriggerOrder({
              delta: position.mul(-1),
              price: BigNumber.from(1100e6),
              side: Dir.L,
              comparison: Compare.BELOW_MARKET,
            })
            i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
            await expect(invoke(i)).to.not.be.reverted

            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
          })

          it('places a withdraw order', async () => {
            let trigger = openTriggerOrder({
              delta: collateral.div(-4),
              price: BigNumber.from(1200e6),
              side: Dir.C,
              comparison: Compare.BELOW_MARKET,
            })
            let i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
            setMarketPosition(market, user, defaultPosition)

            await expect(invoke(i)).to.not.be.reverted

            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

            trigger = openTriggerOrder({
              delta: collateral.div(-4),
              price: BigNumber.from(1100e6),
              side: Dir.C,
              comparison: Compare.BELOW_MARKET,
            })
            i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
            await expect(invoke(i)).to.not.be.reverted

            expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
          })

          it('cancels an order', async () => {
            expect(await multiInvoker.latestNonce()).to.eq(0)

            // place the order to cancel
            const trigger = openTriggerOrder({
              delta: position,
              price: price,
              side: Dir.L,
              comparison: Compare.ABOVE_MARKET,
            })
            const placeAction = buildPlaceOrder({
              market: market.address,
              collateral: collateral,
              order: trigger,
            })

            await expect(invoke(placeAction)).to.not.be.reverted

            // cancel the order
            const cancelAction = buildCancelOrder({ market: market.address, orderId: 1 })
            await expect(invoke(cancelAction))
              .to.emit(multiInvoker, 'OrderCancelled')
              .withArgs(user.address, market.address, 1)

            expect(await multiInvoker.latestNonce()).to.eq(1)
          })

          describe('#reverts on', async () => {
            it('reverts update, vaultUpdate, placeOrder on InvalidInstanceError', async () => {
              await expect(invoke(buildUpdateMarket({ market: makerVault.address }))).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidInstanceError',
              )

              await expect(invoke(buildUpdateVault({ vault: market.address }))).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidInstanceError',
              )

              const trigger = openTriggerOrder({
                delta: collateral,
                price: 1100e6,
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
              })

              await expect(
                invoke(buildPlaceOrder({ market: makerVault.address, collateral: collateral, order: trigger })),
              ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')
            })

            it('reverts placeOrder on InvalidOrderError', async () => {
              // Case 0 fee
              let trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1100e6),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
                fee: 0,
              })

              let placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                long: BigNumber.from(trigger.delta).abs(),
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidOrderError',
              )

              // -------------------------------------------------------------------------------------- //
              // case 2 < comparisson  || < -2
              trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1100e6),
                side: Dir.L,
                comparison: -3,
              })

              placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                long: BigNumber.from(trigger.delta).abs(),
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidOrderError',
              )

              trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1100e6),
                side: Dir.L,
                comparison: 3,
              })

              placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                long: BigNumber.from(trigger.delta).abs(),
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidOrderError',
              )

              // -------------------------------------------------------------------------------------- //
              // case side > 3
              trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1100e6),
                comparison: Compare.ABOVE_MARKET,
                side: 4,
              })

              placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                long: BigNumber.from(trigger.delta).abs(),
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidOrderError',
              )

              // -------------------------------------------------------------------------------------- //
              // case side = 3, delta >= 0
              trigger = openTriggerOrder({
                delta: collateral,
                price: BigNumber.from(1100e6),
                comparison: Compare.ABOVE_MARKET,
                side: 3,
              })

              placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                long: BigNumber.from(trigger.delta).abs(),
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.be.revertedWithCustomError(
                multiInvoker,
                'MultiInvokerInvalidOrderError',
              )
            })
          })

          describe('#trigger orders', async () => {
            const fixture = async () => {
              dsu.transfer.returns(true)
              setGlobalPrice(market, BigNumber.from(1150e6))
            }

            beforeEach(async () => {
              await loadFixture(fixture)
              dsu.transfer.returns(true)
            })

            it('executes a long limit order', async () => {
              // long limit: mkt price <= exec price
              const trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1200e6),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.not.be.reverted

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(invoke(execOrder)).to.emit(multiInvoker, 'OrderExecuted').to.emit(multiInvoker, 'KeeperCall')
            })

            it('executes a short limit order', async () => {
              // set short position in market
              const triggerOrder = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1000e6),
                side: Dir.S,
                comparison: Compare.BELOW_MARKET,
              })

              // short limit: mkt price >= exec price
              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: triggerOrder,
              })

              await invoke(placeOrder)

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

              await expect(invoke(execOrder)).to.emit(multiInvoker, 'OrderExecuted').to.emit(multiInvoker, 'KeeperCall')
            })

            it('execues a short sl order', async () => {
              // set short position in market
              const triggerOrder = openTriggerOrder({
                delta: position.mul(-1),
                price: BigNumber.from(1100e6),
                side: Dir.S,
                comparison: Compare.BELOW_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                short: position,
                order: triggerOrder,
              })

              await invoke(placeOrder)

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(invoke(execOrder)).to.emit(multiInvoker, 'OrderExecuted').to.emit(multiInvoker, 'KeeperCall')
            })

            it('executes a long sl order', async () => {
              const triggerOrder = openTriggerOrder({
                delta: position.mul(-1),
                price: BigNumber.from(1200e6),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                long: position,
                order: triggerOrder,
              })

              // const pending = openPosition({ long: BigNumber.from(triggerOrder.delta).abs(), collateral: collateral })
              // setPendingPosition(market, user, pending)

              await invoke(placeOrder)

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(await invoke(execOrder))
                .to.emit(multiInvoker, 'OrderExecuted')
                .to.emit(multiInvoker, 'KeeperCall')
            })

            it('executes a maker limit order', async () => {
              const triggerOrder = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1200e6),
                side: Dir.M,
                comparison: Compare.ABOVE_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: triggerOrder,
              })

              await invoke(placeOrder)

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(await invoke(execOrder))
                .to.emit(multiInvoker, 'OrderExecuted')
                .to.emit(multiInvoker, 'KeeperCall')
            })

            it('executes a maker trigger order', async () => {
              const triggerOrder = openTriggerOrder({
                delta: position.mul(-1),
                price: BigNumber.from(1100e6),
                side: Dir.M,
                comparison: Compare.BELOW_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                maker: position,
                order: triggerOrder,
              })

              market.positions.reset()
              market.positions.whenCalledWith(user.address).returns({ ...DEFAULT_POSITION, maker: position })

              await invoke(placeOrder)
              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(await invoke(execOrder))
                .to.emit(multiInvoker, 'OrderExecuted')
                .to.emit(multiInvoker, 'KeeperCall')
            })

            it('executs an order with a interface fee', async () => {
              // long limit: mkt price <= exec price
              const trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1200e6),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
                interfaceFee1: { receiver: owner.address, amount: 100e6 },
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.not.be.reverted

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(invoke(execOrder))
                .to.emit(multiInvoker, 'OrderExecuted')
                .to.emit(multiInvoker, 'KeeperCall')
                .to.emit(multiInvoker, 'InterfaceFeeCharged')

              expect(market['update(address,uint256,uint256,uint256,int256,bool,address)']).to.have.been.calledWith(
                user.address,
                0,
                position.mul(2),
                position,
                0,
                false,
                owner.address,
              )
            })

            it('executes a withdrawal trigger order', async () => {
              const triggerOrder = openTriggerOrder({
                delta: collateral.div(-4),
                price: BigNumber.from(1100e6),
                side: Dir.C,
                comparison: Compare.BELOW_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                maker: position,
                order: triggerOrder,
              })

              await invoke(placeOrder)
              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(await invoke(execOrder))
                .to.emit(multiInvoker, 'OrderExecuted')
                .to.emit(multiInvoker, 'KeeperCall')
            })

            it('executes an order and charges keeper fee to sender', async () => {
              // long limit: limit = true && mkt price (1150) <= exec price 1200
              const trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1200e6),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.not.be.reverted

              // charge fee
              dsu.transfer.returns(true)
              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

              // buffer: 100000
              await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
              await expect(
                multiInvoker.connect(owner)['invoke((uint8,bytes)[])'](execOrder, { maxFeePerGas: 100000000 }),
              )
                .to.emit(multiInvoker, 'OrderExecuted')
                .to.emit(multiInvoker, 'KeeperCall')
                .withArgs(owner.address, anyValue, anyValue, anyValue, anyValue, anyValue)
            })

            it('doesnt execute when version invalid', async () => {
              marketOracle.latest.returns({
                timestamp: BigNumber.from(0),
                price: BigNumber.from(1150e6),
                valid: false,
              })

              // long limit: mkt price <= exec price
              const trigger = openTriggerOrder({
                delta: position,
                price: BigNumber.from(1200e6),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
              })

              const placeOrder = buildPlaceOrder({
                market: market.address,
                collateral: collateral,
                order: trigger,
              })

              await expect(invoke(placeOrder)).to.not.be.reverted

              const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
              await expect(invoke(execOrder)).to.revertedWithCustomError(multiInvoker, 'MultiInvokerCantExecuteError')
            })

            it('Properly stores trigger order values', async () => {
              const defaultOrder = openTriggerOrder({
                delta: parse6decimal('10000'),
                side: Dir.L,
                comparison: Compare.ABOVE_MARKET,
                price: BigNumber.from(1000e6),
              })

              defaultOrder.comparison = 1

              const testOrder = { ...defaultOrder }

              //market.update.returns(true)

              // max values test
              testOrder.fee = MAX_UINT64
              testOrder.price = MAX_INT64
              testOrder.delta = MAX_INT64
              testOrder.interfaceFee1.amount = MAX_UINT48
              testOrder.interfaceFee2.amount = MAX_UINT48

              await invoke(buildPlaceOrder({ market: market.address, order: testOrder, collateral: 0 }))

              let placedOrder = await multiInvoker.orders(user.address, market.address, 1)

              expect(placedOrder.fee).to.be.eq(MAX_UINT64)
              expect(placedOrder.price).to.be.eq(MAX_INT64)
              expect(placedOrder.delta).to.be.eq(MAX_INT64)
              expect(placedOrder.interfaceFee1.amount).to.be.eq(MAX_UINT48)
              expect(placedOrder.interfaceFee2.amount).to.be.eq(MAX_UINT48)

              testOrder.price = MIN_INT64
              testOrder.delta = MIN_INT64
              await invoke(buildPlaceOrder({ market: market.address, order: testOrder, collateral: 0 }))

              placedOrder = await multiInvoker.orders(user.address, market.address, 2)

              expect(placedOrder.price).to.be.eq(MIN_INT64)
              expect(placedOrder.delta).to.be.eq(MIN_INT64)
            })
          })
        })
      })
    })

    describe('unauthorized invoke', async () => {
      it('reverts on unauthorized invoke', async () => {
        await expect(
          multiInvoker.connect(user)['invoke(address,(uint8,bytes)[])'](user2.address, [
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

RunMultiInvokerTests('MultiInvoker', async () => {
  /* empty */
})
