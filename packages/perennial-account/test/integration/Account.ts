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
  Verifier__factory,
} from '../../types/generated'
import { fundWalletDSU, fundWalletUSDC } from '../helpers/arbitrumHelpers'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, an 18-decimal token
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'
const USDCe_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
const USDCe_HOLDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d'

describe('Account', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller
  let account: Account
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress

  // funds specified wallet with 50k DSU and 100k USDC
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    await fundWalletDSU(wallet, utils.parseEther('50000'))
    await fundWalletUSDC(wallet, parse6decimal('100000'))
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()
    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
    usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, owner)
    controller = await new Controller__factory(owner).deploy()

    // TODO: move to arbitrumHelpers module, which doesn't exist in this branch
    const verifier = await new Verifier__factory(owner).deploy()
    await controller.initialize(verifier.address, usdc.address, dsu.address, DSU_RESERVE)

    // fund users with some DSU and USDC
    await fundWallet(userA)
    await fundWallet(userB)

    // create an empty account
    const accountAddress = await controller.connect(userA).callStatic.deployAccount()
    await controller.connect(userA).deployAccount()
    account = Account__factory.connect(accountAddress, userA)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  after(async () => {
    // return user funds to avoid impacting other tests
    await usdc.connect(userA).transfer(USDCe_HOLDER, await usdc.balanceOf(userA.address))
    // TODO: centralize this logic in helpers, perform for both tokens and both users
  })

  describe('#DSU support', () => {
    it('owner can deposit DSU', async () => {
      const depositAmount = parse6decimal('500')
      await dsu.connect(userA).approve(account.address, depositAmount.mul(1e12))

      await expect(account.deposit(depositAmount, false))
        .to.emit(dsu, 'Transfer')
        .withArgs(userA.address, account.address, depositAmount.mul(1e12))

      expect(await dsu.balanceOf(account.address)).to.equal(depositAmount.mul(1e12))
    })

    it('anyone can deposit DSU', async () => {
      const depositAmount = parse6decimal('6')
      await dsu.connect(userB).approve(account.address, depositAmount.mul(1e12))

      await expect(account.connect(userB).deposit(depositAmount, false))
        .to.emit(dsu, 'Transfer')
        .withArgs(userB.address, account.address, depositAmount.mul(1e12))

      expect(await dsu.balanceOf(account.address)).to.equal(depositAmount.mul(1e12))
    })
  })

  describe('#USDC support', () => {
    it('can natively deposit USDC and withdraw USDC', async () => {
      const depositAmount = parse6decimal('7000')
      await usdc.connect(userA).transfer(account.address, depositAmount)
      expect(await usdc.balanceOf(account.address)).to.equal(depositAmount)

      await expect(account.withdraw(depositAmount, false))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, depositAmount)
      expect(await usdc.balanceOf(account.address)).to.equal(0)
    })

    it('can natively deposit DSU and withdraw as USDC', async () => {
      const depositAmount = utils.parseEther('8000')
      await dsu.connect(userA).transfer(account.address, depositAmount)
      expect(await dsu.balanceOf(account.address)).to.equal(depositAmount)

      expect(depositAmount.div(1e12)).to.equal(parse6decimal('8000'))
      await expect(account.withdraw(depositAmount.div(1e12), true))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, parse6decimal('8000'))
      expect(await dsu.balanceOf(account.address)).to.equal(0)
    })

    it('can withdraw all USDC without unwrapping DSU', async () => {
      await dsu.connect(userA).transfer(account.address, utils.parseEther('300'))
      await usdc.connect(userA).transfer(account.address, parse6decimal('400'))

      await expect(account.withdraw(parse6decimal('400'), false))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, parse6decimal('400'))
      expect(await dsu.balanceOf(account.address)).to.equal(utils.parseEther('300'))
      expect(await usdc.balanceOf(account.address)).to.equal(0)
    })

    it('can unwrap and withdraw everything', async () => {
      await dsu.connect(userA).transfer(account.address, utils.parseEther('100'))
      await usdc.connect(userA).transfer(account.address, parse6decimal('200'))

      await expect(account.withdraw(parse6decimal('300'), true))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, parse6decimal('300'))
      expect(await dsu.balanceOf(account.address)).to.equal(0)
      expect(await usdc.balanceOf(account.address)).to.equal(0)
    })

    it('unwraps only when necessary', async () => {
      await dsu.connect(userA).transfer(account.address, utils.parseEther('600'))
      await usdc.connect(userA).transfer(account.address, parse6decimal('700'))

      // should not unwrap when withdrawing less USDC than the account's balance
      await expect(account.withdraw(parse6decimal('500'), true))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, parse6decimal('500'))
      expect(await dsu.balanceOf(account.address)).to.equal(utils.parseEther('600'))
      expect(await usdc.balanceOf(account.address)).to.equal(parse6decimal('200'))

      // should unwrap when withdrawing more than the account's balance (now 200 USDC)
      await expect(account.withdraw(parse6decimal('300'), true))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, parse6decimal('300'))
      expect(await dsu.balanceOf(account.address)).to.equal(utils.parseEther('500'))
      expect(await usdc.balanceOf(account.address)).to.equal(0)
    })

    // TODO: decide expected behavior, since we cannot withdraw DSU
    it.skip('can fully withdraw dust amounts', async () => {
      // deposit a dust amount into the account
      const dust = utils.parseEther('0.000000555')
      await dsu.connect(userA).transfer(account.address, dust)
      // perform a full withdrawal
      await expect(account.withdraw(dsu.address, constants.MaxUint256))
        .to.emit(usdc, 'Transfer')
        .withArgs(account.address, userA.address, 0)

      expect(await dsu.balanceOf(account.address)).equals(0)
    })

    it('transfer fails if insufficient balance when not unwrapping', async () => {
      await dsu.connect(userA).transfer(account.address, utils.parseEther('100'))
      expect(await usdc.balanceOf(account.address)).to.equal(0)

      // ensure withdrawal fails when there is no unwrapped USDC
      await expect(account.withdraw(parse6decimal('100'), false)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      )

      // and when there is some, but not enough to facilitate the withdrawal
      await usdc.connect(userA).transfer(account.address, parse6decimal('50'))
      await expect(account.withdraw(parse6decimal('100'), false)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      )
    })

    it('transfer fails if insufficient balance when unwrapping', async () => {
      await dsu.connect(userA).transfer(account.address, utils.parseEther('100'))
      expect(await usdc.balanceOf(account.address)).to.equal(0)

      // ensure withdrawal fails when there is unsufficient DSU to unwrap
      await expect(account.withdraw(parse6decimal('150'), true)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      )
    })

    it('reverts if someone other than the owner attempts a withdrawal', async () => {
      await expect(account.connect(userB).withdraw(parse6decimal('400'), false)).to.be.revertedWithCustomError(
        account,
        'NotAuthorizedError',
      )
    })
  })
})
