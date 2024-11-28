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
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { CheckpointStruct } from '../../../types/generated/contracts/Margin'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { impersonate } from '../../../../common/testutil'

const { ethers } = HRE
use(smock.matchers)

describe('Margin', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let marketA: FakeContract<IMarket>
  let marketB: FakeContract<IMarket>
  let dsu: FakeContract<IERC20Metadata>
  let margin: IMargin

  beforeEach(async () => {
    ;[owner, user, userB] = await ethers.getSigners()

    marketA = await smock.fake<IMarket>('IMarket')
    marketB = await smock.fake<IMarket>('IMarket')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    margin = await new Margin__factory(
      {
        'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
          await new CheckpointStorageLib__factory(owner).deploy()
        ).address,
      },
      owner,
    ).deploy(dsu.address)
  })

  async function deposit(sender: SignerWithAddress, amount: BigNumber, target?: SignerWithAddress) {
    if (!target) target = sender
    const balanceBefore = await margin.crossMarginBalances(target.address)

    dsu.transferFrom.whenCalledWith(sender.address, margin.address, amount.mul(1e12)).returns(true)
    await expect(margin.connect(sender).deposit(target.address, amount)).to.not.be.reverted

    expect(await margin.crossMarginBalances(target.address)).to.equal(balanceBefore.add(amount))
  }

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
    await expect(margin.connect(user).withdraw(withdrawalAmount)).to.not.be.reverted
    expect(await margin.crossMarginBalances(user.address)).to.equal(depositAmount.sub(withdrawalAmount))

    // performs complete withdrawal
    withdrawalAmount = parse6decimal('297')
    dsu.transfer.whenCalledWith(user.address, withdrawalAmount.mul(1e12)).returns(true)
    await expect(margin.connect(user).withdraw(withdrawalAmount)).to.not.be.reverted
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
    await expect(margin.connect(marketSigner).updateCheckpoint(user.address, version, latestCheckpoint, pnl)).to.not.be
      .reverted

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

    await expect(margin.connect(user).isolate(parse6decimal('600'), marketA.address)).to.not.be.reverted
    expect(await margin.isolatedBalances(user.address, marketA.address)).to.equal(parse6decimal('600'))
    await expect(margin.connect(user).isolate(parse6decimal('400'), marketB.address)).to.not.be.reverted
    expect(await margin.isolatedBalances(user.address, marketB.address)).to.equal(parse6decimal('400'))

    expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)
  })

  it('reverts attempting to isolate more than balance', async () => {
    await deposit(user, parse6decimal('400'))
    await expect(margin.connect(user).isolate(parse6decimal('401'), marketA.address)).to.be.revertedWithCustomError(
      margin,
      'MarginInsufficientCrossedBalance',
    )
  })

  it('crosses collateral into two markets', async () => {
    await deposit(user, parse6decimal('1000'))

    // since collateral is crossed by default, need to isolate some first
    await expect(margin.connect(user).isolate(parse6decimal('700'), marketA.address)).to.not.be.reverted
    await expect(margin.connect(user).isolate(parse6decimal('90'), marketB.address)).to.not.be.reverted
    await expect(margin.connect(user).isolate(parse6decimal('90'), marketB.address)).to.not.be.reverted
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('120')) // 1000-700-90-90

    await expect(margin.connect(user).cross(marketA.address)).to.not.be.reverted
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('820')) // 120+700
    await expect(margin.connect(user).cross(marketB.address)).to.not.be.reverted
    expect(await margin.crossMarginBalances(user.address)).to.equal(parse6decimal('1000')) // all of it
  })

  it('reverts attempting to cross when not isolated', async () => {
    await deposit(user, parse6decimal('400'))

    // nothing isolated; cannot cross
    await expect(margin.connect(user).cross(marketA.address)).to.be.revertedWithCustomError(
      margin,
      'MarginInsufficientIsolatedBalance',
    )

    // isolate market B
    await expect(margin.connect(user).isolate(parse6decimal('150'), marketB.address)).to.not.be.reverted

    // ensure still cannot cross market A
    await expect(margin.connect(user).cross(marketA.address)).to.be.revertedWithCustomError(
      margin,
      'MarginInsufficientIsolatedBalance',
    )
  })
})
