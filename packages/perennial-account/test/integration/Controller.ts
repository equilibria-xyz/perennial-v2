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
  IMarket,
  IOracleProvider__factory,
  Verifier,
  Verifier__factory,
} from '../../types/generated'
import {
  IKeeperOracle,
  KeeperOracle__factory,
  OracleFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { IMarketFactory } from '@equilibria/perennial-v2/types/generated'
import { signDeployAccount, signMarketTransfer, signWithdrawal } from '../helpers/erc712'
import { advanceToPrice, createMarket, deployProtocolForOracle } from '../helpers/setupHelpers'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, compatible with Market
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Market has 466k at height 208460709

const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413' // OracleFactory used by MarketFactory
const ORACLE_FACTORY_OWNER = '0xdA381aeD086f544BaC66e73C071E158374cc105B' // TimelockController
const ETH_USD_KEEPER_ORACLE = '0xf9249EC6785221226Cb3f66fa049aA1E5B6a4A57' // KeeperOracle
const ETH_USD_ORACLE = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A' // Oracle with id 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

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

    // create the market factory
    const oracleFactory = OracleFactory__factory.connect(ORACLE_FACTORY, owner)
    marketFactory = await deployProtocolForOracle(owner, oracleFactory, ORACLE_FACTORY_OWNER)

    // create a market
    const oracle = IOracleProvider__factory.connect(ETH_USD_ORACLE, owner)
    market = await createMarket(owner, marketFactory, dsu, oracle)
    // need this to commit prices
    keeperOracle = await new KeeperOracle__factory(owner).attach(ETH_USD_KEEPER_ORACLE)
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
      ).to.be.revertedWithCustomError(accountA, 'PositionNotZero')
      // .to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
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
  })
})
