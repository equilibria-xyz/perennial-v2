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
} from '../../../types/generated'
import { OracleVersionStruct } from '@equilibria/perennial-v2-oracle/types/generated/contracts/Oracle'
import { PositionStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import * as helpers from '../../helpers/invoke'
import { buildPlaceOrder, type Actions } from '../../helpers/invoke'

import { Local, parse6decimal } from '../../../../common/testutil/types'
import {
  openPosition,
  openTriggerOrder,
  setGlobalPrice,
  setMarketPosition,
  setPendingPosition,
} from '../../helpers/types'
import { impersonate } from '../../../../common/testutil'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

const ethers = { HRE }
use(smock.matchers)

describe('MultiInvoker', () => {
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
  let reward: FakeContract<IERC20>
  let marketFactory: FakeContract<IMarketFactory>
  let vaultFactory: FakeContract<IVaultFactory>
  let factorySigner: SignerWithAddress
  let multiInvoker: MultiInvoker

  const multiInvokerFixture = async () => {
    ;[owner, user] = await ethers.HRE.ethers.getSigners()
  }

  beforeEach(async () => {
    await loadFixture(multiInvokerFixture)

    usdc = await smock.fake<IERC20>('IERC20')
    dsu = await smock.fake<IERC20>('IERC20')
    reward = await smock.fake<IERC20>('IERC20')
    market = await smock.fake<IMarket>('IMarket')
    vault = await smock.fake<IVault>('IVault')
    marketOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    invokerOracle = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    batcher = await smock.fake<IBatcher>('IBatcher')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    vaultFactory = await smock.fake<IVaultFactory>('IVaultFactory')
    factorySigner = await impersonate.impersonateWithBalance(marketFactory.address, utils.parseEther('10'))

    multiInvoker = await new MultiInvoker__factory(owner).deploy(
      usdc.address,
      dsu.address,
      marketFactory.address,
      vaultFactory.address,
      '0x0000000000000000000000000000000000000000',
      reserve.address,
      parse6decimal('1.4'),
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
    marketOracle.latest.returns(oracleVersion)

    usdc.transferFrom.whenCalledWith(user.address).returns(true)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    vaultFactory.instances.whenCalledWith(vault.address).returns(true)

    dsu.approve.whenCalledWith(market.address || vault.address).returns(true)

    await multiInvoker.initialize(invokerOracle.address)
  })

  describe('#invoke', () => {
    const collateral = parse6decimal('10000')
    const dsuCollateral = collateral.mul(1e12)
    let vaultUpdate: helpers.VaultUpdate

    const fixture = async () => {
      vaultUpdate = { vault: vault.address }
      dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral.mul(1e12)).returns(true)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral).returns(true)
      usdc.transfer.whenCalledWith(user.address, collateral).returns(true)

      vault.update.returns(true)
      market.update.returns(true)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })
    // setMarketPosition(market, user, currentPosition)

    it('deposits collateral', async () => {
      const a = helpers.buildUpdateMarket({ market: market.address, collateral: collateral })

      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral.mul(1e12))
      expect(market.update).to.have.been.calledWith(user.address, '0', '0', '0', collateral, false)
    })

    it('wraps and deposits collateral', async () => {
      const a = helpers.buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })

      dsu.balanceOf.whenCalledWith(batcher.address).returns(constants.MaxUint256)

      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral)
    })

    it('wraps USDC to DSU using RESERVE if amount is greater than batcher balance', async () => {
      const a = helpers.buildUpdateMarket({ market: market.address, collateral: collateral, handleWrap: true })

      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)

      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      // old Token6 takes 18 decimals as argument for transfer, actual balance change is 6 decimals
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, collateral)
      expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
      expect(dsu.transfer).to.not.have.been.called
    })

    it('withdraws collateral', async () => {
      const a = helpers.buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1) })

      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
      expect(market.update).to.have.been.calledWith(user.address, '0', '0', '0', collateral.mul(-1), false)
    })

    it('withdraws and unwraps collateral', async () => {
      const a = helpers.buildUpdateMarket({ market: market.address, collateral: collateral.mul(-1), handleWrap: true })

      // simulate market update withdrawing collateral
      dsu.balanceOf.whenCalledWith(multiInvoker.address).returns(dsuCollateral)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      dsu.transferFrom.whenCalledWith(multiInvoker.address, batcher.address).returns(true)
      usdc.balanceOf.whenCalledWith(batcher.address).returns(collateral)

      await expect(await multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
    })

    it('deposits assets to vault', async () => {
      vaultUpdate.depositAssets = collateral
      const v = helpers.buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(vault.update).to.have.been.calledWith(user.address, vaultUpdate.depositAssets, '0', '0')
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, dsuCollateral)
    })

    it('wraps and deposits assets to vault', async () => {
      vaultUpdate.depositAssets = collateral
      vaultUpdate.wrap = true
      const v = helpers.buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
      expect(vault.update).to.have.been.calledWith(user.address, vaultUpdate.depositAssets, '0', '0')
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, vaultUpdate.depositAssets)
    })

    it('redeems from vault', async () => {
      vaultUpdate.redeemShares = collateral
      const v = helpers.buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(vault.update).to.have.been.calledWith(user.address, '0', vaultUpdate.redeemShares, '0')
      expect(dsu.transferFrom).to.not.have.been.called
      expect(usdc.transferFrom).to.not.have.been.called
    })

    it('claims assets from vault', async () => {
      vaultUpdate.claimAssets = collateral
      const v = helpers.buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
    })

    it('claims and unwraps assets from vault', async () => {
      vaultUpdate.claimAssets = collateral
      vaultUpdate.wrap = true
      const v = helpers.buildUpdateVault(vaultUpdate)

      dsu.balanceOf.returnsAtCall(0, 0)
      dsu.balanceOf.returnsAtCall(1, dsuCollateral)
      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
      expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
    })

    it('approves market and vault', async () => {
      // approve address not deployed from either factory fails
      let a: Actions = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [user.address]) }]

      await expect(multiInvoker.connect(owner).invoke(a)).to.have.been.revertedWithCustomError(
        multiInvoker,
        'MultiInvokerInvalidApprovalError',
      )

      // approve market succeeds
      a = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [market.address]) }]
      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted
      expect(dsu.approve).to.have.been.calledWith(market.address, helpers.MAX_INT)

      // approve vault succeeds
      a = [{ action: 8, args: utils.defaultAbiCoder.encode(['address'], [vault.address]) }]
      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted
      expect(dsu.approve).to.have.been.calledWith(vault.address, helpers.MAX_INT)
    })

    it('charges interface fee', async () => {
      usdc.transferFrom.returns(true)

      const c: Actions = [
        { action: 9, args: utils.defaultAbiCoder.encode(['address', 'uint256'], [owner.address, collateral]) },
      ]
      await expect(multiInvoker.connect(user).invoke(c)).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, owner.address, collateral)
    })
  })

  describe('#keeper order invoke', () => {
    const collateral = parse6decimal('10000')
    const position = parse6decimal('10')
    const price = BigNumber.from(1150e6)

    const defaultLocal: Local = {
      currentId: 1,
      latestId: 0,
      collateral: 0,
      reward: 0,
      protection: 0,
    }

    const defaultPosition: PositionStruct = {
      timestamp: 1,
      maker: 0,
      long: position,
      short: position,
      collateral: collateral,
      fee: 0,
      keeper: 0,
      delta: 0,
    }

    const fixture = async () => {
      market.pendingPositions.whenCalledWith(user.address, 1).returns(defaultPosition)
    }

    beforeEach(async () => {
      setGlobalPrice(market, BigNumber.from(1150e6))
      await loadFixture(fixture)
      setMarketPosition(market, user, defaultPosition)
      market.locals.whenCalledWith(user.address).returns(defaultLocal)
      dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral.mul(1e12)).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral).returns(true)
    })

    it('places a limit order', async () => {
      const trigger = openTriggerOrder({ size: position, price: price })
      const a = buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger })
      const txn = await multiInvoker.connect(user).invoke(a)

      setMarketPosition(market, user, defaultPosition)

      expect(txn)
        .to.emit(multiInvoker, 'OrderPlaced')
        .withArgs(user.address, market.address, 1, 1, trigger.price, trigger.fee)

      expect(await multiInvoker.latestNonce()).to.eq(1)

      const orderState = await multiInvoker.orders(user.address, market.address, 1)

      expect(
        orderState.side == trigger.side &&
          orderState.fee.eq(await trigger.fee) &&
          orderState.price.eq(await trigger.price) &&
          orderState.delta.eq(await trigger.delta),
      ).to.be.true
    })

    it('places a tp order', async () => {
      let trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6), side: 'S', trigger: 'TP' })
      let a = buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger, triggerType: 'TP' })
      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      // mkt price >= trigger price (false)
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      trigger = openTriggerOrder({ size: position, price: BigNumber.from(1200e6), side: 'S', trigger: 'TP' })
      a = buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger, triggerType: 'TP' })

      expect(await multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      // mkt price <= trigger price (true)
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
    })

    it('places a sl order', async () => {
      // order cannot be stopped
      let trigger = openTriggerOrder({ size: position, price: BigNumber.from(1200e6), side: 'S' })
      let a = buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger, triggerType: 'SL' })
      setMarketPosition(market, user, defaultPosition)

      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      // order can be stopped
      trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6), side: 'S' })
      a = buildPlaceOrder({ market: market.address, collateral: collateral, order: trigger, triggerType: 'SL' })
      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
    })

    it('cancels an order', async () => {
      expect(await multiInvoker.latestNonce()).to.eq(0)

      // place the order to cancel
      const trigger = openTriggerOrder({ size: position, price: price })
      const placeAction = buildPlaceOrder({
        market: market.address,
        collateral: collateral,
        order: trigger,
        triggerType: 'LM',
      })
      await expect(multiInvoker.connect(user).invoke(placeAction)).to.not.be.reverted

      // cancel the order
      const cancelAction = helpers.buildCancelOrder({ market: market.address, orderId: 1 })
      await expect(multiInvoker.connect(user).invoke(cancelAction))
        .to.emit(multiInvoker, 'OrderCancelled')
        .withArgs(user.address, market.address, 1)

      expect(await multiInvoker.latestNonce()).to.eq(1)
    })

    describe('#reverts on', async () => {
      it('reverts placeOrder on InvalidOrderError', async () => {
        // Case 0 fee
        let trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6), feePct: 0 })
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
        trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6) })
        placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          long: BigNumber.from(trigger.delta).abs(),
          order: trigger,
          comparisonOverride: -3,
        })

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
          multiInvoker,
          'MultiInvokerInvalidOrderError',
        )

        trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6) })
        placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          long: BigNumber.from(trigger.delta).abs(),
          order: trigger,
          comparisonOverride: 3,
        })

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
          multiInvoker,
          'MultiInvokerInvalidOrderError',
        )

        // -------------------------------------------------------------------------------------- //
        // case side == 0 || side > 2
        trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6) })
        placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          long: BigNumber.from(trigger.delta).abs(),
          order: trigger,
          sideOverride: 0,
        })

        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.be.revertedWithCustomError(
          multiInvoker,
          'MultiInvokerInvalidOrderError',
        )

        trigger = openTriggerOrder({ size: position, price: BigNumber.from(1100e6) })
        placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          long: BigNumber.from(trigger.delta).abs(),
          order: trigger,
          sideOverride: 3,
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
        const trigger = openTriggerOrder({ size: position, price: BigNumber.from(1200e6) })
        const pending = openPosition({ long: BigNumber.from(trigger.delta), collateral: collateral })
        setPendingPosition(market, user, 0, pending)

        const placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          order: trigger,
          triggerType: 'LM',
        })
        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

        const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
      })

      it('executes a short limit order', async () => {
        // set short position in market
        const triggerOrder = openTriggerOrder({
          size: position,
          price: BigNumber.from(1000e6),
          side: 'S',
          trigger: 'LM',
        })
        const pending = openPosition({ short: BigNumber.from(triggerOrder.delta).abs(), collateral: collateral })
        setPendingPosition(market, user, 0, pending)

        // short limit: mkt price >= exec price
        const placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          order: triggerOrder,
          triggerType: 'LM',
        })
        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
      })

      it('execues a short sl order', async () => {
        // set short position in market
        const triggerOrder = openTriggerOrder({
          size: position,
          price: BigNumber.from(1100e6),
          side: 'S',
          trigger: 'SL',
        })
        const pending = openPosition({ short: BigNumber.from(triggerOrder.delta).abs(), collateral: collateral })
        setPendingPosition(market, user, 0, pending)

        const placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          order: triggerOrder,
          triggerType: 'SL',
        })
        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
      })

      it('executes a long sl order', async () => {
        const triggerOrder = openTriggerOrder({
          size: position,
          price: BigNumber.from(1200e6),
          side: 'L',
          trigger: 'SL',
        })
        const pending = openPosition({ long: BigNumber.from(triggerOrder.delta).abs(), collateral: collateral })
        setPendingPosition(market, user, '0', pending)

        const placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          order: triggerOrder,
          triggerType: 'SL',
        })
        await multiInvoker.connect(user).invoke(placeOrder)

        const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
        await expect(await multiInvoker.connect(user).invoke(execOrder))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
      })

      it('executes an order and charges keeper fee to sender', async () => {
        // long limit: limit = true && mkt price (1150) <= exec price 1200
        const trigger = openTriggerOrder({ size: position, price: BigNumber.from(1200e6) })
        const pending = openPosition({ long: BigNumber.from(trigger.delta).abs(), collateral: collateral })
        setPendingPosition(market, user, '0', pending)

        const placeOrder = buildPlaceOrder({
          market: market.address,
          collateral: collateral,
          order: trigger,
          triggerType: 'LM',
        })
        await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

        // charge fee
        dsu.transfer.returns(true)
        const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

        // buffer: 100000
        await ethers.HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await expect(multiInvoker.connect(owner).invoke(execOrder, { maxFeePerGas: 100000000 }))
          .to.emit(multiInvoker, 'OrderExecuted')
          .to.emit(multiInvoker, 'KeeperCall')
          .withArgs(owner.address, anyValue, anyValue, anyValue, anyValue)
      })
    })
  })
})
