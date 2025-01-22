import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

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
import { parse6decimal } from '../../../../common/testutil/types'
import { CheckpointStruct } from '../../../types/generated/contracts/Margin'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { impersonate } from '../../../../common/testutil'
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

  function fakeAuthorization(account: SignerWithAddress, sender: SignerWithAddress, isOperator = true) {
    marketFactory.authorization
      .whenCalledWith(account.address, sender.address, constants.AddressZero, constants.AddressZero)
      .returns([isOperator, false, constants.Zero])
  }

  beforeEach(async () => {
    ;[owner, user, userB] = await ethers.getSigners()

    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    marketFactory.authorization.returns([true, false, constants.Zero])

    const oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    oracle.latest.whenCalledWith().returns({
      timestamp: BigNumber.from(1567310400),
      price: constants.Zero,
      valid: true,
    })

    marketA = await smock.fake<IMarket>('IMarket')
    marketA.factory.whenCalledWith().returns(marketFactory.address)
    marketA.oracle.whenCalledWith().returns(oracle.address)
    marketA.stale.returns(false)
    marketB = await smock.fake<IMarket>('IMarket')
    marketB.factory.whenCalledWith().returns(marketFactory.address)
    marketB.oracle.whenCalledWith().returns(oracle.address)
    marketB.stale.returns(false)
  })

  describe('normal operation', async () => {
    let margin: IMargin

    async function deposit(sender: SignerWithAddress, amount: BigNumber, target?: SignerWithAddress) {
      if (!target) target = sender
      const balanceBefore = await margin.crossMarginBalances(target.address)

      dsu.transferFrom.whenCalledWith(sender.address, margin.address, amount.mul(1e12)).returns(true)
      await expect(margin.connect(sender).deposit(target.address, amount))
        .to.emit(margin, 'FundsDeposited')
        .withArgs(target.address, amount)

      expect(await margin.crossMarginBalances(target.address)).to.equal(balanceBefore.add(amount))
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
      await expect(margin.connect(user).claim(user.address, user.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, feeEarned)
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
      await expect(margin.connect(user).claim(user.address, userB.address))
        .to.emit(margin, 'ClaimableWithdrawn')
        .withArgs(user.address, feeEarned)
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

    it('deposited collateral is crossed by default', async () => {
      await deposit(user, parse6decimal('333'))
      await deposit(user, parse6decimal('667'))

      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('1000'))
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

      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('400')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('400'))

      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('400'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)
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

      // try to deisolate less such that margin requirements are satisfied
      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-10')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-10'))
      expect(marketA.marginRequired).to.have.been.calledWith(user.address, constants.Zero)
    })

    it('reverts if price stale when deisolating funds', async () => {
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

    it('crosses collateral into two markets', async () => {
      await deposit(user, parse6decimal('1000'))

      // since collateral is crossed by default, need to isolate some first
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

      await expect(margin.connect(user).isolate(user.address, marketA.address, parse6decimal('-700')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-700'))
        .to.emit(margin, 'MarketCrossed')
        .withArgs(user.address, marketA.address)
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('820')) // 120+700
      await expect(margin.connect(user).isolate(user.address, marketB.address, parse6decimal('-180')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('-180'))
        .to.emit(margin, 'MarketCrossed')
        .withArgs(user.address, marketB.address)
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('1000')) // all of it
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
        .to.emit(margin, 'MarketCrossed')
        .withArgs(user.address, marketB.address)
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
