import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, BigNumberish, constants, utils } from 'ethers'

import {
  IMultiInvoker,
  IMarket,
  IBatcher,
  IEmptySetReserve,
  IERC20,
  IPayoffProvider,
  KeeperManager,
  IMarketFactory,
  Market__factory,
  MultiInvokerRollup,
  MultiInvokerRollup__factory,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import * as helpers from '../../helpers/invoke'
import { MAX_INT } from '../../helpers/invoke'

import {
  IOracleProvider,
  OracleVersionStruct,
} from '../../../types/generated/@equilibria/perennial-v2-oracle/contracts/IOracleProvider'
import {
  MarketParameterStruct,
  PController6Struct,
} from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { PositionStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'

import { parse6decimal } from '../../../../common/testutil/types'
import { openPosition, setMarketPosition, setPendingPosition } from '../../helpers/types'
import { impersonate } from '../../../../common/testutil'

import { TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider'
import { AggregatorV3Interface } from '@equilibria/perennial-v2/types/generated'

const ethers = { HRE }
use(smock.matchers)

const ZERO = BigNumber.from(0)

describe('MultiInvokerRollup', () => {
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
  let multiInvokerRollup: MultiInvokerRollup

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

    multiInvokerRollup = await new MultiInvokerRollup__factory(owner).deploy(
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

    await multiInvokerRollup.initialize(invokerOracle.address)
  })

  describe('#invoke', () => {
    const collateral = parse6decimal('10000')
    const nCollateral = parse6decimal('-10000')
    const dsuCollateral = collateral.mul(1e12)

    const fixture = async () => {
      dsu.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, dsuCollateral).returns(true)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, collateral).returns(true)
      usdc.transfer.whenCalledWith(user.address, collateral).returns(true)

      market.update.returns(true)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })
    // setMarketPosition(market, user, currentPosition)

    it('deposits collateral', async () => {
      const a = helpers.buildUpdateMarketRollup({ market: market.address, collateral: collateral })

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, collateral.mul(1e12))
      expect(market.update).to.have.been.calledWith(user.address, MAX_INT, MAX_INT, MAX_INT, collateral, false)
    })

    it('wraps and deposits collateral', async () => {
      const a = helpers.buildUpdateMarketRollup({ market: market.address, collateral: collateral, handleWrap: true })

      dsu.balanceOf.whenCalledWith(batcher.address).returns(constants.MaxUint256)

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted

      expect(batcher.wrap).to.have.been.calledWith(dsuCollateral, multiInvokerRollup.address)
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, collateral)
    })

    it('wraps USDC to DSU using RESERVE if amount is greater than batcher balance', async () => {
      const a = helpers.buildUpdateMarketRollup({ market: market.address, collateral: collateral, handleWrap: true })

      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted

      // old Token6 takes 18 decimals as argument for transfer, actual balance change is 6 decimals
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, collateral)
      expect(reserve.mint).to.have.been.calledWith(dsuCollateral)
      expect(dsu.transfer).to.not.have.been.called
    })

    it('withdraws collateral', async () => {
      const a = helpers.buildUpdateMarketRollup({ market: market.address, collateral: nCollateral })

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted

      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
      expect(market.update).to.have.been.calledWith(user.address, MAX_INT, MAX_INT, MAX_INT, collateral.mul(-1), false)
    })

    it('withdraws and unwraps collateral', async () => {
      const a = helpers.buildUpdateMarketRollup({
        market: market.address,
        collateral: collateral.mul(-1),
        handleWrap: true,
      })

      // simualte market update withdrawing collateral
      dsu.balanceOf.whenCalledWith(multiInvokerRollup.address).returns(dsuCollateral)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      dsu.transferFrom.whenCalledWith(multiInvokerRollup.address, batcher.address).returns(true)

      usdc.balanceOf.whenCalledWith(batcher.address).returns(dsuCollateral)

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted

      expect(batcher.unwrap).to.have.been.calledWith(dsuCollateral, user.address)
      expect(dsu.transfer).to.have.been.calledWith(user.address, dsuCollateral)
    })
  })

  describe('#keeper order invoke', () => {
    const collateral = parse6decimal('10000')
    const position = parse6decimal('10')
    const dsuCollateral = collateral.mul(1e12)

    const fixture = async () => {
      dsu.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, dsuCollateral).returns(true)
      dsu.transfer.whenCalledWith(user.address, dsuCollateral).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, collateral).returns(true)
      usdc.transfer.whenCalledWith(user.address, collateral).returns(true)

      market.update.returns(true)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    const defaultOrder = {
      isLimit: true,
      isLong: true,
      maxFee: position.div(20), // 5% fee
      execPrice: BigNumber.from(1000e6),
      size: position,
    }

    it('places a limit order', async () => {
      const a = helpers.buildPlaceOrderRollup({ market: market.address, collateral: collateral, order: defaultOrder })

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted
      // expect()
      //   .to.emit(multiInvokerRollup, 'OrderPlaced')
      //   .withArgs(user.address, market.address, 1, 1, defaultOrder.execPrice, defaultOrder.maxFee)

      expect(await multiInvokerRollup.orderNonce()).to.eq(1)
      expect(await multiInvokerRollup.numOpenOrders(user.address, market.address)).to.eq(1)

      const orderState = await multiInvokerRollup.readOrder(user.address, market.address, 1)

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

      let a = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })

      await expect(sendTx(user, multiInvokerRollup, a)).to.not.be.reverted

      // can execute = 1200 >= mkt price (1150)

      expect(await multiInvokerRollup.canExecuteOrder(user.address, market.address, 1)).to.be.true

      defaultOrder.execPrice = BigNumber.from(1100e6)
      a = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })

      await sendTx(user, multiInvokerRollup, a)

      // can execute = !(1100 >= mkt price (1150))
      expect(await multiInvokerRollup.canExecuteOrder(user.address, market.address, 2)).to.be.false
    })

    it('opens a sl order', async () => {
      defaultOrder.isLimit = false
      defaultOrder.execPrice = BigNumber.from(-1100e6)
      let a = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })

      await sendTx(user, multiInvokerRollup, a)

      // can execute = |-1100| <= mkt price (1150)
      expect(await multiInvokerRollup.canExecuteOrder(user.address, market.address, 1)).to.be.true

      defaultOrder.execPrice = BigNumber.from(-1200e6)
      a = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })

      await sendTx(user, multiInvokerRollup, a)

      // can execute = |-1200| !<= mkt.price
      expect(await multiInvokerRollup.canExecuteOrder(user.address, market.address, 2)).to.be.false
    })

    it('cancels an order', async () => {
      const cancelAction = helpers.buildCancelOrderRollup({ market: market.address, orderId: 1 })

      // cancelling an order that does not exist
      await expect(sendTx(user, multiInvokerRollup, cancelAction)).to.not.emit(multiInvokerRollup, 'OrderCancelled')

      expect(await multiInvokerRollup.numOpenOrders(user.address, market.address)).to.eq(0)
      expect(await multiInvokerRollup.orderNonce()).to.eq(0)

      // place the order to cancel
      const placeAction = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })
      await sendTx(user, multiInvokerRollup, placeAction)

      // cancel the order
      await expect(sendTx(user, multiInvokerRollup, cancelAction))
        .to.emit(multiInvokerRollup, 'OrderCancelled')
        .withArgs(user.address, market.address, 1)

      expect(await multiInvokerRollup.numOpenOrders(user.address, market.address)).to.eq(0)
      expect(await multiInvokerRollup.orderNonce()).to.eq(1)
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

      let placeOrder = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })
      await expect(sendTx(user, multiInvokerRollup, placeOrder)).to.not.be.reverted

      let execOrder = helpers.buildExecOrderRollup({ user: user.address, market: market.address, orderId: 1 })

      await expect(sendTx(user, multiInvokerRollup, execOrder)).to.emit(multiInvokerRollup, 'OrderExecuted')

      // short limit: limit = true && mkt price (1150) >= exec price (|-1100|)
      defaultOrder.isLong = false
      defaultOrder.execPrice = BigNumber.from(-1000e6)

      placeOrder = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })
      await expect(sendTx(user, multiInvokerRollup, placeOrder)).to.not.be.reverted

      setPendingPosition(market, user, 0, position)

      execOrder = helpers.buildExecOrderRollup({ user: user.address, market: market.address, orderId: 2 })
      await expect(sendTx(user, multiInvokerRollup, execOrder)).to.emit(multiInvokerRollup, 'OrderExecuted')

      // long tp / short sl: limit = false && mkt price (1150) >= exec price (|-1100|)
      defaultOrder.isLimit = false

      placeOrder = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })
      //await expect(
      await sendTx(user, multiInvokerRollup, placeOrder)
      //).to.not.be.reverted

      execOrder = helpers.buildExecOrderRollup({ user: user.address, market: market.address, orderId: 3 })
      await expect(sendTx(user, multiInvokerRollup, execOrder)).to.emit(multiInvokerRollup, 'OrderExecuted')

      // long sl / short tp: limit = false && mkt price(1150) <= exec price 1200
      defaultOrder.execPrice = BigNumber.from(1200e6)

      placeOrder = helpers.buildPlaceOrderRollup({ market: market.address, order: defaultOrder })
      await expect(sendTx(user, multiInvokerRollup, placeOrder)).to.not.be.reverted

      execOrder = helpers.buildExecOrderRollup({ user: user.address, market: market.address, orderId: 4 })
      await expect(sendTx(user, multiInvokerRollup, placeOrder)).to.emit(multiInvokerRollup, 'OrderExecuted')
    })

    // it('executes an order and charges keeper fee to sender', async () => {
    //   // long limit: limit = true && mkt price (1150) <= exec price 1200
    //   defaultOrder.isLimit = true
    //   defaultOrder.execPrice = BigNumber.from(1200e6)

    //   const position = openPosition({
    //     maker: '0',
    //     long: defaultOrder.size,
    //     short: '0',
    //     collateral: collateral,
    //   })

    //   const placeOrder = helpers.buildPlaceOrder({ market: market.address, order: defaultOrder })
    //   await expect(multiInvokerRollup.connect(user).invoke(placeOrder)).to.not.be.reverted

    //   setPendingPosition(market, user, '0', position)

    //   // charge fee
    //   dsu.transfer.returns(true)

    //   const execOrder = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: 1 })

    //   // oracle.latest.returns(oracleVersion)

    //   await expect(multiInvokerRollup.connect(owner).invoke(execOrder))
    //     .to.emit(multiInvokerRollup, 'OrderExecuted')
    //     .to.emit(multiInvokerRollup, 'KeeperFeeCharged')
    //     .withArgs(user.address, market.address, owner.address, BigNumber.from(3839850))
    // })
  })
})

function sendTx(user: SignerWithAddress, invoker: MultiInvokerRollup, payload: string): Promise<TransactionResponse> {
  return user.sendTransaction(buildTransactionRequest(user, invoker, payload))
}

function buildTransactionRequest(
  user: SignerWithAddress,
  invoker: MultiInvokerRollup,
  payload: string,
): TransactionRequest {
  const txn: TransactionRequest = {
    from: user.address,
    to: invoker.address,
    data: '0x' + payload,
    gasLimit: 2.5e7,
  }
  return txn
}
