import HRE from 'hardhat'
import { expect } from 'chai'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  Controller,
  Controller__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  Verifier,
  Verifier__factory,
} from '../../types/generated'
import { IKeeperOracle, IOracleProvider } from '@equilibria/perennial-v2-oracle/types/generated'
import { IMarket, IMarketFactory } from '@equilibria/perennial-v2/types/generated'
import { signDeployAccount, signMarketTransfer, signWithdrawal } from '../helpers/erc712'
import { advanceToPrice } from '../helpers/setupHelpers'
import { createMarketFactory, createMarketForOracle } from '../helpers/arbitrumHelpers'
import { AccountDeployedEventObject } from '../../types/generated/contracts/Controller'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, compatible with Market
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Market has 466k at height 208460709

describe('Controller', () => {
  let dsu: IERC20Metadata
  let controller: Controller
  let verifier: Verifier
  let marketFactory: IMarketFactory
  let market: IMarket
  let keeperOracle: IKeeperOracle
  let accountA: Account
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let lastPrice: BigNumber
  let currentTime: BigNumber

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(
    accountAddress: Address,
    userAddress: Address,
    feeOverride = utils.parseEther('14'),
    expiresInSeconds = 60,
  ) {
    return {
      action: {
        account: accountAddress,
        maxFee: feeOverride,
        common: {
          account: userAddress,
          domain: controller.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(expiresInSeconds),
        },
      },
    }
  }

  // updates the oracle (optionally changing price) and settles the market
  async function advanceAndSettle(user: SignerWithAddress, timestamp = currentTime, price = lastPrice) {
    await advanceToPrice(keeperOracle, timestamp, price)
    await market.settle(user.address)
  }

  // ensures user has expected amount of collateral in a market
  async function expectMarketCollateralBalance(user: SignerWithAddress, amount: BigNumber) {
    const local = await market.locals(user.address)
    expect(local.collateral).to.equal(amount)
  }

  // funds specified wallet with 50k collateral
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    const dsuOwner = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    expect(await dsu.balanceOf(DSU_HOLDER)).to.be.greaterThan(utils.parseEther('50000'))
    await dsu.connect(dsuOwner).transfer(wallet.address, utils.parseEther('50000'))
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  // updates the market and returns the version timestamp
  async function changePosition(
    user: SignerWithAddress,
    newMaker = constants.MaxUint256,
    newLong = constants.MaxUint256,
    newShort = constants.MaxUint256,
  ): Promise<BigNumber> {
    const tx = await market
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, newMaker, newLong, newShort, 0, false)
    const created = (await tx.wait()).events?.find(e => e.event === 'Updated')!.args!.version
    return created
  }

  const fixture = async () => {
    // set up users and deploy artifacts
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
    controller = await new Controller__factory(owner).deploy()
    verifier = await new Verifier__factory(owner).deploy()
    // verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    await controller.initialize(verifier.address)

    // create a collateral account for userA with 15k collateral in it
    await fundWallet(userA)
    const accountAddressA = await controller.getAccountAddress(userA.address)
    await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'))
    const deployAccountMessage = {
      ...createAction(accountAddressA, userA.address),
    }
    const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
    await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature)
    accountA = Account__factory.connect(accountAddressA, userA)

    // create a market
    marketFactory = await createMarketFactory(owner)
    let oracle: IOracleProvider
    ;[market, oracle, keeperOracle] = await createMarketForOracle(owner, marketFactory, dsu)
    lastPrice = (await oracle.status())[0].price // initial price is 3116.734999

    // approve the collateral account as operator
    await marketFactory.connect(userA).updateOperator(accountA.address, true)
  }

  beforeEach(async () => {
    currentTime = BigNumber.from(await currentBlockTimestamp())
    await loadFixture(fixture)
  })

  describe('#transfer', () => {
    it('can deposit funds to a market', async () => {
      // sign a message to deposit 6k from the collateral account to the market
      const transferAmount = parse6decimal('6000')
      const marketTransferMessage = {
        market: market.address,
        amount: transferAmount,
        ...createAction(accountA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, market.address, transferAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)

      // verify balances
      await expectMarketCollateralBalance(userA, transferAmount)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('9000')) // 15k-6k
    })

    it('can withdraw funds from a market', async () => {
      // deposit 10k
      let marketTransferMessage = {
        market: market.address,
        amount: parse6decimal('10000'),
        ...createAction(accountA.address, userA.address),
      }
      let signature = await signMarketTransfer(userA, verifier, marketTransferMessage)
      await controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature)

      // sign a message to withdraw 3k from the the market
      const transferAmount = parse6decimal('-3000')
      marketTransferMessage = {
        market: market.address,
        amount: transferAmount,
        ...createAction(accountA.address, userA.address),
      }
      signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, transferAmount.mul(-1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)

      // verify balances
      await expectMarketCollateralBalance(userA, parse6decimal('7000')) // 10k-3k
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('8000')) // 15k-10k+3k
    })

    it('can fully withdraw from a market', async () => {
      // deposit 8k
      const depositAmount = parse6decimal('8000')
      let marketTransferMessage = {
        market: market.address,
        amount: depositAmount,
        ...createAction(accountA.address, userA.address),
      }
      let signature = await signMarketTransfer(userA, verifier, marketTransferMessage)
      await controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature)

      // sign a message to fully withdraw from the market
      marketTransferMessage = {
        market: market.address,
        amount: constants.MinInt256,
        ...createAction(accountA.address, userA.address),
      }
      signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, depositAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)

      // verify balances
      await expectMarketCollateralBalance(userA, constants.Zero)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('15000'))
    })

    it('cannot fully withdraw with position', async () => {
      // deposit 7k
      const depositAmount = parse6decimal('7000')
      let marketTransferMessage = {
        market: market.address,
        amount: depositAmount,
        ...createAction(accountA.address, userA.address),
      }
      let signature = await signMarketTransfer(userA, verifier, marketTransferMessage)
      await controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature)

      // create a maker position
      currentTime = await changePosition(userA, parse6decimal('1.5'))
      await advanceAndSettle(userA)
      expect((await market.positions(userA.address)).maker).to.equal(parse6decimal('1.5'))

      // sign a message to fully withdraw from the market
      marketTransferMessage = {
        market: market.address,
        amount: constants.MinInt256,
        ...createAction(accountA.address, userA.address),
      }
      signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // ensure transfer reverts
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature),
      ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')

      await expectMarketCollateralBalance(userA, parse6decimal('7000'))
    })
  })

  describe('#withdrawal', () => {
    it('can withdraw funds from a signed message', async () => {
      const balanceBefore = await dsu.balanceOf(accountA.address)

      // sign message to perform a partial withdrawal
      const withdrawalAmount = parse6decimal('6000')
      const withdrawalMessage = {
        token: dsu.address,
        amount: withdrawalAmount,
        ...createAction(accountA.address, userA.address),
      }
      const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, userA.address, withdrawalAmount.mul(1e12)) // scale to token precision
      const balanceAfter = await dsu.balanceOf(accountA.address)
      expect(balanceAfter).to.equal(balanceBefore.sub(withdrawalAmount.mul(1e12)))
    })

    it('can withdraw from a delegated signer', async () => {
      const balanceBefore = await dsu.balanceOf(accountA.address)

      // configure userB as delegated signer
      await controller.connect(userA).updateSigner(userB.address, true)

      // delegate signs message for full withdrawal
      const withdrawalMessage = {
        token: dsu.address,
        amount: constants.MaxUint256,
        ...createAction(accountA.address, userA.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, userA.address, balanceBefore)
      expect(await dsu.balanceOf(accountA.address)).to.equal(constants.Zero)
    })

    it('rejects withdrawals from unauthorized signer', async () => {
      expect(await controller.signers(accountA.address, userB.address)).to.be.false

      // unauthorized user signs message for withdrawal
      const withdrawalMessage = {
        token: dsu.address,
        amount: parse6decimal('2000'),
        ...createAction(accountA.address, userA.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // ensure withdrawal fails
      await expect(
        controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'InvalidSignerError')
    })

    it('rejects withdrawals for the wrong account', async () => {
      // create an account for userB
      const tx = await controller.connect(userB).deployAccount()
      const creationArgs = (await tx.wait()).events?.find(e => e.event === 'AccountDeployed')
        ?.args as any as AccountDeployedEventObject
      const accountB = Account__factory.connect(creationArgs.account, userB)

      // fund the account
      await fundWallet(userB)
      await dsu.connect(userB).transfer(accountB.address, utils.parseEther('30000'))

      // sign message requesting userA withdraw from accountB
      const withdrawalMessage = {
        token: dsu.address,
        amount: parse6decimal('2000'),
        ...createAction(accountB.address, userA.address),
      }
      const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

      // ensure withdrawal fails
      await expect(
        controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'WrongAccountError')
    })
  })
})
