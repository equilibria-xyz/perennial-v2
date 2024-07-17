import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { advanceBlock, currentBlockTimestamp } from '../../../common/testutil/time'
import { getEventArguments } from '../helpers/setupHelpers'

import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  AccountVerifier__factory,
  ArbGasInfo,
  Controller_Arbitrum,
  IAccount,
  IAccountVerifier,
  IERC20Metadata,
  IMarket,
  IMarketFactory,
} from '../../types/generated'
import { IOracleFactory, PythFactory } from '@equilibria/perennial-v2-oracle/types/generated'

import {
  createMarketBTC,
  createMarketETH,
  createFactories,
  deployControllerArbitrum,
  fundWalletDSU,
  fundWalletUSDC,
  getStablecoins,
} from '../helpers/arbitrumHelpers'
import {
  signDeployAccount,
  signMarketTransfer,
  signRebalanceConfigChange,
  signRelayedGroupCancellation,
  signRelayedNonceCancellation,
  signRelayedOperatorUpdate,
  signRelayedSignerUpdate,
  signWithdrawal,
} from '../helpers/erc712'
import {
  signGroupCancellation,
  signCommon as signNonceCancellation,
  signOperatorUpdate,
  signSignerUpdate,
} from '@equilibria/perennial-v2-verifier/test/helpers/erc712'
import { Verifier } from '../../types/generated/contracts/Verifier'
import { Verifier__factory } from '@equilibria/perennial-v2-verifier/types/generated'
import { IVerifier__factory } from '@equilibria/perennial-v2/types/generated'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation
const DEFAULT_MAX_FEE = utils.parseEther('0.5')

// hack around issues estimating gas for instrumented contracts when running tests under coverage
const TX_OVERRIDES = { gasLimit: 3_000_000, maxFeePerGas: 200_000_000 }

