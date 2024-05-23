import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  ArbGasInfo,
  Controller_Arbitrum,
  Controller_Arbitrum__factory,
  IERC20Metadata,
  IVerifier,
  Verifier__factory,
} from '../../types/generated'
import { AccountDeployedEventObject } from '../../types/generated/contracts/Controller'
import { IMarket, IMarketFactory } from '@equilibria/perennial-v2/types/generated'
import { signDeployAccount, signMarketTransfer, signSignerUpdate, signWithdrawal } from '../helpers/erc712'
import { createMarketFactory, createMarketForOracle, deployController, fundWalletDSU } from '../helpers/arbitrumHelpers'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation
const DEFAULT_MAX_FEE = utils.parseEther('0.5')
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

describe('Controller_Arbitrum', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller_Arbitrum
  let verifier: IVerifier
  let marketFactory: IMarketFactory
  let market: IMarket
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(userAddress: Address, feeOverride = DEFAULT_MAX_FEE, expiresInSeconds = 16) {
    return {
      action: {
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

  // deploys and funds a collateral account
  async function createCollateralAccount(user: SignerWithAddress, amount: BigNumber): Promise<Account> {
    const accountAddress = await controller.getAccountAddress(user.address)
    await dsu.connect(userA).transfer(accountAddress, amount, { maxFeePerGas: 100000000 })
    const deployAccountMessage = {
      ...createAction(user.address),
    }
    const signatureCreate = await signDeployAccount(user, verifier, deployAccountMessage)
    const tx = await controller
      .connect(keeper)
      .deployAccountWithSignature(deployAccountMessage, signatureCreate, { maxFeePerGas: 100000000 })
    // verify the address from event arguments
    const creationArgs = (await tx.wait()).events?.find(e => e.event === 'AccountDeployed')
      ?.args as any as AccountDeployedEventObject
    expect(creationArgs.account).to.equal(accountAddress)

    // approve the collateral account as operator
    await marketFactory.connect(user).updateOperator(accountAddress, true)

    return Account__factory.connect(accountAddress, user)
  }

  // funds specified wallet with 50k collateral
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    await fundWalletDSU(wallet, utils.parseEther('50000'))
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    // create a market
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    ;[dsu, usdc] = await deployController()
    marketFactory = await createMarketFactory(owner)
    let oracle: any //IOracleProvider
    let keeperOracle: any
    ;[market, oracle, keeperOracle] = await createMarketForOracle(owner, marketFactory, dsu)
    // const lastPrice = (await oracle.status())[0].price // initial price is 3116.734999
    await dsu.connect(userA).approve(market.address, constants.MaxUint256)

    // set up users and deploy artifacts
    const keepConfig = {
      multiplierBase: 0,
      bufferBase: 1_000_000,
      multiplierCalldata: 0,
      bufferCalldata: 500_000,
    }
    controller = await new Controller_Arbitrum__factory(owner).deploy(keepConfig)
    verifier = await new Verifier__factory(owner).deploy()
    // chainlink feed is used by Kept for keeper compensation
    await controller['initialize(address,address,address,address,address)'](
      verifier.address,
      usdc.address,
      dsu.address,
      DSU_RESERVE,
      CHAINLINK_ETH_USD_FEED,
    )
    // fund userA
    await fundWallet(userA)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())

    await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100']) // 0.1 gwei

    // Hardhat fork does not support Arbitrum built-ins; Kept produces "invalid opcode" error without this
    const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    gasInfo.getL1BaseFeeEstimate.returns(0)
  })

  afterEach(async () => {
    // ensure controller has no funds at rest
    expect(await dsu.balanceOf(controller.address)).to.equal(0)
  })

  after(async () => {
    // reset to avoid impact to other tests
    await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
  })

  describe('#deployment', () => {
    it('can create an account', async () => {
      // pre-fund the collateral account with 15k DSU
      const accountAddressA = await controller.getAccountAddress(userA.address)
      await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'), { maxFeePerGas: 100000000 })

      // sign a message to deploy the account
      const deployAccountMessage = {
        ...createAction(userA.address),
      }
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

      // keeper executes deployment of the account and is compensated
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await controller
        .connect(keeper)
        .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 })

      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    it('keeper fee is limited by maxFee', async () => {
      // pre-fund the collateral account with 15k DSU
      const accountAddressA = await controller.getAccountAddress(userA.address)
      await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'), { maxFeePerGas: 100000000 })

      // sign a message with maxFee smaller than the calculated keeper fee (~0.0033215)
      const maxFee = parse6decimal('0.000789')
      const deployAccountMessage = {
        ...createAction(userA.address, maxFee),
      }
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

      // keeper executes deployment of the account and is compensated
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await controller
        .connect(keeper)
        .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 })

      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.equal(maxFee.mul(1e12)) // convert from 6- to 18- decimal
    })
  })

  describe('#delegation', async () => {
    let accountAddressA: Address

    beforeEach(async () => {
      // keeper starts with no funds
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      expect(keeperBalanceBefore).to.equal(0)

      // fund userA and pre-fund the collateral account with 12k DSU
      await fundWallet(userA)
      accountAddressA = await controller.getAccountAddress(userA.address)
      await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('12000'), { maxFeePerGas: 100000000 })
    })

    it('cannot collect fee for assigning a delegate before account creation', async () => {
      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...createAction(userA.address),
      }

      // assign the delegate
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature)).to.be.reverted
    })

    it('collects fee for assigning a delegate', async () => {
      // create and fund the account
      await createCollateralAccount(userA, utils.parseEther('12000'))

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...createAction(userA.address),
      }

      // assign the delegate
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)
      await expect(
        controller
          .connect(keeper)
          .updateSignerWithSignature(updateSignerMessage, signature, { maxFeePerGas: 100000000 }),
      )
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      const keeperFee = await dsu.balanceOf(keeper.address)
      expect(keeperFee).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })
  })

  describe('#transfer', async () => {
    const INITIAL_DEPOSIT_6 = parse6decimal('13000')
    const INITIAL_DEPOSIT_18 = INITIAL_DEPOSIT_6.mul(1e12)
    let accountA: Account
    let keeperBalanceBefore: BigNumber

    beforeEach(async () => {
      // deploy collateral account for userA
      accountA = await createCollateralAccount(userA, INITIAL_DEPOSIT_18)
      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
    })

    afterEach(async () => {
      // confirm keeper earned their fee
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    async function depositAll() {
      // sign a message to deposit everything from the collateral account to the market
      const marketTransferMessage = {
        market: market.address,
        amount: constants.MaxInt256,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, market.address, anyValue) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      // ensure the transfer worked
      expect((await market.locals(userA.address)).collateral).to.be.within(
        INITIAL_DEPOSIT_6.sub(parse6decimal('1')), // 12999
        INITIAL_DEPOSIT_6, // 13000
      )
      // ensure the collateral account is empty
      expect(await dsu.balanceOf(accountA.address)).to.be.lessThan(1e12) // dust from UFixed6 precision
    }

    it('collects fee for depositing some funds to market', async () => {
      // sign a message to deposit 6k from the collateral account to the market
      const transferAmount = parse6decimal('6000')
      const marketTransferMessage = {
        market: market.address,
        amount: transferAmount,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, market.address, transferAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
    })

    it('collects fee when depositing all funds to market', async () => {
      await depositAll()
    })

    it('collects fee for withdrawing some funds from market', async () => {
      // user directly deposits collateral to the market
      const deposit = parse6decimal('12000')
      await market
        .connect(userA)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          userA.address,
          constants.MaxUint256,
          constants.MaxUint256,
          constants.MaxUint256,
          deposit,
          false,
        )
      expect((await market.locals(userA.address)).collateral).to.equal(deposit)

      // sign a message to make a partial withdrawal
      const withdrawal = parse6decimal('-2000')
      const marketTransferMessage = {
        market: market.address,
        amount: withdrawal,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller
          .connect(keeper)
          .marketTransferWithSignature(marketTransferMessage, signature, { gasLimit: 1_000_000 }),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, withdrawal.mul(-1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(parse6decimal('10000')) // 12k-2k
    })

    it('collects fee for withdrawing native deposit from market', async () => {
      // user directly deposits collateral to the market
      const deposit = parse6decimal('13000')
      await market
        .connect(userA)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          userA.address,
          constants.MaxUint256,
          constants.MaxUint256,
          constants.MaxUint256,
          deposit,
          false,
        )
      expect((await market.locals(userA.address)).collateral).to.equal(deposit)

      // sign a message to withdraw everything from the market back into the collateral account
      const marketTransferMessage = {
        market: market.address,
        amount: constants.MinInt256,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller
          .connect(keeper)
          .marketTransferWithSignature(marketTransferMessage, signature, { gasLimit: 1_000_000 }),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, deposit.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(0)
    })

    it('collects fee for withdrawing funds into empty collateral account', async () => {
      // deposit everything possible
      await depositAll()
      // withdraw dust so it cannot be used to pay the keeper
      await accountA.withdraw(constants.MaxUint256, true)
      expect(await dsu.balanceOf(accountA.address)).to.equal(0)

      // sign a message to withdraw 3k from the market back into the collateral account
      const withdrawal = parse6decimal('-3000')
      const marketTransferMessage = {
        market: market.address,
        amount: withdrawal,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller
          .connect(keeper)
          .marketTransferWithSignature(marketTransferMessage, signature, { gasLimit: 1_000_000 }),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, anyValue)
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.be.within(
        parse6decimal('9999'),
        parse6decimal('10000'),
      ) // 13k-3k
    })
  })

  describe('#withdrawal', async () => {
    let accountA: Account
    let keeperBalanceBefore: BigNumber

    beforeEach(async () => {
      // deploy collateral account for userA
      accountA = await createCollateralAccount(userA, utils.parseEther('17000'))
      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
    })

    afterEach(async () => {
      // confirm keeper earned their fee
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    it('collects fee for partial withdrawal from a delegated signer', async () => {
      const userBalanceBefore = await usdc.balanceOf(userA.address)

      // configure userB as delegated signer
      await controller.connect(userA).updateSigner(userB.address, true, { maxFeePerGas: 100000000 })

      // delegate signs message for partial withdrawal
      const withdrawalAmount = parse6decimal('7000')
      const withdrawalMessage = {
        amount: withdrawalAmount,
        unwrap: true,
        ...createAction(userA.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(
        controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature, { maxFeePerGas: 100000000 }),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(accountA.address, userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)

      // confirm userA withdrew their funds and keeper fee was paid from the collateral account
      const cumulativeKeeperFee = await dsu.balanceOf(keeper.address)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('10000').sub(cumulativeKeeperFee))
      expect(await usdc.balanceOf(userA.address)).to.equal(userBalanceBefore.add(withdrawalAmount))
    })

    it('collects fee for full withdrawal', async () => {
      const accountBalanceBefore = await dsu.balanceOf(accountA.address)
      // sign a message to withdraw all funds from the account
      const withdrawalMessage = {
        amount: constants.MaxUint256,
        unwrap: true,
        ...createAction(userA.address),
      }
      const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

      // perform withdrawal and check balances
      await expect(
        controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature, { maxFeePerGas: 100000000 }),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(accountA.address, userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      // collateral account should be empty
      expect(await dsu.balanceOf(accountA.address)).to.equal(0)
      expect(await usdc.balanceOf(accountA.address)).to.equal(0)
      // user should have their initial balance, plus what was in their collateral account, minus keeper fees
      expect(await usdc.balanceOf(userA.address)).to.be.within(parse6decimal('16999'), parse6decimal('17000'))
    })
  })
})
