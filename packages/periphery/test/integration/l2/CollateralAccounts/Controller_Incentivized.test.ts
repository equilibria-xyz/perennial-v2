import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { advanceBlock, currentBlockTimestamp } from '../../../../../common/testutil/time'
import { getEventArguments } from '../../../../../common/testutil/transaction'

import {
  DEFAULT_GUARANTEE,
  DEFAULT_ORDER,
  expectOrderEq,
  parse6decimal,
  Take,
} from '../../../../../common/testutil/types'
import {
  Account,
  Account__factory,
  Controller_Incentivized,
  IAccount,
  IAccountVerifier,
  IERC20Metadata,
  IMarket,
  IMarketFactory,
} from '../../../../types/generated'

import {
  signDeployAccount,
  signMarketTransfer,
  signRebalanceConfigChange,
  signRelayedAccessUpdateBatch,
  signRelayedGroupCancellation,
  signRelayedNonceCancellation,
  signRelayedOperatorUpdate,
  signRelayedSignerUpdate,
  signRelayedTake,
  signWithdrawal,
} from '../../../helpers/CollateralAccounts/eip712'
import {
  signAccessUpdateBatch,
  signGroupCancellation,
  signCommon as signNonceCancellation,
  signOperatorUpdate,
  signSignerUpdate,
  signTake,
} from '@perennial/v2-core/test/helpers/erc712'
import { Verifier, Verifier__factory } from '@perennial/v2-core/types/generated'
import { AggregatorV3Interface } from '@perennial/v2-oracle/types/generated'
import { DeploymentVars } from './setupTypes'
import { advanceToPrice } from '../../../helpers/oracleHelpers'
import { RelayedTakeStruct } from '../../../../types/generated/contracts/CollateralAccounts/AccountVerifier'

const { ethers } = HRE

const DEFAULT_MAX_FEE = parse6decimal('0.5')

const MARKET_UPDATE_ABSOLUTE_PROTOTYPE = 'update(address,uint256,uint256,uint256,int256,bool)'
const MARKET_UPDATE_DELTA_PROTOTYPE = 'update(address,int256,int256,address)'

// hack around issues estimating gas for instrumented contracts when running tests under coverage
// also, need higher gasLimit to deploy incentivized controllers with optimizer disabled
const TX_OVERRIDES = { gasLimit: 12_000_000, maxPriorityFeePerGas: 0, maxFeePerGas: 100_000_000 }

