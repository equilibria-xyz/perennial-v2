import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { advanceBlock, currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  ArbGasInfo,
  Controller_Arbitrum,
  IERC20Metadata,
  IMarket,
  IMarketFactory,
  IVerifier,
  Verifier__factory,
} from '../../types/generated'
import {
  signDeployAccount,
  signMarketTransfer,
  signRebalanceConfigChange,
  signSignerUpdate,
  signWithdrawal,
} from '../helpers/erc712'
import {
  createMarketFactory,
  createMarketForOracle,
  deployAndInitializeController,
  deployControllerArbitrum,
  fundWalletDSU,
  fundWalletUSDC,
} from '../helpers/arbitrumHelpers'
import { getEventArguments } from '../helpers/setupHelpers'

const { ethers } = HRE

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation
const DEFAULT_MAX_FEE = utils.parseEther('0.5')
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

// hack around issues estimating gas for instrumented contracts when running tests under coverage
const TX_OVERRIDES = { gasLimit: 3_000_000, maxFeePerGas: 200_000_000 }

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
    const signatureCreate = await signDeployAccount(user, verifier, deployAccountMessage)
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

  const fixture = async () => {
    // create a market
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    ;[dsu, usdc] = await deployAndInitializeController(owner)
    marketFactory = await createMarketFactory(owner)
    ;[market, ,] = await createMarketForOracle(owner, marketFactory, dsu)
    await dsu.connect(userA).approve(market.address, constants.MaxUint256, { maxFeePerGas: 100000000 })

    // set up users and deploy artifacts
    const keepConfig = {
      multiplierBase: 0,
      bufferBase: 1_000_000,
      multiplierCalldata: 0,
      bufferCalldata: 500_000,
    }
    controller = await deployControllerArbitrum(owner, keepConfig, { maxFeePerGas: 100000000 })
    verifier = await new Verifier__factory(owner).deploy({ maxFeePerGas: 100000000 })
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
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

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
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

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
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
      await expect(
        controller
          .connect(keeper)
          .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 }),
      ).to.be.revertedWithCustomError(controller, 'ControllerCannotPayKeeperError')
    })
  })

  describe('#delegation', async () => {
    beforeEach(async () => {
      // keeper starts with no funds
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      expect(keeperBalanceBefore).to.equal(0)
    })

    it('cannot collect fee for assigning a delegate before account creation', async () => {
      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...createAction(userA.address, userA.address),
      }

      // assign the delegate
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature)).to.be.reverted
    })

    it('collects fee for assigning a delegate', async () => {
      // create and fund the account
      await createCollateralAccount(userA, parse6decimal('12000'))

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...createAction(userA.address, userA.address),
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

    async function deposit(amount = parse6decimal('12000')) {
      // sign a message to deposit everything from the collateral account to the market
      const marketTransferMessage = {
        market: market.address,
        amount: amount,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, market.address, anyValue) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
    }

    it('collects fee for depositing some funds to market', async () => {
      // sign a message to deposit 6k from the collateral account to the market
      const transferAmount = parse6decimal('6000')
      const marketTransferMessage = {
        market: market.address,
        amount: transferAmount,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, market.address, transferAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(transferAmount)
    })

    it('collects fee for withdrawing some funds from market', async () => {
      // user deposits collateral to the market
      await deposit(parse6decimal('12000'))
      expect((await market.locals(userA.address)).collateral).to.equal(parse6decimal('12000'))

      // sign a message to make a partial withdrawal
      const withdrawal = parse6decimal('-2000')
      const marketTransferMessage = {
        market: market.address,
        amount: withdrawal,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, withdrawal.mul(-1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue, anyValue)
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
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, depositAmount.mul(1e12)) // scale to token precision
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.equal(0)
    })

    it('collects fee for withdrawing funds into empty collateral account', async () => {
      // deposit 12k
      await deposit()
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
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(market.address, accountA.address, anyValue)
        .to.emit(market, 'OrderCreated')
        .withArgs(userA.address, anyValue, anyValue)
        .to.emit(controller, 'KeeperCall')
        .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)
      expect((await market.locals(userA.address)).collateral).to.be.within(
        parse6decimal('9999'),
        parse6decimal('10000'),
      ) // 12k-2k
    })
  })

  describe('#rebalance', async () => {
    it('collects fee for changing rebalance configuration', async () => {
      // record keeper balance, create and fund userA's collateral account
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await createCollateralAccount(userA, parse6decimal('5'))

      // sign message to create a new group
      const message = {
        group: 5,
        markets: [market.address],
        configs: [{ target: parse6decimal('1'), threshold: parse6decimal('0.0901') }],
        ...(await createAction(userA.address)),
      }
      const signature = await signRebalanceConfigChange(userA, verifier, message)

      // create the group
      await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature, TX_OVERRIDES))
        .to.emit(controller, 'RebalanceMarketConfigured')
        .withArgs(userA.address, message.group, market.address, message.configs[0])
        .to.emit(controller, 'RebalanceGroupConfigured')
        .withArgs(userA.address, message.group, 1)

      // ensure keeper was compensated
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)
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
      await controller.connect(userA).updateSigner(userB.address, true, TX_OVERRIDES)

      // delegate signs message for partial withdrawal
      const withdrawalAmount = parse6decimal('7000')
      const withdrawalMessage = {
        amount: withdrawalAmount,
        unwrap: true,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

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
      const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

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
})
