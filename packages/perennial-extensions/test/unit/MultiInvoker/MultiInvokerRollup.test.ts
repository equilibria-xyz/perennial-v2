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

import { parse6decimal } from '../../../../common/testutil/types'
import { openPosition, setMarketPosition, setPendingPosition } from '../../helpers/types'
import { impersonate } from '../../../../common/testutil'

import { TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider'

const ethers = { HRE }
use(smock.matchers)

const ZERO = BigNumber.from(0)

describe('MultiInvokerRollup', () => {
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
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
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
      oracle.address,
    )

    // Default mkt price: 1150
    const oracleVersion: OracleVersionStruct = {
      timestamp: BigNumber.from(0),
      price: BigNumber.from(1150e6),
      valid: true,
    }

    oracle.latest.returns(oracleVersion)
    market.oracle.returns(oracle.address)

    usdc.transferFrom.whenCalledWith(user.address).returns(true)
    factory.instances.whenCalledWith(market.address).returns(true)
    // set returns
  })

  describe('#invoke', () => {
    // @todo dont parse6 data offchain, use `from` on chain
    const collateral = parse6decimal('10000')
    const nCollateral = parse6decimal('-10000')
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
      expect(market.update).to.have.been.calledWith(user.address, '0', '0', '0', collateral, false)
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
      expect(market.update).to.have.been.calledWith(user.address, '0', '0', '0', collateral.mul(-1), false)
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
