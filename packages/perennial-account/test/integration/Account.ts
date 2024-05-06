import { expect } from 'chai'
import HRE from 'hardhat'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { impersonate } from '../../../common/testutil'
import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  Controller,
  Controller__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
} from '../../types/generated'

const { ethers } = HRE

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // Arbitrum native USDC (not USDC.e), a 6-decimal token
const USDC_HOLDER = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7' // Hyperliquid deposit bridge has 340mm USDC at height 208460709

const DSU = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 466k at height 208460709

describe('Account', () => {
  let usdc: IERC20Metadata
  let controller: Controller
  let account: Account
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress

  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    const usdcOwner = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
    // if block height was changed, holder or amounts may need adjustment
    expect(await usdc.balanceOf(USDC_HOLDER)).to.be.greaterThan(parse6decimal('100000'))
    await usdc.connect(usdcOwner).transfer(wallet.address, parse6decimal('100000'))

    // TODO: fund with DSU
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()
    usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
    controller = await new Controller__factory(owner).deploy()

    // fund userA with some USDC
    await fundWallet(userA)

    const accountAddress = await controller.connect(userA).callStatic.deployAccount()
    await controller.connect(userA).deployAccount()
    account = Account__factory.connect(accountAddress, userA)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    // fund userA's collateral account with 20k USDC
    await usdc.connect(userA).transfer(account.address, parse6decimal('20000'))
  })

  it('allows owner to make a partial withdrawal', async () => {
    const partialWithdrawal = parse6decimal('5020')
    expect(await account.owner()).to.equal(userA.address)
    const balanceBefore = await usdc.balanceOf(account.address)
    expect(balanceBefore).to.be.greaterThanOrEqual(partialWithdrawal)

    await expect(account.withdraw(usdc.address, partialWithdrawal))
      .to.emit(usdc, 'Transfer')
      .withArgs(account.address, userA.address, partialWithdrawal)

    const balanceAfter = await usdc.balanceOf(account.address)
    expect(balanceAfter).to.equal(balanceBefore.sub(partialWithdrawal))
  })

  it('allows owner to make a full withdrawal', async () => {
    const balanceBefore = await usdc.balanceOf(account.address)
    expect(balanceBefore).to.be.greaterThan(constants.Zero)

    await expect(account.withdraw(usdc.address, constants.MaxUint256))
      .to.emit(usdc, 'Transfer')
      .withArgs(account.address, userA.address, balanceBefore)

    expect(await usdc.balanceOf(account.address)).to.equal(constants.Zero)
  })

  // TODO: test with DSU

  // TODO: test unsupported token
})
