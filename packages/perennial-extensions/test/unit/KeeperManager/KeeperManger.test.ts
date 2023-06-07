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

import { OracleVersionStruct } from '../../../types/generated/@equilibria/perennial-v2-oracle/contracts/IOracleProvider'

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
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
    keeper = await new KeeperManager__factory(owner).deploy(invoker.address)

    const oracleVersion: OracleVersionStruct = {
      version: BigNumber.from(0),
      timestamp: BigNumber.from(0),
      price: BigNumber.from(11501e6),
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
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      // expect(await keeper.MAX_PCT()).to.equal(100)

      expect(await keeper.invoker()).to.equal(invoker.address)
      expect(await keeper.orderNonce()).to.equal(BigNumber.from(0))
      expect(await keeper.numOpenOrders(user.address, market.address)).to.equal(0)

      expect((await market.parameter()).oracle).to.equal(oracle.address)
      expect((await oracle.latest()).price).to.equal(BigNumber.from(11501e6))
    })
  })

  describe('#Orders', () => {
    const size = utils.parseEther('1000')

    const defaultOrder: IKeeperManager.OrderStruct = {
      isLimit: true,
      isLong: true,
      maxFee: size.div(20), // 5% fee
      execPrice: BigNumber.from(10001e6),
      size: size,
    }

    it('opens an order', async () => {
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
  })
})
