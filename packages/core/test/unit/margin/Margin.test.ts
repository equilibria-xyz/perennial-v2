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
  let market: FakeContract<IMarket>
  let dsu: FakeContract<IERC20Metadata>
  let margin: IMargin

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    market = await smock.fake<IMarket>('IMarket')
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

  it('deposits funds to margin contract', async () => {
    expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)

    const deposit = parse6decimal('3500.153')
    dsu.transferFrom.whenCalledWith(user.address, margin.address, deposit.mul(1e12)).returns(true)

    await expect(margin.connect(user).deposit(deposit)).to.not.be.reverted

    expect(await margin.crossMarginBalances(user.address)).to.equal(deposit)
  })

  it('withdraws funds from margin contract', async () => {
    // deposit
    const deposit = parse6decimal('600')
    dsu.transferFrom.whenCalledWith(user.address, margin.address, deposit.mul(1e12)).returns(true)
    await expect(margin.connect(user).deposit(deposit)).to.not.be.reverted

    // reverts when attempting to withdraw too much
    let withdrawal = parse6decimal('609')
    dsu.transfer.whenCalledWith(user.address, withdrawal.mul(1e12)).returns(true)
    await expect(margin.connect(user).withdraw(withdrawal)).to.be.revertedWithCustomError(
      margin,
      'InsufficientCrossMarginBalance',
    )

    // performs partial withdrawal
    withdrawal = parse6decimal('303')
    dsu.transfer.whenCalledWith(user.address, withdrawal.mul(1e12)).returns(true)
    await expect(margin.connect(user).withdraw(withdrawal)).to.not.be.reverted
    expect(await margin.crossMarginBalances(user.address)).to.equal(deposit.sub(withdrawal))

    // performs complete withdrawal
    withdrawal = parse6decimal('297')
    dsu.transfer.whenCalledWith(user.address, withdrawal.mul(1e12)).returns(true)
    await expect(margin.connect(user).withdraw(withdrawal)).to.not.be.reverted
    expect(await margin.crossMarginBalances(user.address)).to.equal(constants.Zero)
  })

  it('stores and reads checkpoints', async () => {
    const latestCheckpoint: CheckpointStruct = {
      tradeFee: parse6decimal('0.33'),
      settlementFee: parse6decimal('0.44'),
      transfer: parse6decimal('-2'),
      collateral: parse6decimal('6.6'),
    }
    const version = BigNumber.from(await currentBlockTimestamp())

    // can store
    const marketSigner = await impersonate.impersonateWithBalance(market.address, utils.parseEther('10'))
    await expect(margin.connect(marketSigner).update(user.address, version, latestCheckpoint)).to.not.be.reverted

    // can read
    const checkpoint: CheckpointStruct = await margin.isolatedCheckpoints(user.address, market.address, version)
    expect(checkpoint.tradeFee).to.equal(latestCheckpoint.tradeFee)
    expect(checkpoint.settlementFee).to.equal(latestCheckpoint.settlementFee)
    expect(checkpoint.transfer).to.equal(latestCheckpoint.transfer)
    expect(checkpoint.collateral).to.equal(latestCheckpoint.collateral)
  })
})
