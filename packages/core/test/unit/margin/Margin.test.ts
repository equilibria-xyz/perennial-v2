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

  beforeEach(async () => {
    ;[owner, user, userB] = await ethers.getSigners()

    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    const oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    oracle.latest.whenCalledWith().returns({
      timestamp: BigNumber.from(1567310400),
      price: constants.Zero,
      valid: true,
    })
    marketA = await smock.fake<IMarket>('IMarket')
    marketA.factory.whenCalledWith().returns(marketFactory.address)
    marketA.oracle.whenCalledWith().returns(oracle.address)
    marketB = await smock.fake<IMarket>('IMarket')
    marketB.factory.whenCalledWith().returns(marketFactory.address)
    marketB.oracle.whenCalledWith().returns(oracle.address)
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
      await expect(margin.connect(user).withdraw(withdrawalAmount)).to.be.revertedWithCustomError(
        margin,
        'MarginInsufficientCrossedBalance',
      )

      // performs partial withdrawal
      withdrawalAmount = parse6decimal('303')
      dsu.transfer.whenCalledWith(user.address, withdrawalAmount.mul(1e12)).returns(true)
      await expect(margin.connect(user).withdraw(withdrawalAmount))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, withdrawalAmount)
      expect(await margin.crossMarginBalances(user.address)).to.equal(depositAmount.sub(withdrawalAmount))

      // performs complete withdrawal
      withdrawalAmount = parse6decimal('297')
      dsu.transfer.whenCalledWith(user.address, withdrawalAmount.mul(1e12)).returns(true)
      await expect(margin.connect(user).withdraw(withdrawalAmount))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, withdrawalAmount)
      expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)
    })

    it('market can adjust balances for fees and exposure', async () => {
      const balanceBefore = await margin.crossMarginBalances(user.address)

      const feeEarned = parse6decimal('0.2')
      const marketSigner = await impersonate.impersonateWithBalance(marketA.address, utils.parseEther('10'))
      await expect(margin.connect(marketSigner).updateBalance(user.address, feeEarned)).to.not.be.reverted

      expect(await margin.crossMarginBalances(user.address)).to.equal(balanceBefore.add(feeEarned))
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
      await expect(margin.connect(user).isolate(marketB.address)).to.not.be.reverted
      await expect(
        margin.connect(user).adjustIsolatedBalance(marketA.address, parse6decimal('1001')),
      ).to.be.revertedWithCustomError(margin, 'MarginInsufficientCrossedBalance')

      await expect(margin.connect(user).isolate(marketA.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketA.address, parse6decimal('600')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('600'))
      expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(parse6decimal('600'))

      await expect(margin.connect(user).isolate(marketB.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('400')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('400'))

      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('400'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)
    })

    it('can remove isolated funds', async () => {
      await deposit(user, parse6decimal('800'))

      await expect(margin.connect(user).isolate(marketB.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('600')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('600'))

      // reverts attempting to deisolate more than isolated balance
      await expect(
        margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('-601')),
      ).to.be.revertedWithCustomError(margin, 'MarginInsufficientIsolatedBalance')

      // deisolate some funds
      await expect(margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('-325')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('-325'))

      expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('275'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('525')) // 200+325
    })

    it('can withdraw crossed funds with some isolated', async () => {
      // deposit
      const depositAmount = parse6decimal('500')
      await deposit(user, depositAmount)

      // isolate some funds
      const isolated = parse6decimal('300')
      await expect(margin.connect(user).isolate(marketA.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketA.address, isolated))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, isolated)
      expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(parse6decimal('300'))

      // should revert if attempting to withdraw more than crossed balance
      await expect(margin.connect(user).withdraw(parse6decimal('301'))).to.be.revertedWithCustomError(
        margin,
        'MarginInsufficientCrossedBalance',
      )

      // should allow withdrawing up to the crossed balance
      dsu.transfer.whenCalledWith(user.address, utils.parseEther('200')).returns(true)
      await expect(margin.connect(user).withdraw(parse6decimal('200')))
        .to.emit(margin, 'FundsWithdrawn')
        .withArgs(user.address, parse6decimal('200'))
    })

    it('crosses collateral into two markets', async () => {
      await deposit(user, parse6decimal('1000'))

      // since collateral is crossed by default, need to isolate some first
      await expect(margin.connect(user).isolate(marketA.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketA.address, parse6decimal('700')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('700'))
      await expect(margin.connect(user).isolate(marketB.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('90')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('90'))
      await expect(margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('90')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('90'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('120')) // 1000-700-90-90

      await expect(margin.connect(user).cross(marketA.address))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketA.address, parse6decimal('-700'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('820')) // 120+700
      await expect(margin.connect(user).cross(marketB.address))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('-180'))
      expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('1000')) // all of it
    })

    // TODO: can't test this until Margin._isIsolated can return false
    it.skip('reverts attempting to cross when not isolated', async () => {
      await deposit(user, parse6decimal('400'))

      // nothing isolated; cannot cross
      await expect(margin.connect(user).cross(marketA.address)).to.be.revertedWithCustomError(
        margin,
        'MarginMarketNotIsolated',
      )

      // isolate market B
      await expect(margin.connect(user).isolate(marketB.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketB.address, parse6decimal('150')))
        .to.emit(margin, 'IsolatedFundsChanged')
        .withArgs(user.address, marketB.address, parse6decimal('150'))

      // ensure still cannot cross market A
      await expect(margin.connect(user).cross(marketA.address)).to.be.revertedWithCustomError(
        margin,
        'MarginMarketNotIsolated',
      )
    })

    it('reverts attempting to cross with position', async () => {
      // deposit and isolate some funds
      await deposit(user, parse6decimal('600'))
      await expect(margin.connect(user).isolate(marketA.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketA.address, parse6decimal('500')))
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
      await expect(margin.connect(user).cross(marketA.address)).to.be.revertedWithCustomError(
        margin,
        'MarginHasPosition',
      )
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

    it('only market can call updateBalance', async () => {
      await expect(
        margin.connect(badMarketSigner).updateBalance(user.address, parse6decimal('0.2')),
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
      await expect(margin.connect(user).withdraw(amount)).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )

      // have malicious token attempt to meddle with accounting by isolating during withdrawal
      await mockToken.setFunctionToCall(3)
      await expect(margin.connect(user).withdraw(amount)).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )
    })

    it('with funds isolated', async () => {
      const amount = parse6decimal('400')
      await deposit(user, amount)

      await expect(margin.connect(user).isolate(marketA.address)).to.not.be.reverted
      await expect(margin.connect(user).adjustIsolatedBalance(marketA.address, parse6decimal('200'))).to.not.be.reverted

      // have malicious token attempt to adjust the isolated balance during withdrawal
      await mockToken.setFunctionToCall(4)
      await expect(margin.connect(user).withdraw(parse6decimal('100'))).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )

      // for completeness, have malicious token cross when withdrawing
      // (would otherwise fail because withdraw pushes after updating crossMarginBalances)
      await mockToken.setFunctionToCall(5)
      await expect(margin.connect(user).withdraw(parse6decimal('100'))).to.be.revertedWithCustomError(
        margin,
        'ReentrancyGuardReentrantCallError',
      )
    })
  })
})
