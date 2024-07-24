import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'

import { parse6decimal } from '../../../common/testutil/types'
import { IERC20, IMarketFactory } from '@equilibria/perennial-v2/types/generated'

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

describe('Manager_Arbitrum', () => {
  let dsu: FakeContract<IERC20>
  let manager: Manager_Arbitrum
  let marketFactory: FakeContract<IMarketFactory>
  let verifier: IOrderVerifier
  let ethOracle: FakeContract<AggregatorV3Interface>
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  const lastNonce = 0

  const fixture = async () => {
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = await smock.fake<IERC20>('IERC20')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
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

  it('contructs and initializes', async () => {
    expect(await manager.DSU()).to.equal(dsu.address)
    expect(await manager.marketFactory()).to.equal(marketFactory.address)
    expect(await manager.verifier()).to.equal(verifier.address)
  })
})
