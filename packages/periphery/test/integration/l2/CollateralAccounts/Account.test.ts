import { expect } from 'chai'
import HRE from 'hardhat'
import { CallOverrides, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { parse6decimal } from '../../../../../common/testutil/types'
import {
  Account,
  Account__factory,
  AggregatorV3Interface,
  Controller_Incentivized,
  IAccountVerifier,
  IController,
  IERC20Metadata,
  IMarketFactory,
} from '../../../../types/generated'
import { DeploymentVars } from './setupTypes'

const { ethers } = HRE

export function RunAccountTests(
  deployProtocol: (
    owner: SignerWithAddress,
    createMarketETH: boolean,
    createMarketBTC: boolean,
    overrides?: CallOverrides,
  ) => Promise<DeploymentVars>,
  deployController: (
    owner: SignerWithAddress,
    marketFactory: IMarketFactory,
    chainlinkKeptFeed: AggregatorV3Interface,
    overrides?: CallOverrides,
  ) => Promise<[Controller_Incentivized, IAccountVerifier]>,
): void {
  describe('Account', () => {
    let deployment: DeploymentVars
    let dsu: IERC20Metadata
    let usdc: IERC20Metadata
    let controller: IController
    let account: Account
    let owner: SignerWithAddress
    let userA: SignerWithAddress
    let userB: SignerWithAddress

    // funds specified wallet with 50k DSU and 100k USDC
    async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
      await deployment.fundWalletDSU(wallet, utils.parseEther('50000'))
      await deployment.fundWalletUSDC(wallet, parse6decimal('100000'))
    }

    const fixture = async () => {
      ;[owner, userA, userB] = await ethers.getSigners()
      deployment = await deployProtocol(owner, false, false)
      dsu = deployment.dsu
      usdc = deployment.usdc
      ;[controller] = await deployController(owner, deployment.marketFactory, deployment.chainlinkKeptFeed)

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

    describe('#deposit and withdrawal', () => {
      it('can use deposit function to pull USDC into account', async () => {
        // run token approval
        const depositAmount = parse6decimal('6000')
        await usdc.connect(userA).approve(account.address, depositAmount)

        // call the deposit function to transferFrom userA
        await expect(account.deposit(depositAmount))
          .to.emit(usdc, 'Transfer')
          .withArgs(userA.address, account.address, depositAmount)
        expect(await usdc.balanceOf(account.address)).to.equal(depositAmount)
      })

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

      it('burns dust amounts upon withdrawal', async () => {
        // deposit a dust amount into the account
        const dust = utils.parseEther('0.000000555')
        await dsu.connect(userA).transfer(account.address, dust)
        expect(await usdc.balanceOf(account.address)).equals(constants.Zero)
        expect(await dsu.balanceOf(account.address)).equals(dust)

        // amount is below the smallest transferrable amount of USDC, so nothing is transferred
        await expect(account.withdraw(constants.MaxUint256, true))
          .to.emit(usdc, 'Transfer')
          .withArgs(account.address, userA.address, 0)

        // ensure the withdrawal burned the DSU dust
        expect(await usdc.balanceOf(account.address)).equals(constants.Zero)
        expect(await dsu.balanceOf(account.address)).equals(constants.Zero)
      })

      it('handles balance under withdrawal amount without unwrapping', async () => {
        await dsu.connect(userA).transfer(account.address, utils.parseEther('100'))
        expect(await usdc.balanceOf(account.address)).to.equal(0)

        // ensure withdrawal fails when there is no unwrapped USDC
        await expect(account.withdraw(parse6decimal('100'), false))
          .to.emit(usdc, 'Transfer')
          .withArgs(account.address, userA.address, 0)

        // and when there is some, but not enough to facilitate the withdrawal
        await usdc.connect(userA).transfer(account.address, parse6decimal('50'))
        await expect(account.withdraw(parse6decimal('100'), false))
          .to.emit(usdc, 'Transfer')
          .withArgs(account.address, userA.address, parse6decimal('50'))
      })

      it('handles balance under withdrawal amount when unwrapping', async () => {
        await dsu.connect(userA).transfer(account.address, utils.parseEther('100'))
        expect(await usdc.balanceOf(account.address)).to.equal(0)

        // ensure withdrawal fails when there is unsufficient DSU to unwrap
        await expect(account.withdraw(parse6decimal('150'), true))
          .to.emit(usdc, 'Transfer')
          .withArgs(account.address, userA.address, parse6decimal('100'))
      })

      it('reverts if someone other than the owner attempts a withdrawal', async () => {
        await expect(account.connect(userB).withdraw(parse6decimal('400'), false)).to.be.revertedWithCustomError(
          account,
          'AccountNotAuthorizedError',
        )
      })
    })
  })
}
