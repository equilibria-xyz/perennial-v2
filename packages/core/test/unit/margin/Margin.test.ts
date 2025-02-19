import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { impersonate } from '../../../../common/testutil'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import {
  DEFAULT_GUARANTEE,
  DEFAULT_LOCAL,
  DEFAULT_ORACLE_VERSION,
  parse6decimal,
} from '../../../../common/testutil/types'
import {
  IMarket,
  IERC20Metadata,
  Margin__factory,
  IMargin,
  CheckpointStorageLib__factory,
  MockToken,
  MockToken__factory,
  IMarketFactory,
  Margin,
  IOracleProvider,
} from '../../../types/generated'
import { CheckpointStruct } from '../../../types/generated/contracts/Margin'
import { PositionStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

describe('Margin', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let dsu: FakeContract<IERC20Metadata>
  let marketFactory: FakeContract<IMarketFactory>
  let marketA: FakeContract<IMarket>
  let marketB: FakeContract<IMarket>
  let oracle: FakeContract<IOracleProvider>

  function fakeAuthorization(account: SignerWithAddress, sender: SignerWithAddress, isOperator = true) {
    marketFactory.authorization
      .whenCalledWith(account.address, sender.address, constants.AddressZero, constants.AddressZero)
      .returns([isOperator, false, constants.Zero])
  }

  async function fakeMarket(): Promise<FakeContract<IMarket>> {
    const market = await smock.fake<IMarket>('IMarket')
    market.factory.whenCalledWith().returns(marketFactory.address)
    market.oracle.whenCalledWith().returns(oracle.address)
    market.stale.returns(false)
    return market
  }

  beforeEach(async () => {
    ;[owner, user, userB] = await ethers.getSigners()

    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    marketFactory.authorization.returns([true, false, constants.Zero])

    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    oracle.latest.whenCalledWith().returns({
      timestamp: BigNumber.from(1567310400),
      price: constants.Zero,
      valid: true,
    })

    marketA = await fakeMarket()
    marketB = await fakeMarket()
  })

  describe('normal operation', async () => {
    let margin: IMargin

    // fakes an update from market which adds the market to cross-margin collections
    async function cross(user: SignerWithAddress, market: FakeContract<IMarket>) {
      const marketSigner = await impersonate.impersonateWithBalance(market.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).handleMarketUpdate(user.address, 0))
        .to.emit(margin, 'MarketCrossed')
        .withArgs(user.address, market.address)
    }

    async function deposit(sender: SignerWithAddress, amount: BigNumber, target?: SignerWithAddress) {
      if (!target) target = sender
      const balanceBefore = await margin.crossMarginBalances(target.address)

      dsu.transferFrom.whenCalledWith(sender.address, margin.address, amount.mul(1e12)).returns(true)
      await expect(margin.connect(sender).deposit(target.address, amount))
        .to.emit(margin, 'FundsDeposited')
        .withArgs(target.address, amount)

      expect(await margin.crossMarginBalances(target.address)).to.equal(balanceBefore.add(amount))
    }

    function fakeOraclePrice(price: BigNumber) {
      oracle.status.returns([
        {
          ...DEFAULT_ORACLE_VERSION,
          price,
        },
        0,
      ])
    }

    // fakes guarantees with long position of 1 and notional 100, implying price near 100
    function fakeGuarantees(
      user: SignerWithAddress,
      market: FakeContract<IMarket>,
      numberOfGuarantees: number,
      notional: BigNumber,
    ) {
      const local = {
        ...DEFAULT_LOCAL,
        latestId: 9,
        currentId: 9 + numberOfGuarantees,
      }
      market.locals.whenCalledWith(user.address).returns(local)

      for (let i = 0; i < numberOfGuarantees; i++) {
        const guarantee = {
          ...DEFAULT_GUARANTEE,
          longPos: parse6decimal('1'),
          notional: notional,
        } // price adjustment will be (longPos * oraclePrice) - notional
        market.guarantees.whenCalledWith(user.address, 10 + i).returns(guarantee)
      }
    }

    beforeEach(async () => {
      margin = await new Margin__factory(
        {
          'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy(dsu.address)
      await margin.initialize(marketFactory.address)
    })

    it('initialize with the correct variables set', async () => {
      expect(await margin.DSU()).to.equal(dsu.address)
      expect(await margin.marketFactory()).to.equal(marketFactory.address)
    })

    it('deposits funds to margin contract', async () => {
      await deposit(user, parse6decimal('3500.153'))
    })

    it('can deposit funds to another account', async () => {
      await deposit(user, parse6decimal('20'), userB)
    })

    it('withdraws funds from margin contract', async () => {
      // deposit
      const depositAmount = parse6decimal('600')
      await deposit(user, depositAmount)

      // reverts when attempting to withdraw too much
      let withdrawalAmount = parse6decimal('609')
      dsu.transfer.whenCalledWith(user.address, withdrawalAmount.mul(1e12)).returns(true)
      await expect(margin.connect(user).withdraw(user.address, withdrawalAmount)).to.be.revertedWithCustomError(
        margin,
        'MarginInsufficientCrossedBalance',
      )

      // performs partial withdrawal
      withdrawalAmount = parse6decimal('303')
      dsu.transfer.whenCalledWith(user.address, withdrawalAmount.mul(1e12)).returns(true)
      await expect(margin.connect(user).withdraw(user.address, withdrawalAmount))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, withdrawalAmount)
      expect(await margin.crossMarginBalances(user.address)).to.equal(depositAmount.sub(withdrawalAmount))

      // performs complete withdrawal
      withdrawalAmount = parse6decimal('297')
      dsu.transfer.whenCalledWith(user.address, withdrawalAmount.mul(1e12)).returns(true)
      await expect(margin.connect(user).withdraw(user.address, withdrawalAmount))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, withdrawalAmount)
      expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)
    })

    it('operators may withdraw funds', async () => {
      // deposit
      const amount = parse6decimal('80')
      await deposit(user, amount)

      // non-operator cannot withdraw
      fakeAuthorization(user, userB, false)
      await expect(margin.connect(userB).withdraw(user.address, amount)).to.be.revertedWithCustomError(
        margin,
        'MarginOperatorNotAllowedError',
      )

      // operator can withdraw, and tokens are sent to sender
      fakeAuthorization(user, userB, true)
      dsu.transfer.whenCalledWith(userB.address, amount.mul(1e12)).returns(true)
      await expect(margin.connect(userB).withdraw(user.address, amount))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, amount)
      expect(dsu.transfer).to.have.been.calledWith(userB.address, amount.mul(1e12))
    })

    it('user can withdraw claimable funds', async () => {
      const feeEarned = parse6decimal('0.2')
      const marketSigner = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).updateClaimable(user.address, feeEarned)).to.not.be.reverted
      expect(await margin.claimables(user.address)).to.equal(feeEarned)

      dsu.transfer.whenCalledWith(user.address, feeEarned.mul(1e12)).returns(true)
      const feeReturned = await margin.connect(user).callStatic.claim(user.address, user.address)
      expect(feeReturned).to.equal(feeEarned)
      await expect(margin.connect(user).claim(user.address, user.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, user.address, feeEarned)
      expect(dsu.transfer).to.have.been.calledWith(user.address, feeEarned.mul(1e12))
    })

    it('user cannot withdraw negative claimable balance from exposure', async () => {
      const deficit = parse6decimal('-0.3')
      const marketSigner = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).updateClaimable(user.address, deficit)).to.not.be.reverted
      expect(await margin.claimables(user.address)).to.equal(deficit)

      await expect(margin.connect(user).claim(user.address, user.address)).to.be.revertedWithCustomError(
        margin,
        'UFixed6UnderflowError',
      )
    })

    it('user can withdraw claimable funds to another address', async () => {
      const feeEarned = parse6decimal('0.4')
      const marketSigner = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).updateClaimable(user.address, feeEarned)).to.not.be.reverted
      expect(await margin.claimables(user.address)).to.equal(feeEarned)

      dsu.transfer.whenCalledWith(userB.address, feeEarned.mul(1e12)).returns(true)
      const feeReturned = await margin.connect(user).callStatic.claim(user.address, userB.address)
      expect(feeReturned).to.equal(feeEarned)
      await expect(margin.connect(user).claim(user.address, userB.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, userB.address, feeEarned)
      expect(dsu.transfer).to.have.been.calledWith(userB.address, feeEarned.mul(1e12))
    })

    it('stores and reads checkpoints', async () => {
      const balanceBefore = await margin.crossMarginBalances(user.address)

      const version = BigNumber.from(await currentBlockTimestamp())
      const latestCheckpoint: CheckpointStruct = {
        tradeFee: parse6decimal('0.13'),
        settlementFee: parse6decimal('0.44'),
        transfer: parse6decimal('-2'),
        collateral: parse6decimal('6.6'),
      }
      const pnl = parse6decimal('0.39')

      // can store
      const marketSigner = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).updateCheckpoint(user.address, version, latestCheckpoint, pnl)).to.not
        .be.reverted

      // can read
      const checkpoint: CheckpointStruct = await margin.isolatedCheckpoints(user.address, marketA.address, version)
      expect(checkpoint.tradeFee).to.equal(latestCheckpoint.tradeFee)
      expect(checkpoint.settlementFee).to.equal(latestCheckpoint.settlementFee)
      expect(checkpoint.transfer).to.equal(latestCheckpoint.transfer)
      expect(checkpoint.collateral).to.equal(latestCheckpoint.collateral)

      // confirm PnL has been added to collateral balance
      expect(await margin.crossMarginBalances(user.address)).to.equal(balanceBefore.add(pnl))
    })

    it('deposited collateral updates cross margin balance', async () => {
      await deposit(user, parse6decimal('333'))
      await deposit(user, parse6decimal('667'))

      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('1000'))
    })

    it('markets implicitly crossed after market update', async () => {
      await deposit(user, parse6decimal('500'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('500'))

      // simulate market update
      marketA.hasPosition.whenCalledWith(user.address).returns(true)
      marketA.stale.returns(false)
      await cross(user, marketA)

      expect(await margin.isCrossed(user.address, marketA.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.false

      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('500'))
      expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(0)
    })

    it('prevents unbounded number of markets from being crossed', async () => {
      const maxCrossedMarkets = (await margin.MAX_CROSS_MARGIN_MARKETS()).toNumber()
      await deposit(user, parse6decimal('50'))

      // cross the maximum number of allowed markets
      let market: FakeContract<IMarket>
      for (let i = 0; i < maxCrossedMarkets; i++) {
        market = await smock.fake<IMarket>('IMarket')
        market.factory.whenCalledWith().returns(marketFactory.address)
        await cross(user, market)
      }

      // reverts if attempting to cross another market
      const marketSigner = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).handleMarketUpdate(user.address, 0)).to.be.revertedWithCustomError(
        margin,
        'MarginTooManyCrossedMarkets',
      )

      // isolate the market instead
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('5')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
      // can deisolate the market
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-5')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-5'))
      // but still cannot make it cross-margined
      await expect(margin.connect(marketSigner).handleMarketUpdate(user.address, 0)).to.be.revertedWithCustomError(
        margin,
        'MarginTooManyCrossedMarkets',
      )
    })

    it('uncrosses when isolating', async () => {
      // establish marketA as cross-margin for user
      await deposit(user, parse6decimal('600'))
      marketA.hasPosition.whenCalledWith(user.address).returns(true)
      marketA.stale.returns(false)
      await cross(user, marketA)
      expect(await margin.isCrossed(user.address, marketA.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.false

      // establish marketB as cross-margin for user
      marketB.hasPosition.whenCalledWith(user.address).returns(true)
      marketB.stale.returns(false)
      await cross(user, marketB)
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false

      // change marketA to isolated
      marketA.marginRequired.reset()
      marketB.marginRequired.reset()
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('400')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
      expect(await margin.isCrossed(user.address, marketA.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.true
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false
      // ensure both margin checks were performed:
      // marketA (against newly isolated amount) and marketB (against cross-margin balance)
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
      expect(marketB.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
    })

    it('isolates collateral into two markets', async () => {
      await deposit(user, parse6decimal('1000'))

      // reverts attempting to isolate more than crossed balance
      await expect(
        margin.connect(user).isolate(user.address, marketB.address, parse6decimal('1001')),
      ).to.be.revertedWithCustomError(margin, 'MarginInsufficientCrossedBalance')

      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('600')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('600'))
      expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(parse6decimal('600'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('400'))
      expect(await margin.isCrossed(user.address, marketA.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.true
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, constants.Zero)

      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('400')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketB.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('400'))
      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('400'))
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.true
      expect(marketB.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
    })

    it('can remove isolated funds', async () => {
      await deposit(user, parse6decimal('800'))

      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('600')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('600'))

      // reverts attempting to deisolate more than isolated balance
      await expect(
        margin.connect(user).isolate(user.address, marketB.address, parse6decimal('-601')),
      ).to.be.revertedWithCustomError(margin, 'MarginInsufficientIsolatedBalance')

      // deisolate some funds
      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('-325')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('-325'))

      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('275'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('525')) // 200+325
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.true
    })

    it('checks margin when deisolating funds', async () => {
      // deposit collateral and isolate all of it
      await deposit(user, parse6decimal('500'))
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('500')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('500'))

      // simulate a position which requires more collateral than is isolated
      marketA.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('450'))

      // try to deisolate such that user would be undermargined
      await expect(
        margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-100')),
      ).to.be.revertedWithCustomError(margin, 'MarketInsufficientMarginError')

      // deisolate less such that margin requirements are satisfied
      marketA.marginRequired.reset()
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-10')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-10'))
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
    })

    it('cannot meddle with state by calling isolate with 0 amount', async () => {
      await deposit(user, parse6decimal('500'))

      // cross marketA
      await cross(user, marketA)
      expect(await margin.isCrossed(user.address, marketA.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.false

      // marketB is neither crossed nor isolated, and a 0 isolate call shouldn't change that
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false
      await expect(margin.connect(user).isolate(user.address, marketB.address, constants.Zero)).to.not.be.reverted
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false

      // cross marketB
      await cross(user, marketB)
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false

      // again, a 0 isolate call shouldn't change the state
      await expect(margin.connect(user).isolate(user.address, marketB.address, constants.Zero)).to.not.be.reverted
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false

      // now let's actually isolate marketB
      await margin.isolate(user.address, marketB.address, parse6decimal('300'))
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.true

      // again, a 0 isolate call shouldn't change the state
      await expect(margin.connect(user).isolate(user.address, marketB.address, constants.Zero)).to.not.be.reverted
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.true
    })

    it('handles margin checks from market', async () => {
      const marketC = await fakeMarket()
      await deposit(user, parse6decimal('1000'))

      // user isolates funds for marketA, leaves marketB and marketC cross-margin
      await margin.isolate(user.address, marketA.address, parse6decimal('300'))
      await cross(user, marketB)
      await cross(user, marketC)

      // simulate isolated margin check for marketA
      const marketSignerA = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      // 300 > 200, should return true
      marketA.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('200'))
      expect(await margin.connect(marketSignerA).margined(user.address, constants.Zero, constants.Zero)).to.be.true
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
      // 300 < 400, should return false
      marketA.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('400'))
      expect(await margin.connect(marketSignerA).margined(user.address, constants.Zero, constants.Zero)).to.be.false
      expect(marketB.marginRequired).to.not.have.been.called
      expect(marketC.marginRequired).to.not.have.been.called

      // simulate cross-margin check for marketsB and marketC
      // 750 > 700, should return false
      const marketSignerB = await impersonate.impersonateWithBalance(marketB.address, utils.parseEther('10'))
      const marketSignerC = await impersonate.impersonateWithBalance(marketC.address, utils.parseEther('10'))
      marketB.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('370'))
      marketC.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('380'))
      expect(await margin.connect(marketSignerB).margined(user.address, constants.Zero, constants.Zero)).to.be.false
      expect(marketB.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
      expect(marketC.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
      expect(await margin.connect(marketSignerC).margined(user.address, constants.Zero, constants.Zero)).to.be.false
      // 475 < 700, should return true
      marketB.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('250'))
      marketC.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('225'))
      expect(await margin.connect(marketSignerB).margined(user.address, constants.Zero, constants.Zero)).to.be.true
      expect(await margin.connect(marketSignerC).margined(user.address, constants.Zero, constants.Zero)).to.be.true
    })

    it('honors guaranteePriceAdjustment on isolated margin check', async () => {
      // HACK: recreate marketA as an impersonateWithBalance from a previous test breaks the fake contract
      marketA = await fakeMarket()
      // user isolates all funds to marketA
      await deposit(user, parse6decimal('200'))
      await margin.isolate(user.address, marketA.address, parse6decimal('200'))

      // with 200 isolated, 198 margin required, but priceAdjustment of -3, should not be margined
      const marketSignerA = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      marketA.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('198'))
      expect(await margin.connect(marketSignerA).margined(user.address, constants.Zero, parse6decimal('-3'))).to.be
        .false
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
    })

    it('honors minCollateralization on isolated margin check', async () => {
      // HACK: recreate marketA as an impersonateWithBalance from a previous test breaks the fake contract
      marketA = await fakeMarket()
      // user isolates all funds to marketA
      await deposit(user, parse6decimal('200'))
      await margin.isolate(user.address, marketA.address, parse6decimal('200'))

      // with 200 isolated, 190 margin required, but minCollateralization of 1.1, should not be margined
      const minCollateralization = parse6decimal('1.1')
      const marketSignerA = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      marketA.marginRequired
        .whenCalledWith(user.address, minCollateralization)
        .returns(parse6decimal('190').mul(11).div(10))
      expect(await margin.connect(marketSignerA).margined(user.address, minCollateralization, constants.Zero)).to.be
        .false
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, minCollateralization)
    })

    it('honors guaranteePriceAdjustment on cross-margined markets', async () => {
      // user crosses funds across two markets
      await deposit(user, parse6decimal('200'))
      await cross(user, marketA)
      await cross(user, marketB)

      // assume each market requires 100 margin
      const marketSignerA = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      marketA.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('100'))
      marketB.marginRequired.whenCalledWith(user.address, constants.Zero).returns(parse6decimal('100'))
      // but marketA has a 5 price adjustments of -1, and marketB has 3 price adjustments of 1
      fakeOraclePrice(parse6decimal('100'))
      fakeGuarantees(user, marketA, 5, parse6decimal('101')) //  5 adjustments of (1*100-101) = -5
      fakeGuarantees(user, marketB, 3, parse6decimal('99')) // 3 adjustments of (1*100-99) = 3
      // so collateral is adjusted to 200-5+3=198, and margined should return false
      expect(await margin.connect(marketSignerA).margined(user.address, constants.Zero, parse6decimal('1'))).to.be.false

      // but if we bump up the oracle price to 105, adjustments would be 5*(1*105-101) = 20, and 3*(1*105-99) = 18
      fakeOraclePrice(parse6decimal('105'))
      const marketSignerB = await impersonate.impersonateWithBalance(marketB.address, utils.parseEther('10'))
      // so collateral is adjusted to 200+20+18=238, and margined should return true
      expect(await margin.connect(marketSignerB).margined(user.address, constants.Zero, parse6decimal('1'))).to.be.true
    })

    it('handles maintenance checks from market', async () => {
      // HACK: recreate marketA as an impersonateWithBalance from a previous test breaks the fake contract
      marketA = await fakeMarket()
      const marketC = await fakeMarket()
      await deposit(user, parse6decimal('1000'))

      // again, user isolates funds for marketA, leaves marketB and marketC cross-margin
      await margin.isolate(user.address, marketA.address, parse6decimal('400'))
      await cross(user, marketB)
      await cross(user, marketC)

      // simulate maintenance check for cross-margin marketsB and marketC
      // 650 > 600, should return false
      const marketSignerB = await impersonate.impersonateWithBalance(marketB.address, utils.parseEther('10'))
      const marketSignerC = await impersonate.impersonateWithBalance(marketC.address, utils.parseEther('10'))
      marketB.maintenanceRequired.whenCalledWith(user.address).returns(parse6decimal('320'))
      marketC.maintenanceRequired.whenCalledWith(user.address).returns(parse6decimal('330'))
      expect(await margin.connect(marketSignerB).maintained(user.address)).to.be.false
      expect(marketB.maintenanceRequired).to.have.been.calledWith(user.address)
      expect(marketC.maintenanceRequired).to.have.been.calledWith(user.address)
      expect(await margin.connect(marketSignerC).maintained(user.address)).to.be.false
      // 575 < 600, should return true
      marketB.maintenanceRequired.whenCalledWith(user.address).returns(parse6decimal('250'))
      marketC.maintenanceRequired.whenCalledWith(user.address).returns(parse6decimal('325'))
      expect(await margin.connect(marketSignerB).maintained(user.address)).to.be.true
      expect(await margin.connect(marketSignerC).maintained(user.address)).to.be.true
      expect(marketA.maintenanceRequired).to.not.have.been.called

      // simulate isolated maintenance check for marketA
      marketB.maintenanceRequired.reset()
      marketC.maintenanceRequired.reset()
      const marketSignerA = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      // 300 < 400, should return true
      marketA.maintenanceRequired.whenCalledWith(user.address).returns(parse6decimal('300'))
      expect(await margin.connect(marketSignerA).maintained(user.address)).to.be.true
      expect(marketA.maintenanceRequired).to.have.been.calledWith(user.address)
      // 500 > 400, should return false
      marketA.maintenanceRequired.whenCalledWith(user.address).returns(parse6decimal('500'))
      expect(await margin.connect(marketSignerA).maintained(user.address)).to.be.false
      expect(marketA.maintenanceRequired).to.have.been.calledWith(user.address)
      expect(marketB.maintenanceRequired).to.not.have.been.called
      expect(marketC.maintenanceRequired).to.not.have.been.called
    })

    it('reverts if price stale when deisolating funds', async () => {
      // HACK: recreate marketA as an impersonateWithBalance from a previous test breaks the fake contract
      marketA = await fakeMarket()
      await deposit(user, parse6decimal('500'))

      // isolate some funds
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('500')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('500'))

      // simulate stale price
      marketA.hasPosition.whenCalledWith(user.address).returns(true)
      marketA.stale.returns(true)

      // reverts if price is stale
      await expect(
        margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-100')),
      ).to.be.revertedWithCustomError(margin, 'MarketStalePriceError')

      // should not revert if user has no position in market
      marketA.hasPosition.whenCalledWith(user.address).returns(false)
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-200')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-200'))
    })

    it('can withdraw crossed funds with some isolated', async () => {
      // deposit
      const depositAmount = parse6decimal('500')
      await deposit(user, depositAmount)

      // isolate some funds
      const isolated = parse6decimal('300')
      await expect(margin.connect(user).isolate(user.address, marketA.address, isolated))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, isolated)
      expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(parse6decimal('300'))

      // should revert if attempting to withdraw more than crossed balance
      await expect(margin.connect(user).withdraw(user.address, parse6decimal('301'))).to.be.revertedWithCustomError(
        margin,
        'MarginInsufficientCrossedBalance',
      )

      // should allow withdrawing up to the crossed balance
      dsu.transfer.whenCalledWith(user.address, utils.parseEther('200')).returns(true)
      await expect(margin.connect(user).withdraw(user.address, parse6decimal('200')))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, parse6decimal('200'))
    })

    it('deisolates collateral from two markets', async () => {
      // isolate collateral into two markets
      await deposit(user, parse6decimal('1000'))
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('700')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('700'))
      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('90')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketB.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('90'))
      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('90')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('90'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('120')) // 1000-700-90-90

      // deisolate from marketA
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-700')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-700'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('820')) // 120+700
      expect(await margin.isCrossed(user.address, marketA.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.false

      // deisolate from marketB
      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('-180')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('-180'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('1000')) // all of it
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false

      // perform an update to make marketB crossed
      await cross(user, marketB)
      expect(await margin.isCrossed(user.address, marketA.address)).to.be.false
      expect(await margin.isIsolated(user.address, marketA.address)).to.be.false
      expect(await margin.isCrossed(user.address, marketB.address)).to.be.true
      expect(await margin.isIsolated(user.address, marketB.address)).to.be.false
    })

    it('reverts attempting to cross with position', async () => {
      // deposit and isolate some funds
      await deposit(user, parse6decimal('600'))
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('500')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('500'))

      // simulate a position
      const position: PositionStruct = {
        timestamp: BigNumber.from(1400534400),
        maker: parse6decimal('0.5'),
        long: constants.Zero,
        short: constants.Zero,
      }
      marketA.positions.whenCalledWith(user.address).returns(position)

      // ensure cannot cross market
      await expect(
        margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-500')),
      ).to.be.revertedWithCustomError(margin, 'MarginHasPosition')
    })

    it('operator may cross and isolate a market', async () => {
      await deposit(user, parse6decimal('777'))

      // non-operator may not isolate
      fakeAuthorization(user, userB, false)
      await expect(
        margin.connect(userB).isolate(user.address, marketA.address, parse6decimal('17')),
      ).to.be.revertedWithCustomError(margin, 'MarginOperatorNotAllowedError')

      // operator can isolate
      fakeAuthorization(user, userB, true)
      await expect(margin.connect(userB).isolate(user.address, marketB.address, parse6decimal('333')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketB.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('333'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('444'))
      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('333'))

      // non-operator may not cross
      fakeAuthorization(user, userB, false)
      await expect(
        margin.connect(userB).isolate(user.address, marketB.address, parse6decimal('-333')),
      ).to.be.revertedWithCustomError(margin, 'MarginOperatorNotAllowedError')

      // operator can cross
      fakeAuthorization(user, userB, true)
      await expect(margin.connect(userB).isolate(user.address, marketB.address, parse6decimal('-333')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('-333'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('777'))
      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(constants.Zero)
    })

    it('operator may adjust isolated balance', async () => {
      await deposit(user, parse6decimal('1000'))
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('500')))
        .to.emit(margin, 'MarketIsolated')
        .withArgs(user.address, marketA.address)
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('500'))

      // non-operator may not adjust isolated balance
      fakeAuthorization(user, userB, false)
      await expect(
        margin.connect(userB).isolate(user.address, marketA.address, parse6decimal('100')),
      ).to.be.revertedWithCustomError(margin, 'MarginOperatorNotAllowedError')

      // operator can adjust isolated balance
      fakeAuthorization(user, userB, true)
      await expect(margin.connect(userB).isolate(user.address, marketA.address, parse6decimal('100')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('100'))
      expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(parse6decimal('600'))
    })
  })

  describe('onlyMarket', async () => {
    let margin: Margin
    // another IMarket from a different factory should not be able to meddle with this Margin contract
    let badMarketFactory: FakeContract<IMarketFactory>
    let badMarket: FakeContract<IMarket>
    let badMarketSigner: SignerWithAddress

    beforeEach(async () => {
      badMarketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
      badMarket = await smock.fake<IMarket>('IMarket')
      badMarket.factory.whenCalledWith().returns(badMarketFactory.address)
      badMarketSigner = await impersonate.impersonateWithBalance(badMarket.address, utils.parseEther('10'))

      // deploy Margin contract using the real marketFactory
      margin = await new Margin__factory(
        {
          'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy(dsu.address)
      await margin.initialize(marketFactory.address)
    })

    it('only market can call handleMarketUpdate', async () => {
      await expect(
        margin.connect(badMarketSigner).handleMarketUpdate(user.address, parse6decimal('5')),
      ).to.be.revertedWithCustomError(margin, 'MarginInvalidMarket')
    })

    it('only market can call updateClaimable', async () => {
      await expect(
        margin.connect(badMarketSigner).updateClaimable(user.address, parse6decimal('0.2')),
      ).to.be.revertedWithCustomError(margin, 'MarginInvalidMarket')
    })

    it('only market can call updateCheckpoint', async () => {
      const checkpoint: CheckpointStruct = {
        tradeFee: parse6decimal('0.07'),
        settlementFee: parse6decimal('0.06'),
        transfer: parse6decimal('3'),
        collateral: parse6decimal('5.51'),
      }
      const pnl = parse6decimal('888')
      await expect(
        margin
          .connect(badMarketSigner)
          .updateCheckpoint(user.address, BigNumber.from(await currentBlockTimestamp()), checkpoint, pnl),
      ).to.be.revertedWithCustomError(margin, 'MarginInvalidMarket')
    })
  })

  describe('reentrancy', async () => {
    let mockToken: MockToken
    let margin: Margin

    async function deposit(sender: SignerWithAddress, amount: BigNumber) {
      const balanceBefore = await margin.crossMarginBalances(sender.address)

      await mockToken.connect(owner).transfer(sender.address, amount.mul(1e12))
      await expect(margin.connect(sender).deposit(sender.address, amount))
        .to.emit(margin, 'FundsDeposited')
        .withArgs(sender.address, amount)

      expect(await margin.crossMarginBalances(sender.address)).to.equal(balanceBefore.add(amount))
    }

    beforeEach(async () => {
      mockToken = await new MockToken__factory(owner).deploy()
      margin = await new Margin__factory(
        {
          'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy(mockToken.address)
      await margin.initialize(marketFactory.address)
    })

    it('during deposit', async () => {
      const amount = parse6decimal('3.50')
      // dsu.transferFrom.whenCalledWith(user.address, margin.address, amount.mul(1e12)).returns(true)

      // have malicious token attempt a double deposit
      await mockToken.setFunctionToCall(1)
      await expect(margin.connect(user).deposit(user.address, amount)).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )

      // have malicious token attempt to withdraw during deposit
      await mockToken.setFunctionToCall(2)
      await expect(margin.connect(user).deposit(user.address, amount)).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )
    })

    it('with funds deposited', async () => {
      const amount = parse6decimal('112')
      await deposit(user, amount)

      // have malicious token attempt a double withdrawal
      await mockToken.setFunctionToCall(2)
      // dsu.transfer.whenCalledWith(user.address, amount.mul(1e12)).returns(true)
      await expect(margin.connect(user).withdraw(user.address, amount)).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )

      // have malicious token attempt to meddle with accounting by isolating during withdrawal
      await mockToken.setFunctionToCall(3)
      await expect(margin.connect(user).withdraw(user.address, amount)).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )
    })

    it('with funds isolated', async () => {
      const amount = parse6decimal('400')
      await deposit(user, amount)

      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('200'))).to.not.be.reverted

      // have malicious token attempt to adjust the isolated balance during withdrawal
      await mockToken.setFunctionToCall(3)
      await expect(margin.connect(user).withdraw(user.address, parse6decimal('100'))).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )
    })

    // TODO: test coverage for Margin.claim
  })
})
