import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

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
  KeeperManager__factory,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import * as helpers from '../../helpers/invoke'
import type { Actions } from '../../helpers/invoke'

import {
  IOracleProvider,
  OracleVersionStruct,
} from '../../../types/generated/@equilibria/perennial-v2-oracle/contracts/IOracleProvider'
import { MarketParameterStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { PositionStruct } from '../../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { parse6decimal } from '../../../../common/testutil/types'

const ethers = { HRE }
use(smock.matchers)

describe('MultiInvoker', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let usdc: FakeContract<IERC20>
  let dsu: FakeContract<IERC20>
  let market: FakeContract<IMarket>
  let oracle: FakeContract<IOracleProvider>
  let payoff: FakeContract<IPayoffProvider>
  let batcher: FakeContract<IBatcher>
  let reserve: FakeContract<IEmptySetReserve>
  let reward: FakeContract<IERC20>
  let keeper: KeeperManager
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
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    payoff = await smock.fake<IPayoffProvider>('IPayoffProvider')
    batcher = await smock.fake<IBatcher>('IBatcher')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')

    keeper = await new KeeperManager__factory(owner).deploy()

    multiInvoker = await new MultiInvoker__factory(owner).deploy(
      usdc.address,
      dsu.address,
      batcher.address,
      reserve.address,
      oracle.address,
      keeper.address,
    )

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
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: reward.address,
    }

    oracle.latest.returns(oracleVersion)
    market.parameter.returns(marketParam)

    await market.connect(owner).initialize(marketDefinition, marketParam)
    await keeper.initialize(multiInvoker.address)

    usdc.transferFrom.whenCalledWith(user.address).returns(true)

    // set returns
  })

  describe('#constructor', () => {
    // it('constructs correctly', async () => {
    // })
  })

  describe('#initialize', () => {
    // it('initializes correctly', () => {
    // })
  })

  describe('#invoke', () => {
    const collateral = parse6decimal('10000')
    const dsuCollateral = collateral.mul(1e12)

    const fixture = async () => {
      const placeOrder = helpers.buildPlaceOrder({
        market: market.address,
        long: collateral.div(2),
        collateral: collateral,
        maxFee: collateral.div(20),
        execPrice: BigNumber.from(1000e6),
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
      expect(market.update).to.have.been.calledWith(user.address, '0', '0', '0', collateral)
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
      expect(market.update).to.have.been.calledWith(user.address, '0', '0', '0', collateral.mul(-1))
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

    // it('opens an order', async () => {

    //     // await expect(multiInvoker.connect(user).invoke(placeOrder)).to.not.be.reverted

    //     // handle wrap false

    // })

    it('executes an order from a keeper', async () => {
      const a = helpers.buildExecOrder({ user: user.address, market: market.address, orderId: '1' })
      expect(keeper.executeOrder).to.have.been.calledWith(user.address, market.address, 1)
    })

    // it('executes an order from the user', async () => {

    // })
  })
})

function setMarketPosition(market: FakeContract<IMarket>, user: SignerWithAddress, position: PositionStruct) {
  market.positions.whenCalledWith(user.address).returns(position)
}
