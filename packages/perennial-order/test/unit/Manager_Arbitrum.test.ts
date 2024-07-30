import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'

import { parse6decimal } from '../../../common/testutil/types'
import { IERC20, IMarketFactory, IMarket } from '@equilibria/perennial-v2/types/generated'

import {
  AggregatorV3Interface,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../types/generated'

const { ethers } = HRE

const KEEP_CONFIG = {
  multiplierBase: 0,
  bufferBase: 1_000_000,
  multiplierCalldata: 0,
  bufferCalldata: 500_000,
}

const FIRST_ORDER_NONCE = BigNumber.from(300)

const MAKER_ORDER = {
  side: BigNumber.from(0),
  comparison: BigNumber.from(-2),
  price: parse6decimal('2222.33'),
  delta: parse6decimal('100'),
}

describe('Manager_Arbitrum', () => {
  let dsu: FakeContract<IERC20>
  let manager: Manager_Arbitrum
  let marketFactory: FakeContract<IMarketFactory>
  let market: FakeContract<IMarket>
  let verifier: IOrderVerifier
  let ethOracle: FakeContract<AggregatorV3Interface>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  const lastNonce = 0
  let lastOrderNonce = FIRST_ORDER_NONCE

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = await smock.fake<IERC20>('IERC20')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market = await smock.fake<IMarket>('IMarket')
    verifier = await new OrderVerifier__factory(owner).deploy()

    // deploy the order manager
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)

    dsu.approve.whenCalledWith(manager.address).returns(true)
    dsu.transferFrom.returns(true)
    dsu.transfer.returns(true)

    // initialize the order manager
    ethOracle = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    ethOracle.latestRoundData.returns({
      roundId: 0,
      answer: BigNumber.from(3131e8),
      startedAt: 0,
      updatedAt: 0,
      answeredInRound: 0,
    })
    await manager.initialize(ethOracle.address, KEEP_CONFIG)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  it('constructs and initializes', async () => {
    expect(await manager.DSU()).to.equal(dsu.address)
    expect(await manager.marketFactory()).to.equal(marketFactory.address)
    expect(await manager.verifier()).to.equal(verifier.address)
  })

  it('can place an order', async () => {
    await expect(manager.connect(userA).placeOrder(market.address, lastOrderNonce, MAKER_ORDER))
      .to.emit(manager, 'OrderPlaced')
      .withArgs(market.address, userA.address, MAKER_ORDER, lastOrderNonce)
    lastOrderNonce = lastOrderNonce.add(BigNumber.from(1))
  })

  it('can cancel an order', async () => {
    await manager.connect(userA).placeOrder(market.address, lastOrderNonce, MAKER_ORDER)

    await expect(manager.connect(userA).cancelOrder(market.address, lastOrderNonce))
      .to.emit(manager, 'OrderCancelled')
      .withArgs(market.address, userA.address, lastOrderNonce)
    lastOrderNonce = lastOrderNonce.add(BigNumber.from(1))
  })

  it('can replace an order', async () => {
    // submit the original order
    await manager.connect(userA).placeOrder(market.address, lastOrderNonce, MAKER_ORDER)

    const replacement = MAKER_ORDER
    replacement.price = parse6decimal('2333.44')

    // submit a replacement with the same order nonce
    await expect(manager.connect(userA).placeOrder(market.address, lastOrderNonce, replacement))
      .to.emit(manager, 'OrderPlaced')
      .withArgs(market.address, userA.address, replacement, lastOrderNonce)
    lastOrderNonce = lastOrderNonce.add(BigNumber.from(1))
  })

  it('cannot reuse an order nonce', async () => {
    // place and cancel an order, invalidating the order nonce
    await manager.connect(userA).placeOrder(market.address, lastOrderNonce, MAKER_ORDER)
    await manager.connect(userA).cancelOrder(market.address, lastOrderNonce)

    await expect(
      manager.connect(userA).placeOrder(market.address, lastOrderNonce, MAKER_ORDER),
    ).to.revertedWithCustomError(manager, 'ManagerInvalidOrderNonceError')
  })
})
