import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import {
  Account,
  Account__factory,
  ArbGasInfo,
  Controller_Arbitrum,
  Controller_Arbitrum__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  Verifier,
  Verifier__factory,
} from '../../types/generated'
import { signDeployAccount, signSignerUpdate, signWithdrawal } from '../helpers/erc712'
import { AccountDeployedEventObject } from '../../types/generated/contracts/Controller'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, compatible with Market
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Market has 466k at height 208460709
const DSU_RESERVE = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'
const USDCe_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' // Arbitrum bridged USDC

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation
const DEFAULT_MAX_FEE = utils.parseEther('0.5')

describe('Controller_Arbitrum', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller_Arbitrum
  let verifier: Verifier
  let verifierSigner: SignerWithAddress
  let accountA: Account
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
    return Account__factory.connect(accountAddress, user)
  }

  // funds specified wallet with 50k collateral
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    const dsuOwner = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    expect(await dsu.balanceOf(DSU_HOLDER)).to.be.greaterThan(utils.parseEther('50000'))
    await dsu.connect(dsuOwner).transfer(wallet.address, utils.parseEther('50000'), { maxFeePerGas: 100000000 })
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    // set up users and deploy artifacts
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
    usdc = IERC20Metadata__factory.connect(USDCe_ADDRESS, owner)
    const keepConfig = {
      multiplierBase: 0,
      bufferBase: 1_000_000,
      multiplierCalldata: 0,
      bufferCalldata: 500_000,
    }
    controller = await new Controller_Arbitrum__factory(owner).deploy(keepConfig)
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
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
    currentTime = BigNumber.from(await currentBlockTimestamp())
    await loadFixture(fixture)

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
      accountA = Account__factory.connect(accountAddressA, userA)
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
      accountA = Account__factory.connect(accountAddressA, userA)
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.equal(maxFee.mul(1e12)) // convert from 6- to 18- decimal
    })
  })

  describe('#delegation', () => {
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

  describe('#withdrawal', async () => {
    let accountA: Account

    beforeEach(async () => {
      // deploy collateral account for userA
      accountA = await createCollateralAccount(userA, utils.parseEther('17000'))
    })

    it('collects fee for partial withdrawal from a delegated signer', async () => {
      const userBalanceBefore = await usdc.balanceOf(userA.address)

      // configure userB as delegated signer
      await controller.connect(userA).updateSigner(userB.address, true, { maxFeePerGas: 100000000 })

      // delegate signs message for full withdrawal
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

      // confirm keeper earned their fee for creating the account and processing the withdrawal
      const cumulativeKeeperFee = await dsu.balanceOf(keeper.address)
      expect(cumulativeKeeperFee).to.be.within(utils.parseEther('0.001'), DEFAULT_MAX_FEE)

      // confirm userA withdrew their funds and keeper fee was paid from the collateral account
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('10000').sub(cumulativeKeeperFee))
      expect(await usdc.balanceOf(userA.address)).to.equal(userBalanceBefore.add(withdrawalAmount))
    })
  })
})
