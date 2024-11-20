import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import { IMarket, IERC20Metadata, Margin__factory, IMargin } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe.only('Margin', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let market: FakeContract<IMarket>
  let dsu: FakeContract<IERC20Metadata>
  let margin: IMargin

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    market = await smock.fake<IMarket>('IMarket')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    margin = await new Margin__factory(owner).deploy(dsu.address)
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
})
