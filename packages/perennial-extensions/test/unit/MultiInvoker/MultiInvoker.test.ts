import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, BigNumberish, constants, utils } from 'ethers'

import {
  IMultiInvoker,
  MultiInvoker,
  MultiInvoker__factory,
  IMarket,
  IBatcher,
  IEmptySetReserve,
  IERC20,
  IPayoffProvider,
  KeeperManager,
  IMarketFactory,
  Market__factory,
  AggregatorV3Interface,
  IVaultFactory,
  IVault,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import * as helpers from '../../helpers/invoke'
import type { Actions } from '../../helpers/invoke'

import {
  IOracleProvider,
  OracleVersionStruct,
} from '../../../types/generated/@equilibria/perennial-v2-oracle/contracts/IOracleProvider'
import {
  MarketParameterStruct,
  PController6Struct,
} from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { PositionStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'

import { Local, parse6decimal } from '../../../../common/testutil/types'
import { openPosition, setMarketPosition, setPendingPosition } from '../../helpers/types'
import { impersonate } from '../../../../common/testutil'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

const ethers = { HRE }
use(smock.matchers)

const ZERO = BigNumber.from(0)

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
      batcher.address,
      reserve.address,
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
      updatedAt: 0,
      answeredInRound: 0,
    }

    invokerOracle.latestRoundData.returns(aggRoundData)
    market.oracle.returns(marketOracle.address)
    marketOracle.latest.returns(oracleVersion)

    usdc.transferFrom.whenCalledWith(user.address).returns(true)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    vaultFactory.instances.whenCalledWith(vault.address).returns(true)

    // approval
    dsu.approve.whenCalledWith(multiInvoker.address, market.address || vault.address).returns(true)

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

      expect(batcher.wrap).to.have.been.calledWith(dsuCollateral, multiInvoker.address)
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

      // simualte market update withdrawing collateral
      dsu.balanceOf.whenCalledWith(multiInvoker.address).returns(dsuCollateral)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      dsu.transferFrom.whenCalledWith(multiInvoker.address, batcher.address).returns(true)

      usdc.balanceOf.whenCalledWith(batcher.address).returns(dsuCollateral)

      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(batcher.unwrap).to.have.been.calledWith(dsuCollateral, user.address)
      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
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
      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
    })

    it('claims and unwraps assets from vault', async () => {
      vaultUpdate.claimAssets = collateral
      vaultUpdate.wrap = true
      const v = helpers.buildUpdateVault(vaultUpdate)

      await expect(multiInvoker.connect(user).invoke(v)).to.not.be.reverted

      expect(reserve.redeem).to.have.been.calledWith(dsuCollateral)
      expect(vault.update).to.have.been.calledWith(user.address, '0', '0', vaultUpdate.claimAssets)
      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
    })

    // it('approves market', async () => {

    // })

    // it('charges interface fee', async () => {

    // })
  })

  describe('#keeper order invoke', () => {
    const collateral = parse6decimal('10000')
    const position = parse6decimal('10')

    const defaultOrder = {
      isLong: true,
      maxFee: position.div(20), // 5% fee
      execPrice: BigNumber.from(1000e6),
      size: position,
    }

    const defaultLocal: Local = {
      currentId: 1,
      collateral: 0,
      reward: 0,
      protection: 0,
    }

    const defaultPosition: PositionStruct = {
      id: 1,
      timestamp: 1,
      maker: 0,
      long: position,
      short: 0,
      collateral: collateral,
      fee: 0,
      keeper: 0,
      delta: 0,
    }

    const fixture = async () => {
      market.locals.whenCalledWith(user.address).returns(defaultLocal)
      market.pendingPositions.whenCalledWith(user.address, 1).returns(defaultPosition)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('places a limit order', async () => {
      const a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      const txn = await multiInvoker.connect(user).invoke(a)

      expect(txn)
        .to.emit(multiInvoker, 'OrderPlaced')
        .withArgs(user.address, market.address, 1, 1, defaultOrder.execPrice, defaultOrder.maxFee)

      expect(await multiInvoker.latestNonce()).to.eq(1)
      expect(await multiInvoker.openOrders(user.address, market.address)).to.eq(1)

      const orderState = await multiInvoker.orders(user.address, market.address, 1)

      expect(
        orderState.isLong == defaultOrder.isLong &&
          orderState.maxFee.eq(defaultOrder.maxFee.toString()) &&
          orderState.execPrice.eq(defaultOrder.execPrice.toString()) &&
          orderState.size.eq(defaultOrder.size.toString()),
      ).to.be.true
    })

    it('opens a tp order', async () => {
      defaultOrder.execPrice = BigNumber.from(1200e6)

      let a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'TP' })
      await multiInvoker.connect(user).invoke(a)

      // mkt price >= trigger price (false)
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      defaultOrder.isLong = false
      a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'TP' })

      await multiInvoker.connect(user).invoke(a)

      // mkt price <= trigger price (true)
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
    })

    it('opens a sl order', async () => {
      // order cannot be stopped
      defaultOrder.execPrice = BigNumber.from(1100e6) // default mkt price: 1150
      let a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'SL' })
      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.false

      // order can be stopped
      defaultOrder.execPrice = BigNumber.from(1200e6)
      a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'SL' })
      await expect(multiInvoker.connect(user).invoke(a)).to.not.be.reverted

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.true
    })

    it('cancels an order', async () => {
      const cancelAction = helpers.buildCancelOrder({ market: market.address, orderId: 1 })

      // cancelling an order that does not exist
      await expect(multiInvoker.connect(user).invoke(cancelAction)).to.be.revertedWithPanic()

      expect(await multiInvoker.openOrders(user.address, market.address)).to.eq(0)
      expect(await multiInvoker.latestNonce()).to.eq(0)

      // place the order to cancel
      const placeAction = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'LM' })
      await expect(multiInvoker.connect(user).invoke(placeAction)).to.not.be.reverted

      // cancel the order
      await expect(multiInvoker.connect(user).invoke(cancelAction))
        .to.emit(multiInvoker, 'OrderCancelled')
        .withArgs(user.address, market.address, 1)

      expect(await multiInvoker.openOrders(user.address, market.address)).to.eq(0)
      expect(await multiInvoker.latestNonce()).to.eq(1)
    })

    it('executes a long limit, short limit, long tp/sl, short tp/sl order', async () => {
      const position = openPosition({
        maker: '0',
        long: defaultOrder.size,
        short: '0',
        collateral: collateral,
      })

      dsu.transfer.returns(true)
      setPendingPosition(market, user, 0, position)

      // -------------------------------------------- //
      // long limit: mkt price <= exec price
      defaultOrder.execPrice = BigNumber.from(1200e6)

      let placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'LM' })
      await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

      let execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })
      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperCall')

      // -------------------------------------------- //
      // short limit: mkt price >= exec price
      defaultOrder.execPrice = BigNumber.from(1000e6)
      defaultOrder.isLong = false

      placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'LM' })
      await multiInvoker.connect(user).invoke(placeOrder)

      setPendingPosition(market, user, 0, position)

      execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 2 })

      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperCall')

      // -------------------------------------------- //
      // long tp / short sl: mkt price >= exec price
      placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'SL' })
      await multiInvoker.connect(user).invoke(placeOrder)

      execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 3 })
      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperCall')

      // -------------------------------------------- //
      // long sl / short tp:
      defaultOrder.isLong = true
      defaultOrder.execPrice = BigNumber.from(1200e6)

      placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder, triggerType: 'SL' })
      await multiInvoker.connect(user).invoke(placeOrder)

      execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 4 })
      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperCall')
    })

    it('executes an order and charges keeper fee to sender', async () => {
      // long limit: limit = true && mkt price (1150) <= exec price 1200
      defaultOrder.execPrice = BigNumber.from(1200e6)

      const position = openPosition({
        maker: '0',
        long: defaultOrder.size,
        short: '0',
        collateral: collateral,
      })

      const placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

      setPendingPosition(market, user, '0', position)

      // charge fee
      dsu.transfer.returns(true)

      const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

      // buffer: 100000
      await expect(multiInvoker.connect(owner).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperCall')
        .withArgs(owner.address, BigNumber.from(3839850), anyValue, anyValue, anyValue)
    })
  })
})
