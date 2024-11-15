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
  IVault,
  IOracleProvider,
  IMultiInvoker,
} from '../../../types/generated'
import { loadFixture, setBalance } from '@nomicfoundation/hardhat-network-helpers'
import {
  buildUpdateMarket,
  buildUpdateVault,
  buildClaimFee,
  VaultUpdate,
  Actions,
  MAX_UINT,
} from '../../helpers/MultiInvoker/invoke'

import { parse6decimal } from '../../../../common/testutil/types'

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
    let vault: FakeContract<IVault>
    let marketOracle: FakeContract<IOracleProvider>
    let invokerOracle: FakeContract<AggregatorV3Interface>
    let batcher: FakeContract<IBatcher>
    let reserve: FakeContract<IEmptySetReserve>
    let marketFactory: FakeContract<IMarketFactory>
    let vaultFactory: FakeContract<IVaultFactory>
    let multiInvoker: MultiInvoker

    const multiInvokerFixture = async () => {
      ;[owner, user, user2] = await ethers.HRE.ethers.getSigners()
    }

    beforeEach(async () => {
      await loadFixture(multiInvokerFixture)

      usdc = await smock.fake<IERC20>('IERC20')
      dsu = await smock.fake<IERC20>('IERC20')
      market = await smock.fake<IMarket>('IMarket')
      vault = await smock.fake<IVault>('IVault')
      marketOracle = await smock.fake<IOracleProvider>('IOracleProvider')
      invokerOracle = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
      batcher = await smock.fake<IBatcher>('IBatcher')
      reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
      marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
      vaultFactory = await smock.fake<IVaultFactory>('IVaultFactory')

      multiInvoker = await new MultiInvoker__factory(owner).deploy(
        usdc.address,
        dsu.address,
        marketFactory.address,
        vaultFactory.address,
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
      vaultFactory.instances.whenCalledWith(vault.address).returns(true)

      dsu.approve.whenCalledWith(market.address || vault.address).returns(true)

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
          let vaultUpdate: VaultUpdate

          const fixture = async () => {
            vaultUpdate = { vault: vault.address }
            dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral.mul(1e12)).returns(true)
            dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
            usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral).returns(true)
            usdc.transfer.whenCalledWith(user.address, collateral).returns(true)

            vault.update.returns(true)
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

          it('deposits assets to vault', async () => {
            vaultUpdate.depositAssets = collateral
            const v = buildUpdateVault(vaultUpdate)

            await expect(invoke(v)).to.not.be.reverted

            expect(vault.update).to.have.been.calledWith(user.address, vaultUpdate.depositAssets, '0', '0')
            expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, dsuCollateral)
          })

          it('wraps and deposits assets to vault', async () => {
            vaultUpdate.depositAssets = collateral
            vaultUpdate.wrap = true
            const v = buildUpdateVault(vaultUpdate)

            await expect(invoke(v)).to.not.be.reverted

            expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
            expect(vault.update).to.have.been.calledWith(user.address, vaultUpdate.depositAssets, '0', '0')
            expect(usdc.transferFrom).to.have.been.calledWith(
              user.address,
              multiInvoker.address,
              vaultUpdate.depositAssets,
            )
          })

          it('redeems from vault', async () => {
            vaultUpdate.redeemShares = collateral
            const v = buildUpdateVault(vaultUpdate)

            await expect(invoke(v)).to.not.be.reverted

            expect(vault.update).to.have.been.calledWith(user.address, '0', vaultUpdate.redeemShares, '0')
            expect(dsu.transferFrom).to.not.have.been.called
            expect(usdc.transferFrom).to.not.have.been.called
          })

          it('claims assets from vault', async () => {
            vaultUpdate.claimAssets = collateral
            const v = buildUpdateVault(vaultUpdate)

            await expect(invoke(v)).to.not.be.reverted

            expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
          })

          it('claims and unwraps assets from vault', async () => {
            vaultUpdate.claimAssets = collateral
            vaultUpdate.wrap = true
            const v = buildUpdateVault(vaultUpdate)

            dsu.balanceOf.returnsAtCall(0, 0)
            dsu.balanceOf.returnsAtCall(1, dsuCollateral)

            usdc.balanceOf.returnsAtCall(0, 0)
            usdc.balanceOf.returnsAtCall(1, collateral)

            await expect(invoke(v)).to.not.be.reverted

            expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
            expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
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
            i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [vault.address]) }]
            await expect(invoke(i)).to.not.be.reverted
            expect(dsu.approve).to.have.been.calledWith(vault.address, constants.MaxUint256)
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

        describe('#reverts on', async () => {
          it('reverts update and vaultUpdate on InvalidInstanceError', async () => {
            await expect(invoke(buildUpdateMarket({ market: vault.address }))).to.be.revertedWithCustomError(
              multiInvoker,
              'MultiInvokerInvalidInstanceError',
            )

            await expect(invoke(buildUpdateVault({ vault: market.address }))).to.be.revertedWithCustomError(
              multiInvoker,
              'MultiInvokerInvalidInstanceError',
            )
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
