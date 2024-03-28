import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import {
  IMarket,
  IBatcher,
  IEmptySetReserve,
  IERC20,
  IMarketFactory,
  AggregatorV3Interface,
  IVaultFactory,
  IVault,
  IOracleProvider,
  MultiInvoker_Arbitrum__factory,
  MultiInvoker_Arbitrum,
  ArbGasInfo,
} from '../../../types/generated'
import { OracleVersionStruct } from '@equilibria/perennial-v2-oracle/types/generated/contracts/Oracle'
import { PositionStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  buildPlaceOrder,
  type Actions,
  buildCancelOrder,
  buildUpdateMarket,
  buildUpdateVault,
  buildExecOrder,
  MAX_UINT,
  VaultUpdate,
} from '../../helpers/invoke'

import { DEFAULT_LOCAL, DEFAULT_POSITION, Local, parse6decimal } from '../../../../common/testutil/types'
import { Compare, Dir, openTriggerOrder, setGlobalPrice, setMarketPosition } from '../../helpers/types'

import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

const ethers = { HRE }
use(smock.matchers)

describe('MultiInvoker_Arbitrum', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
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
  let multiInvoker: MultiInvoker_Arbitrum

  const multiInvokerFixture = async () => {
    ;[owner, user] = await ethers.HRE.ethers.getSigners()
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

    multiInvoker = await new MultiInvoker_Arbitrum__factory(owner).deploy(
      usdc.address,
      dsu.address,
      marketFactory.address,
      vaultFactory.address,
      '0x0000000000000000000000000000000000000000',
      reserve.address,
      100_000,
      200_000,
    )

    // Mock L1 gas pricing
    const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    gasInfo.getL1BaseFeeEstimate.returns(0)

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
    marketOracle.latest.returns(oracleVersion)

    usdc.transferFrom.whenCalledWith(user.address).returns(true)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    vaultFactory.instances.whenCalledWith(vault.address).returns(true)

    dsu.approve.whenCalledWith(market.address || vault.address).returns(true)

    await multiInvoker.initialize(invokerOracle.address)
  })

  afterEach(async () => {
    await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
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
      market['update(address,uint256,uint256,uint256,int256,bool)'].returns(true)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('deposits collateral', async () => {
      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral.mul(1e12))
      expect(market['update(address,uint256,uint256,uint256,int256,bool)']).to.have.been.calledWith(
        user.address,
        MAX_UINT,
        MAX_UINT,
        MAX_UINT,
        collateral,
        false,
      )
    })

    it('wraps and deposits collateral', async () => {
      dsu.balanceOf.whenCalledWith(batcher.address).returns(constants.MaxUint256)

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
      ).to.not.be.reverted

      expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral)
    })

    it('wraps USDC to DSU using RESERVE if amount is greater than batcher balance', async () => {
      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })),
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

      await expect(
        multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1) })),
      ).to.not.be.reverted

      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
      expect(market['update(address,uint256,uint256,uint256,int256,bool)']).to.have.been.calledWith(
        user.address,
        MAX_UINT,
        MAX_UINT,
        MAX_UINT,
        collateral.mul(-1),
        false,
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

      await expect(
        await multiInvoker
          .connect(user)
          .invoke(buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })),
      ).to.not.be.reverted

      expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
    })

    it('deposits assets to vault', async () => {
      vaultUpdate.depositAssets = collateral
      const v = buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(vault.update).to.have.been.calledWith(user.address, vaultUpdate.depositAssets, '0', '0')
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, dsuCollateral)
    })

    it('wraps and deposits assets to vault', async () => {
      vaultUpdate.depositAssets = collateral
      vaultUpdate.wrap = true
      const v = buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
      expect(vault.update).to.have.been.calledWith(user.address, vaultUpdate.depositAssets, '0', '0')
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, vaultUpdate.depositAssets)
    })

    it('redeems from vault', async () => {
      vaultUpdate.redeemShares = collateral
      const v = buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(vault.update).to.have.been.calledWith(user.address, '0', vaultUpdate.redeemShares, '0')
      expect(dsu.transferFrom).to.not.have.been.called
      expect(usdc.transferFrom).to.not.have.been.called
    })

    it('claims assets from vault', async () => {
      vaultUpdate.claimAssets = collateral
      const v = buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
    })

    it('claims and unwraps assets from vault', async () => {
      vaultUpdate.claimAssets = collateral
      vaultUpdate.wrap = true
      const v = buildUpdateVault(vaultUpdate)

      dsu.balanceOf.returnsAtCall(0, 0)
      dsu.balanceOf.returnsAtCall(1, dsuCollateral)
      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
      expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
    })

    it('approves market and vault', async () => {
      // approve address not deployed from either factory fails
      let i: Actions = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [user.address]) }]

      await expect(multiInvoker.connect(owner).invoke(i)).to.have.been.revertedWithCustomError(
        multiInvoker,
        'MultiInvokerInvalidInstanceError',
      )

      // approve market succeeds
      i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }]
      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted
      expect(dsu.approve).to.have.been.calledWith(market.address, constants.MaxUint256)

      // approve vault succeeds
      i = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [vault.address]) }]
      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted
      expect(dsu.approve).to.have.been.calledWith(vault.address, constants.MaxUint256)
    })

    it('charges an interface fee on deposit and pushes DSU from collateral to the receiver', async () => {
      dsu.transferFrom.returns(true)
      dsu.transfer.returns(true)

      const feeAmt = collateral.div(10)

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral,
            interfaceFee1: {
              receiver: owner.address,
              amount: feeAmt,
              unwrap: false,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, false])

      expect(dsu.transfer).to.have.been.calledWith(owner.address, dsuCollateral.div(10))
    })

    it('charges an interface fee on deposit, unwraps DSU from collateral to USDC, and pushes USDC to the receiver', async () => {
      dsu.transferFrom.returns(true)
      dsu.transfer.returns(true)
      usdc.transfer.returns(true)

      const feeAmt = collateral.div(10)

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral,
            interfaceFee1: {
              receiver: owner.address,
              amount: feeAmt,
              unwrap: true,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, true])

      expect(usdc.transfer).to.have.been.calledWith(owner.address, collateral.div(10))
    })

    it('charges an interface fee on withdrawal and pushes DSU from collateral to the receiver', async () => {
      usdc.transferFrom.returns(true)
      dsu.transfer.returns(true)

      const feeAmt = collateral.div(10)

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral.sub(feeAmt).mul(-1),
            interfaceFee1: {
              receiver: owner.address,
              amount: feeAmt,
              unwrap: false,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, false])

      expect(dsu.transfer).to.have.been.calledWith(owner.address, feeAmt.mul(1e12))
    })

    it('charges an interface fee on withdrawal, wraps DSU from colalteral to USDC, and pushes USDC to the receiver', async () => {
      usdc.transferFrom.returns(true)
      dsu.transferFrom.returns(true)
      dsu.transfer.returns(true)
      usdc.transfer.returns(true)

      const feeAmt = collateral.div(10)

      await expect(
        multiInvoker.connect(user).invoke(buildUpdateMarket({ market: market.address, collateral: collateral })),
      ).to.not.be.reverted

      await expect(
        multiInvoker.connect(user).invoke(
          buildUpdateMarket({
            market: market.address,
            collateral: collateral.sub(feeAmt).mul(-1),
            interfaceFee1: {
              receiver: owner.address,
              amount: feeAmt,
              unwrap: true,
            },
          }),
        ),
      )
        .to.emit(multiInvoker, 'InterfaceFeeCharged')
        .withArgs(user.address, market.address, [feeAmt, owner.address, true])

      expect(usdc.transfer).to.have.been.calledWith(owner.address, feeAmt)
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

      const txn = await multiInvoker
        .connect(user)
        .invoke(buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger }))

      setMarketPosition(market, user, defaultPosition)

      await expect(txn)
        .to.emit(multiInvoker, 'OrderPlaced')
        .withArgs(user.address, market.address, 1, {
          side: 1,
          comparison: -1,
          fee: 10e6,
          price: trigger.price,
          delta: position,
          interfaceFee1: { amount: 0, receiver: constants.AddressZero, unwrap: false },
          interfaceFee2: { amount: 0, receiver: constants.AddressZero, unwrap: false },
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
          unwrap: false,
        },
      })

      const txn = await multiInvoker.connect(user).invoke(
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
          interfaceFee1: { amount: 100e6, receiver: owner.address, unwrap: false },
          interfaceFee2: { amount: 0, receiver: constants.AddressZero, unwrap: false },
        })

      expect(await multiInvoker.latestNonce()).to.eq(1)

      const orderState = await multiInvoker.orders(user.address, market.address, 1)

      expect(orderState.side).to.equal(trigger.side)
      expect(orderState.fee).to.equal(trigger.fee)
      expect(orderState.price).to.equal(trigger.price)
      expect(orderState.delta).to.equal(trigger.delta)
      expect(orderState.interfaceFee1.amount).to.equal(100e6)
      expect(orderState.interfaceFee1.receiver).to.equal(owner.address)
      expect(orderState.interfaceFee1.unwrap).to.equal(false)
      expect(orderState.interfaceFee2.amount).to.equal(0)
      expect(orderState.interfaceFee2.receiver).to.equal(constants.AddressZero)
      expect(orderState.interfaceFee2.unwrap).to.equal(false)
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
          unwrap: true,
        },
      })

      const txn = await multiInvoker.connect(user).invoke(
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
          interfaceFee1: { amount: 100e6, receiver: owner.address, unwrap: true },
          interfaceFee2: { amount: 0, receiver: constants.AddressZero, unwrap: false },
        })

      expect(await multiInvoker.latestNonce()).to.eq(1)

      const orderState = await multiInvoker.orders(user.address, market.address, 1)

      expect(orderState.side).to.equal(trigger.side)
      expect(orderState.fee).to.equal(trigger.fee)
      expect(orderState.price).to.equal(trigger.price)
      expect(orderState.delta).to.equal(trigger.delta)
      expect(orderState.interfaceFee1.amount).to.equal(100e6)
      expect(orderState.interfaceFee1.receiver).to.equal(owner.address)
      expect(orderState.interfaceFee1.unwrap).to.equal(true)
      expect(orderState.interfaceFee2.amount).to.equal(0)
      expect(orderState.interfaceFee2.receiver).to.equal(constants.AddressZero)
      expect(orderState.interfaceFee2.unwrap).to.equal(false)
    })

    it('places a tp order', async () => {
      let trigger = openTriggerOrder({
        delta: position.mul(-1),
        price: BigNumber.from(1100e6),
        side: Dir.S,
        comparison: Compare.ABOVE_MARKET,
      })
      let i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted

      // mkt price >= trigger price (false)
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false
      trigger = openTriggerOrder({
        delta: position.mul(-1),
        price: BigNumber.from(1200e6),
        side: Dir.L,
        comparison: Compare.ABOVE_MARKET,
      })
      i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })

      expect(await multiInvoker.connect(user).invoke(i)).to.not.be.reverted

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

      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      // order can be stopped
      trigger = openTriggerOrder({
        delta: position.mul(-1),
        price: BigNumber.from(1100e6),
        side: Dir.L,
        comparison: Compare.BELOW_MARKET,
      })
      i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted

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

      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      trigger = openTriggerOrder({
        delta: collateral.div(-4),
        price: BigNumber.from(1100e6),
        side: Dir.C,
        comparison: Compare.BELOW_MARKET,
      })
      i = buildPlaceOrder({ market: market.address, short: position, collateral: collateral, order: trigger })
      await expect(multiInvoker.connect(user).invoke(i)).to.not.be.reverted

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

      await expect(multiInvoker.connect(user).invoke(placeAction)).to.not.be.reverted

      // cancel the order
      const cancelAction = buildCancelOrder({ market: market.address, orderId: 1 })
      await expect(multiInvoker.connect(user).invoke(cancelAction))
        .to.emit(multiInvoker, 'OrderCancelled')
        .withArgs(user.address, market.address, 1)

      expect(await multiInvoker.latestNonce()).to.eq(1)
    })

    describe('#reverts on', async () => {
      it('reverts update, vaultUpdate, placeOrder on InvalidInstanceError', async () => {
        await expect(
          multiInvoker.connect(user).invoke(buildUpdateMarket({ market: vault.address })),
        ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')

        await expect(
          multiInvoker.connect(user).invoke(buildUpdateVault({ vault: market.address })),
        ).to.be.revertedWithCustomError(multiInvoker, 'MultiInvokerInvalidInstanceError')

        const trigger = openTriggerOrder({
          delta: collateral,
          price: 1100e6,
          side: Dir.L,
          comparison: Compare.ABOVE_MARKET,
        })

        await expect(
          multiInvoker
            .connect(user)
            .invoke(buildPlaceOrder({ market: vault.address, collateral: collateral, order: trigger })),
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
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

        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
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

        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
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

        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(await multiInvoker.connect(user).invoke(execOrder))
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

        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(await multiInvoker.connect(user).invoke(execOrder))
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

        await multiInvoker.connect(user).invoke(placeOrder)
        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(await multiInvoker.connect(user).invoke(execOrder))
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
          interfaceFee1: { receiver: owner.address, amount: 100e6, unwrap: false },
          interfaceFee2: { receiver: constants.AddressZero, amount: 0, unwrap: false },
        })

        const placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          order: trigger,
        })

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
          .to.emit(multiInvoker, 'InterfaceFeeCharged')
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

        await multiInvoker.connect(user).invoke(placeOrder)
        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(await multiInvoker.connect(user).invoke(execOrder))
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

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

        // charge fee
        dsu.transfer.returns(true)
        const execOrder = buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

        // buffer: 100000
        await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await expect(multiInvoker.connect(owner).invoke(execOrder, { maxFeePerGas: 100000000 }))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
          .withArgs(owner.address, anyValue, anyValue, anyValue, anyValue, anyValue)
      })
    })
  })
})
