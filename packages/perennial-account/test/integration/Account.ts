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

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Perennial Market has 466k at height 208460709

const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' // Wrapped Bitcoin (8 decimals)

describe.skip('Account', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller
  let account: Account
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress

  // funds specified wallet with 50k DSU and 100k USDC
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    const usdcOwner = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
    // if block height was changed, holder or amounts may need adjustment
    expect(await usdc.balanceOf(USDC_HOLDER)).to.be.greaterThan(parse6decimal('100000'))
    await usdc.connect(usdcOwner).transfer(wallet.address, parse6decimal('100000'))
    const dsuOwner = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    expect(await dsu.balanceOf(DSU_HOLDER)).to.be.greaterThan(utils.parseEther('50000'))
    await dsu.connect(dsuOwner).transfer(wallet.address, utils.parseEther('50000'))
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()
    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
    usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
    controller = await new Controller__factory(owner).deploy()

    // fund userA with some DSU and USDC
    await fundWallet(userA)

    // create an empty account
    const accountAddress = await controller.connect(userA).callStatic.deployAccount()
    await controller.connect(userA).deployAccount()
    account = Account__factory.connect(accountAddress, userA)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  describe('#6-decimal token support', () => {
    beforeEach(async () => {
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
  })

  describe('#18-decimal token support', () => {
    const INITIAL_DEPOSIT_6 = parse6decimal('10000')
    const INITIAL_DEPOSIT_18 = INITIAL_DEPOSIT_6.mul(1e12)

    beforeEach(async () => {
      // fund userA's collateral account with 10k DSU
      await dsu.connect(userA).transfer(account.address, INITIAL_DEPOSIT_18)
    })

    it('allows owner to make a partial withdrawal', async () => {
      const partialWithdrawal = utils.parseEther('923')
      expect(await account.owner()).to.equal(userA.address)
      const balanceBefore = await dsu.balanceOf(account.address)
      expect(balanceBefore).to.be.greaterThanOrEqual(partialWithdrawal)

      await expect(account.withdraw(dsu.address, parse6decimal('923')))
        .to.emit(dsu, 'Transfer')
        .withArgs(account.address, userA.address, partialWithdrawal)

      const balanceAfter = await dsu.balanceOf(account.address)
      expect(balanceAfter).to.equal(balanceBefore.sub(partialWithdrawal))
    })

    it('allows owner to make a full withdrawal', async () => {
      const balanceBefore = await dsu.balanceOf(account.address)
      expect(balanceBefore).to.be.greaterThan(constants.Zero)

      await expect(account.withdraw(dsu.address, constants.MaxUint256))
        .to.emit(dsu, 'Transfer')
        .withArgs(account.address, userA.address, balanceBefore)

      expect(await dsu.balanceOf(account.address)).to.equal(constants.Zero)
    })

    it('can fully withdraw dust amounts', async () => {
      // deposit a dust amount into the account
      const dust = utils.parseEther('0.000000555')
      await dsu.connect(userA).transfer(account.address, dust)
      // perform a full withdrawal
      await expect(account.withdraw(dsu.address, constants.MaxUint256))
        .to.emit(dsu, 'Transfer')
        .withArgs(account.address, userA.address, INITIAL_DEPOSIT_18.add(dust))

      expect(await dsu.balanceOf(account.address)).equals(0)
    })
  })

  describe('#negative tests', () => {
    it('rejects withdrawal of token with unsupported decimals', async () => {
      const wbtc = IERC20Metadata__factory.connect(WBTC_ADDRESS, owner)
      await expect(account.withdraw(wbtc.address, BigNumber.from(0.0213 * 1e6))).to.be.revertedWithCustomError(
        account,
        'TokenNotSupportedError',
      )
    })

    it('reverts if someone other than the owner attempts a withdrawal', async () => {
      await expect(account.connect(userB).withdraw(usdc.address, parse6decimal('100'))).to.be.revertedWithCustomError(
        account,
        'NotAuthorizedError',
      )
    })
  })
})
