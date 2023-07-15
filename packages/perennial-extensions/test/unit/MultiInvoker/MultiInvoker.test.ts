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

const ethers = { HRE }
use(smock.matchers)

const ZERO = BigNumber.from(0)

describe('MultiInvoker', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let usdc: FakeContract<IERC20>
  let dsu: FakeContract<IERC20>
  let market: FakeContract<IMarket>
  let marketOracle: FakeContract<IOracleProvider>
  let invokerOracle: FakeContract<AggregatorV3Interface>
  let payoff: FakeContract<IPayoffProvider>
  let batcher: FakeContract<IBatcher>
  let reserve: FakeContract<IEmptySetReserve>
  let reward: FakeContract<IERC20>
  let factory: FakeContract<IMarketFactory>
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
    marketOracle = await smock.fake<IOracleProvider>('IOracleProvider')
    invokerOracle = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    payoff = await smock.fake<IPayoffProvider>('IPayoffProvider')
    batcher = await smock.fake<IBatcher>('IBatcher')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    factory = await smock.fake<IMarketFactory>('IMarketFactory')

    factorySigner = await impersonate.impersonateWithBalance(factory.address, utils.parseEther('10'))

    multiInvoker = await new MultiInvoker__factory(owner).deploy(
      usdc.address,
      dsu.address,
      factory.address,
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
    factory.instances.whenCalledWith(market.address).returns(true)

    await multiInvoker.initialize(invokerOracle.address)
  })

  describe('#invoke', () => {
    const collateral = parse6decimal('10000')
    const dsuCollateral = collateral.mul(1e12)

    const fixture = async () => {
      const placeOrder = helpers.buildPlaceOrder({
        market: market.address,
        long: collateral.div(2),
        collateral: collateral,
        order: { maxFee: '0' },
        // maxFee: collateral.div(20),
        // execPrice: BigNumber.from(1000e6),
      })

      dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral.mul(1e12)).returns(true)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, collateral).returns(true)
      usdc.transfer.whenCalledWith(user.address, collateral).returns(true)

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
  })

  describe('#keeper order invoke', () => {
    const collateral = parse6decimal('10000')
    const position = parse6decimal('10')

    const defaultOrder = {
      isLimit: true,
      isLong: true,
      maxFee: position.div(20), // 5% fee
      execPrice: BigNumber.from(1000e6),
      size: position,
    }

    // Default mkt price: 1150
    const oracleVersion: OracleVersionStruct = {
      timestamp: BigNumber.from(0),
      price: BigNumber.from(1150e6),
      valid: true,
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
      // await loadFixture(multiInvokerFixture)

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

      expect(await multiInvoker.orderNonce()).to.eq(1)
      expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(1)

      const orderState = await multiInvoker.readOrder(user.address, market.address, 1)

      expect(
        orderState.isLimit == defaultOrder.isLimit &&
          orderState.isLong == defaultOrder.isLong &&
          orderState.maxFee.eq(defaultOrder.maxFee.toString()) &&
          orderState.execPrice.eq(defaultOrder.execPrice.toString()) &&
          orderState.size.eq(defaultOrder.size.toString()),
      ).to.be.true
    })

    it('opens a tp order', async () => {
      defaultOrder.isLimit = false
      defaultOrder.execPrice = BigNumber.from(1200e6)

      let a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })

      await multiInvoker.connect(user).invoke(a)

      // can execute = 1200 >= mkt price (1150)

      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.true

      defaultOrder.execPrice = BigNumber.from(1100e6)
      a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })

      await multiInvoker.connect(user).invoke(a)

      // can execute = !(1100 >= mkt price (1150))
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.false
    })

    it('opens a sl order', async () => {
      defaultOrder.isLimit = false
      defaultOrder.execPrice = BigNumber.from(-1100e6)
      let a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })

      await multiInvoker.connect(user).invoke(a)

      // can execute = |-1100| <= mkt price (1150)
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 1)).to.be.true

      defaultOrder.execPrice = BigNumber.from(-1200e6)
      a = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })

      await multiInvoker.connect(user).invoke(a)

      // can execute = |-1200| !<= mkt.price
      expect(await multiInvoker.canExecuteOrder(user.address, market.address, 2)).to.be.false
    })

    it('cancels an order', async () => {
      const cancelAction = helpers.buildCancelOrder({ market: market.address, orderId: 1 })

      // cancelling an order that does not exist
      await expect(multiInvoker.connect(user).invoke(cancelAction)).to.not.emit(multiInvoker, 'OrderCancelled')

      expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(0)
      expect(await multiInvoker.orderNonce()).to.eq(0)

      // place the order to cancel
      const placeAction = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      await multiInvoker.connect(user).invoke(placeAction)

      // cancel the order
      await expect(multiInvoker.connect(user).invoke(cancelAction))
        .to.emit(multiInvoker, 'OrderCancelled')
        .withArgs(user.address, market.address, 1)

      expect(await multiInvoker.numOpenOrders(user.address, market.address)).to.eq(0)
      expect(await multiInvoker.orderNonce()).to.eq(1)
    })

    it('executes a long limit, short limit, long tp/sl, short tp/sl order', async () => {
      // long limit: limit = true && mkt price (1150) <= exec price 1200
      defaultOrder.isLimit = true
      defaultOrder.execPrice = BigNumber.from(1200e6)

      const position = openPosition({
        maker: '0',
        long: defaultOrder.size,
        short: '0',
        collateral: collateral,
      })

      dsu.transfer.returns(true)
      setPendingPosition(market, user, 0, position)

      let placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

      let execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

      await multiInvoker.connect(user).invoke(execOrder)
      // await expect(multiInvoker.connect(user).invoke(execOrder))
      //   .to.emit(multiInvoker, 'OrderExecuted')
      //   .to.emit(multiInvoker, 'KeeperFeeCharged')

      // short limit: limit = true && mkt price (1150) >= exec price (|-1100|)
      defaultOrder.execPrice = BigNumber.from(-1000e6)

      placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      await multiInvoker.connect(user).invoke(placeOrder)

      setPendingPosition(market, user, 0, position)

      execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 2 })
      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperFeeCharged')

      // long tp / short sl: limit = false && mkt price (1150) >= exec price (|-1100|)
      defaultOrder.isLimit = false

      placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      await multiInvoker.connect(user).invoke(placeOrder)

      execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 3 })
      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperFeeCharged')

      // long sl / short tp: limit = false && mkt price(1150) <= exec price 1200
      defaultOrder.execPrice = BigNumber.from(1200e6)

      placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
      await multiInvoker.connect(user).invoke(placeOrder)

      execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 4 })
      await expect(multiInvoker.connect(user).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperFeeCharged')
    })

    it('executes an order and charges keeper fee to sender', async () => {
      // long limit: limit = true && mkt price (1150) <= exec price 1200
      defaultOrder.isLimit = true
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

      // oracle.latest.returns(oracleVersion)

      await expect(multiInvoker.connect(owner).invoke(execOrder))
        .to.emit(multiInvoker, 'OrderExecuted')
        .to.emit(multiInvoker, 'KeeperFeeCharged')
        .withArgs(user.address, market.address, owner.address, BigNumber.from(3839850))
    })
  })
})