export function RunIncentivizedTests(
  name: string,
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
  mockGasInfo: () => Promise<void>,
): void {
  describe(name, () => {
    let deployment: DeploymentVars
    let dsu: IERC20Metadata
    let usdc: IERC20Metadata
    let controller: Controller_Incentivized
    let accountVerifier: IAccountVerifier
    let marketFactory: IMarketFactory
    let ethMarket: IMarket
    let btcMarket: IMarket
    let owner: SignerWithAddress
    let userA: SignerWithAddress
    let userB: SignerWithAddress
    let userC: SignerWithAddress
    let keeper: SignerWithAddress
    let receiver: SignerWithAddress
    let lastNonce = 0
    let currentTime: BigNumber
    let keeperBalanceBefore: BigNumber
    let keeperEthBalanceBefore: BigNumber

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

    async function checkCompensation(priceCommitments = 0) {
      const keeperFeesPaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      let keeperEthSpentOnGas = keeperEthBalanceBefore.sub(await keeper.getBalance())

      // if TXes in test required outside price commitments, compensate the keeper for them
      // TODO: This amount is for an Arbitrum price committment; should make this chain-specific
      // once we know the cost of a Base price committment.
      keeperEthSpentOnGas = keeperEthSpentOnGas.add(utils.parseEther('0.0000644306').mul(priceCommitments))

      // cost of transaction
      const keeperGasCostInUSD = keeperEthSpentOnGas.mul(3413)
      // keeper should be compensated between 100-125% of actual gas cost
      expect(keeperFeesPaid).to.be.within(keeperGasCostInUSD, keeperGasCostInUSD.mul(125).div(100))
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
        market: ethMarket.address,
        amount: amount,
        ...createAction(userA.address, userA.address),
      }
      const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

      // perform transfer
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(account.address, ethMarket.address, anyValue) // scale to token precision
        .to.emit(ethMarket, 'OrderCreated')
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
    }

    const fixture = async () => {
      // deploy the protocol
      ;[owner, userA, userB, userC, keeper, receiver] = await ethers.getSigners()
      deployment = await deployProtocol(owner, true, true, TX_OVERRIDES)
      dsu = deployment.dsu
      usdc = deployment.usdc
      marketFactory = deployment.marketFactory
      let ethMarketDeployment
      if (deployment.ethMarket) {
        ethMarketDeployment = deployment.ethMarket
        ethMarket = deployment.ethMarket.market
      } else {
        throw new Error('BTC market not created')
      }
      let btcMarketDeployment
      if (deployment.btcMarket) {
        btcMarketDeployment = deployment.btcMarket
        btcMarket = btcMarketDeployment.market
      } else {
        throw new Error('BTC market not created')
      }

      ;[controller, accountVerifier] = await deployController(
        owner,
        deployment.marketFactory,
        deployment.chainlinkKeptFeed,
        TX_OVERRIDES,
      )

      await advanceToPrice(
        ethMarketDeployment.keeperOracle,
        receiver,
        currentTime,
        parse6decimal('3113.7128'),
        TX_OVERRIDES,
      )
      await advanceToPrice(
        btcMarketDeployment.keeperOracle,
        receiver,
        currentTime,
        parse6decimal('57575.464'),
        TX_OVERRIDES,
      )

      // fund userA
      await dsu.connect(userA).approve(ethMarket.address, constants.MaxUint256, { maxFeePerGas: 100000000 })
      await deployment.fundWalletDSU(userA, utils.parseEther('5000'), TX_OVERRIDES)
      await deployment.fundWalletUSDC(userA, parse6decimal('50000'), { maxFeePerGas: 100000000 })
    }

    before(async () => {
      // touch the provider, such that smock doesn't error out running a single test
      await advanceBlock()
      // mock gas information for the chain being tested
      await mockGasInfo()
    })

    beforeEach(async () => {
      // update the timestamp used for calculating expiry and adjusting oracle price
      currentTime = BigNumber.from(await currentBlockTimestamp())
      await loadFixture(fixture)

      // set a realistic base gas fee
      await HRE.ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100']) // 0.1 gwei

      keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      keeperEthBalanceBefore = await keeper.getBalance()
      currentTime = BigNumber.from(await currentBlockTimestamp())
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
        await usdc.connect(userA).transfer(accountAddressA, parse6decimal('15000'), TX_OVERRIDES)

        // sign a message to deploy the account
        const deployAccountMessage = {
          ...createAction(userA.address, userA.address),
        }
        const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)

        // keeper executes deployment of the account and is compensated
        await expect(
          controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature, TX_OVERRIDES),
        )
          .to.emit(controller, 'AccountDeployed')
          .withArgs(userA.address, accountAddressA)

        await checkCompensation()
      })

      it('keeper fee is limited by maxFee', async () => {
        // pre-fund the address where the account will be deployed
        await usdc.connect(userA).transfer(accountAddressA, parse6decimal('15000'), TX_OVERRIDES)

        // sign a message with maxFee smaller than the calculated keeper fee (~0.0033215)
        const maxFee = parse6decimal('0.0789')
        const deployAccountMessage = {
          ...createAction(userA.address, userA.address, maxFee),
        }
        const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)

        // keeper executes deployment of the account and is compensated
        await expect(
          controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature, TX_OVERRIDES),
        )
          .to.emit(controller, 'AccountDeployed')
          .withArgs(userA.address, accountAddressA)

        const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
        expect(keeperFeePaid).to.equal(maxFee.mul(1e12)) // convert from 6- to 18- decimal
      })

      it('reverts if keeper cannot be compensated', async () => {
        // ensure the account is empty
        expect(await dsu.balanceOf(keeper.address)).to.equal(0)
        expect(await usdc.balanceOf(keeper.address)).to.equal(0)

        // sign a message to deploy the account
        const deployAccountMessage = {
          ...createAction(userA.address, userA.address),
        }

        // ensure the request fails
        const signature = await signDeployAccount(userA, accountVerifier, deployAccountMessage)
        await expect(
          controller
            .connect(keeper)
            .deployAccountWithSignature(deployAccountMessage, signature, { maxFeePerGas: 100000000 }),
        ).to.be.reverted
      })
    })

    describe('#transfer', async () => {
      const INITIAL_DEPOSIT_6 = parse6decimal('13000')
      let accountA: Account

      beforeEach(async () => {
        // deploy collateral account for userA
        accountA = await createCollateralAccount(userA, INITIAL_DEPOSIT_6)
      })

      it('collects fee for depositing some funds to market', async () => {
        // sign a message to deposit 6k from the collateral account to the market
        const transferAmount = parse6decimal('6000')
        const marketTransferMessage = {
          market: ethMarket.address,
          amount: transferAmount,
          ...createAction(userA.address),
        }
        const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

        // perform transfer
        await expect(
          controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
        )
          .to.emit(dsu, 'Transfer')
          .withArgs(accountA.address, ethMarket.address, transferAmount.mul(1e12)) // scale to token precision
          .to.emit(ethMarket, 'OrderCreated')
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
        expect((await ethMarket.locals(userA.address)).collateral).to.equal(transferAmount)

        await checkCompensation(1)
      })

      it('collects fee for withdrawing some funds from market', async () => {
        // user deposits collateral to the market
        await deposit(parse6decimal('12000'), accountA)
        expect((await ethMarket.locals(userA.address)).collateral).to.equal(parse6decimal('12000'))

        // sign a message to make a partial withdrawal
        const withdrawal = parse6decimal('-2000')
        const marketTransferMessage = {
          market: ethMarket.address,
          amount: withdrawal,
          ...createAction(userA.address, userA.address),
        }
        const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

        // perform transfer
        await expect(
          controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
        )
          .to.emit(dsu, 'Transfer')
          .withArgs(ethMarket.address, accountA.address, withdrawal.mul(-1e12)) // scale to token precision
          .to.emit(ethMarket, 'OrderCreated')
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
        expect((await ethMarket.locals(userA.address)).collateral).to.equal(parse6decimal('10000')) // 12k-2k

        await checkCompensation(2)
      })

      it('collects fee for withdrawing native deposit from market', async () => {
        // user directly deposits collateral to the market
        const depositAmount = parse6decimal('13000')
        await deployment.fundWalletDSU(userA, depositAmount.mul(1e12), TX_OVERRIDES)
        await ethMarket
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
        expect((await ethMarket.locals(userA.address)).collateral).to.equal(depositAmount)

        // sign a message to withdraw everything from the market back into the collateral account
        const marketTransferMessage = {
          market: ethMarket.address,
          amount: constants.MinInt256,
          ...createAction(userA.address, userA.address),
        }
        const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

        // perform transfer
        await expect(
          controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
        )
          .to.emit(dsu, 'Transfer')
          .withArgs(ethMarket.address, accountA.address, depositAmount.mul(1e12)) // scale to token precision
          .to.emit(ethMarket, 'OrderCreated')
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
        expect((await ethMarket.locals(userA.address)).collateral).to.equal(0)

        await checkCompensation(1)
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
          market: ethMarket.address,
          amount: withdrawal,
          ...createAction(userA.address, userA.address),
        }
        const signature = await signMarketTransfer(userA, accountVerifier, marketTransferMessage)

        // perform transfer
        await expect(
          controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
        )
          .to.emit(dsu, 'Transfer')
          .withArgs(ethMarket.address, accountA.address, anyValue)
          .to.emit(ethMarket, 'OrderCreated')
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
        expect((await ethMarket.locals(userA.address)).collateral).to.be.within(
          parse6decimal('9999'),
          parse6decimal('10000'),
        ) // 12k-2k

        await checkCompensation(2)
      })
    })

    describe('#rebalance', async () => {
      let accountA: Account

      beforeEach(async () => {
        accountA = await createCollateralAccount(userA, parse6decimal('10005'))
      })

      it('collects fee for changing rebalance configuration', async () => {
        // sign message to create a new group
        const message = {
          group: 5,
          markets: [ethMarket.address],
          configs: [{ target: parse6decimal('1'), threshold: parse6decimal('0.0901') }],
          maxFee: DEFAULT_MAX_FEE,
          ...(await createAction(userA.address)),
        }
        const signature = await signRebalanceConfigChange(userA, accountVerifier, message)

        // create the group
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature, TX_OVERRIDES))
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, message.group, ethMarket.address, message.configs[0])
          .to.emit(controller, 'RebalanceGroupConfigured')
          .withArgs(userA.address, message.group, 1)

        // ensure keeper was compensated
        await checkCompensation()
      })

      it('collects fee for rebalancing a group', async () => {
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
        await checkCompensation(2)
      })

      it('honors max rebalance fee when rebalancing a group', async () => {
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

        // transfer some collateral to ethMarket and record keeper balance after account creation
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

      it('cannot award more keeper fees than collateral rebalanced', async () => {
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

        let dustAmount = parse6decimal('0.000001')
        await dsu.connect(keeper).approve(ethMarket.address, dustAmount.mul(1e12), TX_OVERRIDES)

        // keeper dusts one of the markets
        await ethMarket
          .connect(keeper)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userA.address,
            constants.MaxUint256,
            constants.MaxUint256,
            constants.MaxUint256,
            dustAmount,
            false,
            { maxFeePerGas: 150000000 },
          )
        expect((await ethMarket.locals(userA.address)).collateral).to.equal(dustAmount)

        // keeper cannot rebalance because dust did not exceed maxFee
        await expect(
          controller.connect(keeper).rebalanceGroup(userA.address, 4, TX_OVERRIDES),
        ).to.be.revertedWithCustomError(controller, 'ControllerGroupBalancedError')

        // keeper dusts the other market, such that target is nonzero, and percentage exceeded
        dustAmount = parse6decimal('0.000003')
        await dsu.connect(keeper).approve(btcMarket.address, dustAmount.mul(1e12), TX_OVERRIDES)
        await btcMarket
          .connect(keeper)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            userA.address,
            constants.MaxUint256,
            constants.MaxUint256,
            constants.MaxUint256,
            dustAmount,
            false,
            { maxFeePerGas: 150000000 },
          )
        expect((await btcMarket.locals(userA.address)).collateral).to.equal(dustAmount)

        // keeper still cannot rebalance because dust did not exceed maxFee
        await expect(
          controller.connect(keeper).rebalanceGroup(userA.address, 4, TX_OVERRIDES),
        ).to.be.revertedWithCustomError(controller, 'ControllerGroupBalancedError')
      })
    })

    describe('#withdrawal', async () => {
      let accountA: Account
      let usdcBalanceBefore: BigNumber

      beforeEach(async () => {
        // deploy collateral account for userA
        accountA = await createCollateralAccount(userA, parse6decimal('17000'))
        usdcBalanceBefore = await usdc.balanceOf(userA.address)
      })

      afterEach(async () => {
        // confirm keeper earned their fee
        await checkCompensation(1)
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
        expect(await usdc.balanceOf(userA.address)).to.equal(usdcBalanceBefore.add(withdrawalAmount))
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
        expect((await usdc.balanceOf(userA.address)).sub(usdcBalanceBefore)).to.be.within(
          parse6decimal('16999'),
          parse6decimal('17000'),
        )
      })
    })

    describe('#relay', async () => {
      let downstreamVerifier: Verifier

      function createCommon(domain: Address) {
        return {
          common: {
            account: userA.address,
            signer: userA.address,
            domain: domain,
            nonce: nextNonce(),
            group: 0,
            expiry: currentTime.add(60),
          },
        }
      }

      beforeEach(async () => {
        await createCollateralAccount(userA, parse6decimal('6'))
        downstreamVerifier = Verifier__factory.connect(await marketFactory.verifier(), owner)
        downstreamVerifier.initialize(marketFactory.address, TX_OVERRIDES)
      })

      afterEach(async () => {
        // confirm keeper earned their fee
        await checkCompensation()
      })

      it('relays take messages', async () => {
        // user deposits into the market
        const COLLATERAL_A = parse6decimal('5000')
        await ethMarket
          .connect(userA)
          [MARKET_UPDATE_DELTA_PROTOTYPE](userA.address, 0, COLLATERAL_A, constants.AddressZero, TX_OVERRIDES)
        // userB deposits and opens maker position, adding liquidity to market
        const COLLATERAL_B = parse6decimal('10000')
        const POSITION_B = parse6decimal('2')
        await dsu.connect(userB).approve(ethMarket.address, constants.MaxUint256, TX_OVERRIDES)
        await deployment.fundWalletDSU(userB, utils.parseEther('10000'), TX_OVERRIDES)
        await ethMarket
          .connect(userB)
          [MARKET_UPDATE_ABSOLUTE_PROTOTYPE](userB.address, POSITION_B, 0, 0, COLLATERAL_B, false, TX_OVERRIDES)
        expectOrderEq(await ethMarket.pending(), {
          ...DEFAULT_ORDER,
          orders: 1,
          collateral: COLLATERAL_A.add(COLLATERAL_B),
          makerPos: POSITION_B,
        })

        // userA signs a message to establish a long position
        const POSITION_A = parse6decimal('1.5')
        const take: Take = {
          amount: POSITION_A,
          referrer: constants.AddressZero,
          common: {
            account: userA.address,
            signer: userA.address,
            domain: ethMarket.address,
            nonce: nextNonce(),
            group: 0,
            expiry: (await currentBlockTimestamp()) + 12,
          },
        }
        const innerSignature = await signTake(userA, downstreamVerifier, take)

        // userA signs a request to relay the take message
        const relayedTake: RelayedTakeStruct = {
          take: take,
          ...createAction(userA.address, userA.address),
        }
        const outerSignature = await signRelayedTake(userA, accountVerifier, relayedTake)

        // perform the action
        await expect(controller.connect(keeper).relayTake(relayedTake, outerSignature, innerSignature, TX_OVERRIDES))
          .to.emit(ethMarket, 'OrderCreated')
          .withArgs(
            userA.address,
            anyValue,
            { ...DEFAULT_GUARANTEE },
            constants.AddressZero,
            constants.AddressZero,
            constants.AddressZero,
          )
          .to.emit(controller, 'KeeperCall')
          .withArgs(keeper.address, anyValue, 0, anyValue, anyValue, anyValue)

        expectOrderEq(await ethMarket.pending(), {
          ...DEFAULT_ORDER,
          orders: 2,
          collateral: COLLATERAL_A.add(COLLATERAL_B),
          makerPos: POSITION_B,
          longPos: POSITION_A,
        })
        expectOrderEq(await ethMarket.pendings(userA.address), {
          ...DEFAULT_ORDER,
          orders: 1,
          collateral: COLLATERAL_A,
          longPos: POSITION_A,
        })
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
          controller
            .connect(keeper)
            .relayNonceCancellation(relayedNonceCancellation, outerSignature, innerSignature, TX_OVERRIDES),
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
          ...createCommon(downstreamVerifier.address),
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
          controller
            .connect(keeper)
            .relayGroupCancellation(relayedGroupCancellation, outerSignature, innerSignature, TX_OVERRIDES),
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
          ...createCommon(marketFactory.address),
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
          controller
            .connect(keeper)
            .relayOperatorUpdate(relayedOperatorUpdateMessage, outerSignature, innerSignature, TX_OVERRIDES),
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
          ...createCommon(marketFactory.address),
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
          controller
            .connect(keeper)
            .relaySignerUpdate(relayedSignerUpdateMessage, outerSignature, innerSignature, TX_OVERRIDES),
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

      it('relays batch access update messages', async () => {
        // confirm userB is not already an operator, and userC is not already a delegated signer
        expect(await marketFactory.operators(userA.address, userB.address)).to.be.false
        expect(await marketFactory.signers(userA.address, userC.address)).to.be.false

        // create and sign the inner message
        const accessUpdateBatch = {
          operators: [{ accessor: userB.address, approved: true }],
          signers: [{ accessor: userC.address, approved: true }],
          ...createCommon(marketFactory.address),
        }
        const innerSignature = await signAccessUpdateBatch(userA, downstreamVerifier, accessUpdateBatch)

        // create and sign the outer message
        const relayedAccessUpdateBatchMesage = {
          accessUpdateBatch: accessUpdateBatch,
          ...createAction(userA.address),
        }
        const outerSignature = await signRelayedAccessUpdateBatch(
          userA,
          accountVerifier,
          relayedAccessUpdateBatchMesage,
        )

        // perform the action
        await expect(
          controller
            .connect(keeper)
            .relayAccessUpdateBatch(relayedAccessUpdateBatchMesage, outerSignature, innerSignature, TX_OVERRIDES),
        )
          .to.emit(marketFactory, 'OperatorUpdated')
          .withArgs(userA.address, userB.address, true)
          .to.emit(marketFactory, 'SignerUpdated')
          .withArgs(userA.address, userC.address, true)
          .to.emit(downstreamVerifier, 'NonceCancelled')
          .withArgs(userA.address, accessUpdateBatch.common.nonce)
          .to.emit(accountVerifier, 'NonceCancelled')
          .withArgs(userA.address, relayedAccessUpdateBatchMesage.action.common.nonce)

        // confirm userB is now an operator, and userC a delegated signer
        expect(await marketFactory.operators(userA.address, userB.address)).to.be.true
        expect(await marketFactory.signers(userA.address, userC.address)).to.be.true
      })
    })
  })
}
