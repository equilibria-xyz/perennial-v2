import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import {
  IERC20,
  IKeeperManager,
  IMarket,
  IOracleProvider,
  IOracleProvider__factory,
  IPayoffProvider,
  KeeperManager,
  KeeperManager__factory,
} from '../../../types/generated'

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { OracleVersionStruct } from '../../../types/generated/@equilibria/perennial-v2-oracle/contracts/IOracleProvider'
import { MarketParameterStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'

const ethers = { HRE }
use(smock.matchers)

describe('KeeperManager', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let invoker: SignerWithAddress
  let market: FakeContract<IMarket>
  let oracle: FakeContract<IOracleProvider>
  let payoff: FakeContract<IPayoffProvider>
  let dsu: FakeContract<IERC20>
  let keeper: KeeperManager

  const multiInvokerFixture = async () => {
    ;[owner, user, invoker] = await ethers.HRE.ethers.getSigners()
  }

  beforeEach(async () => {
    await loadFixture(multiInvokerFixture)

    dsu = await smock.fake<IERC20>('IERC20')
    market = await smock.fake<IMarket>('IMarket')
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    payoff = await smock.fake<IPayoffProvider>('IPayoffProvider')
    keeper = await new KeeperManager__factory(owner).deploy()

    // Default mkt price: 1150
    const oracleVersion: OracleVersionStruct = {
      version: BigNumber.from(0),
      timestamp: BigNumber.from(0),
      price: BigNumber.from(1150e6),
      valid: true,
    }

    const marketParam: MarketParameterStruct = {
      maintenance: '0',
      fundingFee: '0',
      takerFee: '0',
      makerFee: '0',
      positionFee: '0',
      makerLimit: '0',
      closed: false,
      makerRewardRate: '0',
      longRewardRate: '0',
      shortRewardRate: '0',
      utilizationCurve: {
        minRate: '0',
        maxRate: '0',
        targetRate: '0',
        targetUtilization: '0',
      },
      oracle: oracle.address,
      payoff: payoff.address,
    }

    const marketDefinition: IMarket.MarketDefinitionStruct = {
      name: 'Mock Market',
      symbol: 'MM',
      token: dsu.address,
      reward: dsu.address,
    }

    oracle.latest.returns(oracleVersion)
    market.parameter.returns(marketParam)

    await market.connect(owner).initialize(marketDefinition, marketParam)
    await keeper.connect(owner).initialize(invoker.address)
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      // expect(await keeper.MAX_PCT()).to.equal(100)

      expect(await keeper.invoker()).to.equal(invoker.address)
      expect(await keeper.orderNonce()).to.equal(BigNumber.from(0))
      expect(await keeper.numOpenOrders(user.address, market.address)).to.equal(0)

      expect((await market.parameter()).oracle).to.equal(oracle.address)
      expect((await oracle.latest()).price).to.equal(BigNumber.from(1150e6))
    })
  })

  describe('#Orders', () => {
    const size = utils.parseEther('1000')
    // default exec price +1000
    const defaultOrder: IKeeperManager.OrderStruct = {
      isLimit: true,
      isLong: true,
      maxFee: size.div(20), // 5% fee
      execPrice: BigNumber.from(1000e6),
      size: size,
    }

    it('opens a limit order', async () => {
      const txn = keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      expect(await txn)
        .to.emit(keeper, 'OrderPlaced')
        .withArgs(user.address, market.address, 1, 1, defaultOrder.execPrice, defaultOrder.maxFee)

      expect(await keeper.orderNonce()).to.eq(1)
      expect(await keeper.numOpenOrders(user.address, market.address)).to.eq(1)

      const orderState = await keeper.readOrder(user.address, market.address, 1)

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
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      // can execute = 1200 >= mkt price (1150)
      expect(await keeper.canExecuteOrder(user.address, market.address, 1)).to.be.true

      defaultOrder.execPrice = BigNumber.from(1100e6)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      // can execute = !(1100 >= mkt price (1150))
      expect(await keeper.canExecuteOrder(user.address, market.address, 2)).to.be.false
    })

    it('opens a sl order', async () => {
      defaultOrder.isLimit = false
      defaultOrder.execPrice = BigNumber.from(-1100e6)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      // can execute = |-1100| <= mkt price (1150)
      expect(await keeper.canExecuteOrder(user.address, market.address, 1)).to.be.true

      defaultOrder.execPrice = BigNumber.from(-1200e6)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      // can execute = |-1200| !<= mkt.price
      expect(await keeper.canExecuteOrder(user.address, market.address, 2)).to.be.false
    })

    it('updates an order', async () => {
      defaultOrder.isLimit = true
      await expect(
        keeper.connect(invoker).updateOrder(user.address, market.address, 1, defaultOrder),
      ).to.be.revertedWith('KeeperManager_UpdateOrder_OrderDoesNotExist')

      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      defaultOrder.execPrice = BigNumber.from(1300e6)
      defaultOrder.size = BigNumber.from(utils.parseEther('2000'))
      defaultOrder.maxFee = defaultOrder.size.div(20) // 100 ether

      await expect(keeper.connect(invoker).updateOrder(user.address, market.address, 1, defaultOrder))
        .to.emit(keeper, 'OrderUpdated')
        .withArgs(user.address, market.address, 1, defaultOrder.execPrice, defaultOrder.maxFee)

      const openOrder = await keeper.readOrder(user.address, market.address, 1)

      expect(
        defaultOrder.execPrice.eq(openOrder.execPrice) &&
          defaultOrder.maxFee.eq(openOrder.maxFee) &&
          defaultOrder.size.eq(openOrder.size),
      ).to.be.true
    })

    it('cancels an order', async () => {
      await expect(keeper.connect(invoker).cancelOrder(user.address, market.address, 1)).to.not.emit(
        keeper,
        'OrderCancelled',
      )

      expect(await keeper.numOpenOrders(user.address, market.address)).to.eq(0)
      expect(await keeper.orderNonce()).to.eq(0)

      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)

      await expect(keeper.connect(invoker).cancelOrder(user.address, market.address, 1))
        .to.emit(keeper, 'OrderCancelled')
        .withArgs(user.address, market.address, 1)

      expect(await keeper.numOpenOrders(user.address, market.address)).to.eq(0)
      expect(await keeper.orderNonce()).to.eq(1)
    })

    it('executes a long limit, short limit, long tp/sl, short tp/sl order', async () => {
      defaultOrder.isLimit = true

      // long limit: limit = true && mkt price (1150) <= exec price 1200
      defaultOrder.execPrice = BigNumber.from(1200e6)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)
      await expect(keeper.connect(invoker).executeOrder(user.address, market.address, 1)).to.emit(
        keeper,
        'OrderExecuted',
      )

      // short limit: limit = true && mkt price (1150) >= exec price (|-1100|)
      defaultOrder.execPrice = BigNumber.from(-1000e6)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)
      await expect(keeper.connect(invoker).executeOrder(user.address, market.address, 2)).to.emit(
        keeper,
        'OrderExecuted',
      )

      defaultOrder.isLimit = false
      // long tp / short sl: limit = false && mkt price (1150) >= exec price (|-1100|)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)
      await expect(keeper.connect(invoker).executeOrder(user.address, market.address, 3)).to.emit(
        keeper,
        'OrderExecuted',
      )

      // long sl / short tp: limit = false && mkt price(1150) <= exec price 1200
      defaultOrder.execPrice = BigNumber.from(1200e6)
      await keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)
      await expect(keeper.connect(invoker).executeOrder(user.address, market.address, 4)).to.emit(
        keeper,
        'OrderExecuted',
      )
    })

    it('opens max # of orders for market user', async () => {
      for (let i = 0; i < 11; i++) {
        //let txn = keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)
        if (i < 10) {
          expect(keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder)).to.not.be.reverted
        } else {
          await expect(
            keeper.connect(invoker).placeOrder(user.address, market.address, defaultOrder),
          ).to.be.revertedWith('KeeperManager_PlaceOrder_MaxOpenOrders()')
        }
      }
    })
  })
})
