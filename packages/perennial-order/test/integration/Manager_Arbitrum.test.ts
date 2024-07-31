import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { IERC20, IMarketFactory, IMarket } from '@equilibria/perennial-v2/types/generated'

import {
  AggregatorV3Interface,
  IOrderVerifier,
  Manager_Arbitrum,
  Manager_Arbitrum__factory,
  OrderVerifier__factory,
} from '../../types/generated'
import { signCancelOrderAction, signCommon, signPlaceOrderAction } from '../helpers/eip712'
import { deployProtocol } from '../helpers/arbitrumHelpers'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

const KEEP_CONFIG = {
  multiplierBase: 0,
  bufferBase: 1_000_000,
  multiplierCalldata: 0,
  bufferCalldata: 500_000,
}

const MAKER_ORDER = {
  side: BigNumber.from(0),
  comparison: BigNumber.from(-2),
  price: parse6decimal('2222.33'),
  delta: parse6decimal('100'),
}

const MAX_FEE = utils.parseEther('7')

describe('Manager_Arbitrum', () => {
  let dsu: IERC20
  let manager: Manager_Arbitrum
  let marketFactory: IMarketFactory
  let market: IMarket
  let verifier: IOrderVerifier
  let ethOracle: AggregatorV3Interface
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  const nextOrderNonce: { [key: string]: BigNumber } = {}

  function advanceOrderNonce(user: SignerWithAddress) {
    nextOrderNonce[user.address] = nextOrderNonce[user.address].add(BigNumber.from(1))
  }

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    ;[marketFactory, dsu] = await deployProtocol(owner)

    verifier = await new OrderVerifier__factory(owner).deploy()
    manager = await new Manager_Arbitrum__factory(owner).deploy(dsu.address, marketFactory.address, verifier.address)

    await manager.initialize(CHAINLINK_ETH_USD_FEED, KEEP_CONFIG)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    nextOrderNonce[userA.address] = BigNumber.from(100)
    nextOrderNonce[userB.address] = BigNumber.from(200)
  })

  it('constructs and initializes', async () => {
    expect(await manager.DSU()).to.equal(dsu.address)
    expect(await manager.marketFactory()).to.equal(marketFactory.address)
    expect(await manager.verifier()).to.equal(verifier.address)
  })
})