describe('Controller_Arbitrum', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller_Arbitrum
  let accountVerifier: IAccountVerifier
  let oracleFactory: IOracleFactory
  let pythOracleFactory: PythFactory
  let marketFactory: IMarketFactory
  let market: IMarket
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(
    userAddress: Address,
    signerAddress = userAddress,
    maxFee = DEFAULT_MAX_FEE,
    expiresInSeconds = 45,
  ) {
    return {
      action: {
        maxFee: maxFee,
        common: {
          account: userAddress,
          signer: signerAddress,
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
    await usdc.connect(userA).transfer(accountAddress, amount, TX_OVERRIDES)
    const deployAccountMessage = {
      ...createAction(user.address, user.address),
    }
    const signatureCreate = await signDeployAccount(user, accountVerifier, deployAccountMessage)
    const tx = await controller
      .connect(keeper)
      .deployAccountWithSignature(deployAccountMessage, signatureCreate, TX_OVERRIDES)
    // verify the address from event arguments
    const creationArgs = await getEventArguments(tx, 'AccountDeployed')
    expect(creationArgs.account).to.equal(accountAddress)

    // approve the collateral account as operator
    await marketFactory.connect(user).updateOperator(accountAddress, true, TX_OVERRIDES)

    return Account__factory.connect(accountAddress, user)
  }

  // funds specified wallet with 50k USDC
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    await fundWalletUSDC(wallet, parse6decimal('50000'), { maxFeePerGas: 100000000 })
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  // deposit from the collateral account to the ETH market
  async function deposit(amount: BigNumber, account: IAccount) {
    // sign the message
    const marketTransferMessage = {
      market: market.address,
      amount: amount,
      ...createAction(userA.address, userA.address),
    }
    const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

    // perform transfer
    await expect(controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES))
      .to.emit(dsu, 'Transfer')
      .withArgs(account.address, market.address, anyValue) // scale to token precision
      .to.emit(market, 'OrderCreated')
      .withArgs(userA.address, anyValue, anyValue, constants.AddressZero, constants.AddressZero, constants.AddressZero)
      .to.emit(controller, 'KeeperCall')
      .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
  }

  const fixture = async () => {
    // deploy the protocol
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    ;[oracleFactory, marketFactory, pythOracleFactory] = await createFactories(owner)
    ;[dsu, usdc] = await getStablecoins(owner)
    ;[market, ,] = await createMarketETH(owner, oracleFactory, pythOracleFactory, marketFactory, dsu)
    await dsu.connect(userA).approve(market.address, constants.MaxUint256, { maxFeePerGas: 100000000 })

    // set up users and deploy artifacts
    const keepConfig = {
      multiplierBase: 0,
      bufferBase: 1_000_000,
      multiplierCalldata: 0,
      bufferCalldata: 500_000,
    }
    const marketVerifier = IVerifier__factory.connect(await marketFactory.verifier(), owner)
    controller = await deployControllerArbitrum(owner, keepConfig, marketVerifier, { maxFeePerGas: 100000000 })
    accountVerifier = await new AccountVerifier__factory(owner).deploy({ maxFeePerGas: 100000000 })
    // chainlink feed is used by Kept for keeper compensation
    await controller['initialize(address,address,address)'](
      marketFactory.address,
      accountVerifier.address,
      CHAINLINK_ETH_USD_FEED,
    )
    // fund userA
    await fundWallet(userA)
  }

  before(async () => {
    // touch the provider, such that smock doesn't error out running a single test
    await advanceBlock()
    // Hardhat fork does not support Arbitrum built-ins; Kept produces "invalid opcode" error without this
    await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
  })

  beforeEach(async () => {
    await loadFixture(fixture)

    // update the timestamp used for calculating expiry
    currentTime = BigNumber.from(await currentBlockTimestamp())

    // set a realistic base gas fee
    await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100']) // 0.1 gwei
  })

  afterEach(async () => {
    // ensure controller has no funds at rest
    expect(await dsu.balanceOf(controller.address)).to.equal(0)

    // reset to avoid impact to setup and other tests
    await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
  })

  describe('#deployment', () => {
    let accountAddressA: Address

    // fund the account with 15k USDC
    beforeEach(async () => {
      accountAddressA = await controller.getAccountAddress(userA.address)
    })

    it('can create an account', async () => {
      // pre-fund the address where the account will be deployed
      await usdc.connect(userA).transfer(accountAddressA, parse6decimal('15000'), { maxFeePerGas: 100000000 })

      // sign a message to deploy the account
      const deployAccountMessage = {
        ...createAction(userA.address, userA.address),
      }
      const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)

      // keeper executes deployment of the account and is compensated
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await expect(
        controller
          .connect(keeper)
          .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 }),
      )
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressA)

      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    it('keeper fee is limited by maxFee', async () => {
      // pre-fund the address where the account will be deployed
      await usdc.connect(userA).transfer(accountAddressA, parse6decimal('15000'), { maxFeePerGas: 100000000 })

      // sign a message with maxFee smaller than the calculated keeper fee (~0.0033215)
      const maxFee = parse6decimal('0.000789')
      const deployAccountMessage = {
        ...createAction(userA.address, userA.address, maxFee),
      }
      const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)

      // keeper executes deployment of the account and is compensated
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await expect(
        controller
          .connect(keeper)
          .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 }),
      )
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressA)

      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.equal(maxFee.mul(1e12)) // convert from 6- to 18- decimal
    })

    it('reverts with custom error if keeper cannot be compensated', async () => {
      // ensure the account is empty
      expect(await dsu.balanceOf(keeper.address)).to.equal(0)
      expect(await usdc.balanceOf(keeper.address)).to.equal(0)

      // sign a message to deploy the account
      const deployAccountMessage = {
        ...createAction(userA.address, userA.address),
      }

      // ensure the request fails with a meaningful revert reason
      const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)
      await expect(
        controller
          .connect(keeper)
          .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 }),
      ).to.be.revertedWithCustomError(controller, 'ControllerCannotPayKeeperError')
    })
  })

  describe('#transfer', async () => {
    const INITIAL_DEPOSIT_6 = parse6decimal('13000')
    let accountA: Account
    let keeperBalanceBefore: BigNumber

    beforeEach(async () => {
      // deploy collateral account for userA
      accountA = await createCollateralAccount(userA, INITIAL_DEPOSIT_6)
      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
    })

    afterEach(async () => {
      // confirm keeper earned their fee
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    it('collects fee for depositing some funds to market', async () => {
      // sign a message to deposit 6k from the collateral account to the market
      const transferAmount = parse6decimal('6000')
      const marketTransferMessage = {
        market: market.address,
        amount: transferAmount,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, market.address, transferAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userA.address,
          anyValue,
          anyValue,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(transferAmount)
    })

    it('collects fee for withdrawing some funds from market', async () => {
      // user deposits collateral to the market
      await deposit(parse6decimal('12000'), accountA)
      expect((await market.locals(userA.address)).collateral).to.equal(parse6decimal('12000'))

      // sign a message to make a partial withdrawal
      const withdrawal = parse6decimal('-2000')
      const marketTransferMessage = {
        market: market.address,
        amount: withdrawal,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, withdrawal.mul(-1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userA.address,
          anyValue,
          anyValue,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(parse6decimal('10000')) // 12k-2k
    })

    it('collects fee for withdrawing native deposit from market', async () => {
      // user directly deposits collateral to the market
      const depositAmount = parse6decimal('13000')
      await fundWalletDSU(userA, depositAmount.mul(1e12), TX_OVERRIDES)
      await market
        .connect(userA)
        ['update(address,uint256,uint256,uint256,int256,bool)'](
          userA.address,
          constants.MaxUint256,
          constants.MaxUint256,
          constants.MaxUint256,
          depositAmount,
          false,
          { maxFeePerGas: 150000000 },
        )
      expect((await market.locals(userA.address)).collateral).to.equal(depositAmount)

      // sign a message to withdraw everything from the market back into the collateral account
      const marketTransferMessage = {
        market: market.address,
        amount: constants.MinInt256,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, depositAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userA.address,
          anyValue,
          anyValue,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(0)
    })

    it('collects fee for withdrawing funds into empty collateral account', async () => {
      // deposit 12k
      await deposit(parse6decimal('12000'), accountA)
      // withdraw dust so it cannot be used to pay the keeper
      await accountA.withdraw(constants.MaxUint256, true, TX_OVERRIDES)
      expect(await dsu.balanceOf(accountA.address)).to.equal(0)

      // sign a message to withdraw 2k from the market back into the collateral account
      const withdrawal = parse6decimal('-2000')
      const marketTransferMessage = {
        market: market.address,
        amount: withdrawal,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, anyValue)
        .to.emit(market, 'OrderCreated')
        .withArgs(
          userA.address,
          anyValue,
          anyValue,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
        )
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.be.within(
        parse6decimal('9999'),
        parse6decimal('10000'),
      ) // 12k-2k
    })
  })

  describe('#rebalance', async () => {
    let accountA: Account

    beforeEach(async () => {
      accountA = await createCollateralAccount(userA, parse6decimal('10005'))
    })

    it('collects fee for changing rebalance configuration', async () => {
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)

      // sign message to create a new group
      const message = {
        group: 5,
        markets: [market.address],
        configs: [{ target: parse6decimal('1'), threshold: parse6decimal('0.0901') }],
        maxFee: DEFAULT_MAX_FEE,
        ...(await createAction(userA.address)),
      }
      const signature = await signRebalanceConfigChange(userA, accountVerifier, message)

      // create the group
      await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature, TX_OVERRIDES))
        .to.emit(controller, 'RebalanceMarketConfigured')
        .withArgs(userA.address, message.group, market.address, message.configs[0])
        .to.emit(controller, 'RebalanceGroupConfigured')
        .withArgs(userA.address, message.group, 1)

      // ensure keeper was compensated
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.01'), DEFAULT_MAX_FEE)
    })

    it('collects fee for rebalancing a group', async () => {
      const ethMarket = market
      const [btcMarket, ,] = await createMarketBTC(
        owner,
        oracleFactory,
        pythOracleFactory,
        marketFactory,
        dsu,
        TX_OVERRIDES,
      )

      // create a new group with two markets
      const message = {
        group: 4,
        markets: [ethMarket.address, btcMarket.address],
        configs: [
          { target: parse6decimal('0.5'), threshold: parse6decimal('0.05') },
          { target: parse6decimal('0.5'), threshold: parse6decimal('0.05') },
        ],
        maxFee: DEFAULT_MAX_FEE,
        ...(await createAction(userA.address)),
      }
      const signature = await signRebalanceConfigChange(userA, accountVerifier, message)
      await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature, TX_OVERRIDES)).to
        .not.be.reverted

      // transfer all collateral to ethMarket
      await deposit(parse6decimal('10000'), accountA)
      expect((await ethMarket.locals(userA.address)).collateral).to.equal(parse6decimal('10000'))
      expect((await btcMarket.locals(userA.address)).collateral).to.equal(0)

      // now that test setup is complete, record keeper balance
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)

      // rebalance the group
      await expect(controller.connect(keeper).rebalanceGroup(userA.address, 4, TX_OVERRIDES))
        .to.emit(dsu, 'Transfer')
        .withArgs(ethMarket.address, accountA.address, utils.parseEther('5000'))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, btcMarket.address, utils.parseEther('5000'))
        .to.emit(controller, 'GroupRebalanced')
        .withArgs(userA.address, 4)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)

      // confirm keeper earned their fee
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.01'), DEFAULT_MAX_FEE)
    })

    it('honors max rebalance fee when rebalancing a group', async () => {
      const ethMarket = market
      const [btcMarket, ,] = await createMarketBTC(
        owner,
        oracleFactory,
        pythOracleFactory,
        marketFactory,
        dsu,
        TX_OVERRIDES,
      )

      // create a new group with two markets and a maxFee smaller than the actual fee
      const message = {
        group: 4,
        markets: [ethMarket.address, btcMarket.address],
        configs: [
          { target: parse6decimal('0.75'), threshold: parse6decimal('0.06') },
          { target: parse6decimal('0.25'), threshold: parse6decimal('0.06') },
        ],
        maxFee: parse6decimal('0.00923'),
        ...(await createAction(userA.address)),
      }
      const signature = await signRebalanceConfigChange(userA, accountVerifier, message)
      await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature, TX_OVERRIDES)).to
        .not.be.reverted

      // transfer some collateral to ethMarket and record keeper balance
      await deposit(parse6decimal('5000'), accountA)
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)

      // rebalance the group
      await expect(controller.connect(keeper).rebalanceGroup(userA.address, 4, TX_OVERRIDES))
        .to.emit(dsu, 'Transfer')
        .withArgs(ethMarket.address, accountA.address, utils.parseEther('1250'))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, btcMarket.address, utils.parseEther('1250'))
        .to.emit(controller, 'GroupRebalanced')
        .withArgs(userA.address, 4)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)

      // confirm keeper fee was limited as configured
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.equal(utils.parseEther('0.00923'))
    })
  })

  describe('#withdrawal', async () => {
    let accountA: Account
    let userBalanceBefore: BigNumber
    let keeperBalanceBefore: BigNumber

    beforeEach(async () => {
      // deploy collateral account for userA
      accountA = await createCollateralAccount(userA, parse6decimal('17000'))
      userBalanceBefore = await usdc.balanceOf(userA.address)
      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
    })

    afterEach(async () => {
      // confirm keeper earned their fee
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    it('collects fee for partial withdrawal from a delegated signer', async () => {
      // configure userB as delegated signer
      await marketFactory.connect(userA).updateSigner(userB.address, true, TX_OVERRIDES)

      // delegate signs message for partial withdrawal
      const withdrawalAmount = parse6decimal('7000')
      const withdrawalMessage = {
        amount: withdrawalAmount,
        unwrap: true,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signWithdrawal(userB, accountVerifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature, TX_OVERRIDES))
        .to.emit(usdc, 'Transfer')
        .withArgs(accountA.address, userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)

      // confirm userA withdrew their funds and keeper fee was paid from the collateral account
      expect(await usdc.balanceOf(accountA.address)).to.be.within(parse6decimal('9999'), parse6decimal('10000'))
      expect(await usdc.balanceOf(userA.address)).to.equal(userBalanceBefore.add(withdrawalAmount))
    })

    it('collects fee for full withdrawal', async () => {
      // sign a message to withdraw all funds from the account
      const withdrawalMessage = {
        amount: constants.MaxUint256,
        unwrap: true,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signWithdrawal(userA, accountVerifier, withdrawalMessage)

      // perform withdrawal and check balances
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature, TX_OVERRIDES))
        .to.emit(usdc, 'Transfer')
        .withArgs(accountA.address, userA.address, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)

      // collateral account should be empty
      expect(await dsu.balanceOf(accountA.address)).to.equal(0)
      expect(await usdc.balanceOf(accountA.address)).to.equal(0)

      // user should have their initial balance, plus what was in their collateral account, minus keeper fees
      expect(await usdc.balanceOf(userA.address)).to.be.within(parse6decimal('49999'), parse6decimal('50000'))
    })
  })

  describe('#relay', async () => {
    let accountA: Account
    let downstreamVerifier: Verifier
    let keeperBalanceBefore: BigNumber

    beforeEach(async () => {
      accountA = await createCollateralAccount(userA, parse6decimal('6'))
      downstreamVerifier = Verifier__factory.connect(await marketFactory.verifier(), owner)
      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
    })

    afterEach(async () => {
      // confirm keeper earned their fee
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
    })

    it('relays nonce cancellation messages', async () => {
      // confirm nonce was not already cancelled
      const nonce = 7
      expect(await downstreamVerifier.nonces(userA.address, nonce)).to.eq(false)

      // create and sign the inner message
      const nonceCancellation = {
        account: userA.address,
        signer: userA.address,
        domain: downstreamVerifier.address,
        nonce: nonce,
        group: 0,
        expiry: currentTime.add(60),
      }
      const innerSignature = await signNonceCancellation(userA, downstreamVerifier, nonceCancellation)

      // create and sign the outer message
      const relayedNonceCancellation = {
        nonceCancellation: nonceCancellation,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedNonceCancellation(userA, accountVerifier, relayedNonceCancellation)

      // perform the action
      await expect(
        controller.connect(keeper).relayNonceCancellation(relayedNonceCancellation, outerSignature, innerSignature),
      )
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, nonce)
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedNonceCancellation.action.common.nonce)

      // confirm nonce is now cancelled
      expect(await downstreamVerifier.nonces(userA.address, nonce)).to.eq(true)
    })

    it('relays group cancellation messages', async () => {
      // confirm group was not already cancelled
      const group = 7
      expect(await downstreamVerifier.groups(userA.address, group)).to.eq(false)

      // create and sign the inner message
      const groupCancellation = {
        group: group,
        common: {
          account: userA.address,
          signer: userA.address,
          domain: downstreamVerifier.address,
          nonce: 0,
          group: 0,
          expiry: currentTime.add(60),
        },
      }
      const innerSignature = await signGroupCancellation(userA, downstreamVerifier, groupCancellation)

      // create and sign the outer message
      const relayedGroupCancellation = {
        groupCancellation: groupCancellation,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedGroupCancellation(userA, accountVerifier, relayedGroupCancellation)

      // perform the action
      await expect(
        controller.connect(keeper).relayGroupCancellation(relayedGroupCancellation, outerSignature, innerSignature),
      )
        .to.emit(downstreamVerifier, 'GroupCancelled')
        .withArgs(userA.address, group)
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, groupCancellation.common.nonce)
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedGroupCancellation.action.common.nonce)

      // confirm group is now cancelled
      expect(await downstreamVerifier.groups(userA.address, group)).to.eq(true)
    })

    it('relays operator update messages', async () => {
      // confirm userB is not already an operator
      expect(await marketFactory.operators(userA.address, userB.address)).to.be.false

      // create and sign the inner message
      const operatorUpdate = {
        access: {
          accessor: userB.address,
          approved: true,
        },
        common: {
          account: userA.address,
          signer: userA.address,
          domain: marketFactory.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(60),
        },
      }
      const innerSignature = await signOperatorUpdate(userA, downstreamVerifier, operatorUpdate)

      // create and sign the outer message
      const relayedOperatorUpdateMessage = {
        operatorUpdate: operatorUpdate,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedOperatorUpdate(userA, accountVerifier, relayedOperatorUpdateMessage)

      // perform the action
      await expect(
        controller.connect(keeper).relayOperatorUpdate(relayedOperatorUpdateMessage, outerSignature, innerSignature),
      )
        .to.emit(marketFactory, 'OperatorUpdated')
        .withArgs(userA.address, userB.address, true)
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedOperatorUpdateMessage.operatorUpdate.common.nonce)
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedOperatorUpdateMessage.action.common.nonce)

      // confirm userB is now an operator
      expect(await marketFactory.operators(userA.address, userB.address)).to.be.true
    })

    it('relays signer update messages', async () => {
      // confirm userB is not already a delegated signer
      expect(await marketFactory.signers(userA.address, userB.address)).to.be.false

      // create and sign the inner message
      const signerUpdate = {
        access: {
          accessor: userB.address,
          approved: true,
        },
        common: {
          account: userA.address,
          signer: userA.address,
          domain: marketFactory.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(60),
        },
      }
      const innerSignature = await signSignerUpdate(userA, downstreamVerifier, signerUpdate)

      // create and sign the outer message
      const relayedSignerUpdateMessage = {
        signerUpdate: signerUpdate,
        ...createAction(userA.address, userA.address),
      }
      const outerSignature = await signRelayedSignerUpdate(userA, accountVerifier, relayedSignerUpdateMessage)

      // perform the action
      await expect(
        controller.connect(keeper).relaySignerUpdate(relayedSignerUpdateMessage, outerSignature, innerSignature),
      )
        .to.emit(marketFactory, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
        .to.emit(downstreamVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedSignerUpdateMessage.signerUpdate.common.nonce)
        .to.emit(accountVerifier, 'NonceCancelled')
        .withArgs(userA.address, relayedSignerUpdateMessage.action.common.nonce)

      // confirm userB is now a delegated signer
      expect(await marketFactory.signers(userA.address, userB.address)).to.be.true
    })
  })
})
