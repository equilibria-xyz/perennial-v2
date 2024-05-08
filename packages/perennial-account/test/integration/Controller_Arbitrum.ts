import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
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
  IKept,
  Verifier,
  Verifier__factory,
} from '../../types/generated'
import { signDeployAccount, signWithdrawal } from '../helpers/erc712'

const { ethers } = HRE

const DSU_ADDRESS = '0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b' // Digital Standard Unit, compatible with Market
const DSU_HOLDER = '0x90a664846960aafa2c164605aebb8e9ac338f9a0' // Market has 466k at height 208460709

const CHAINLINK_ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' // price feed used for keeper compensation

describe('Controller_Arbitrum', () => {
  let dsu: IERC20Metadata
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
  function createAction(
    accountAddress: Address,
    userAddress: Address,
    feeOverride = utils.parseEther('14'),
    expiresInSeconds = 16,
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

  const fixture = async () => {
    // set up users and deploy artifacts
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
    const keepConfig = {
      multiplierBase: 0,
      bufferBase: 1_000_000,
      multiplierCalldata: 0,
      bufferCalldata: 500_000,
    }
    controller = await new Controller_Arbitrum__factory(owner).deploy(keepConfig)
    verifier = await new Verifier__factory(owner).deploy()
    verifierSigner = await impersonate.impersonateWithBalance(verifier.address, utils.parseEther('10'))
    await controller['initialize(address,address,address)'](verifier.address, CHAINLINK_ETH_USD_FEED, dsu.address)
  }

  beforeEach(async () => {
    currentTime = BigNumber.from(await currentBlockTimestamp())
    await loadFixture(fixture)

    // Hardhat fork network does not support Arbitrum built-ins, so we need to fake this call for testing
    const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    gasInfo.getL1BaseFeeEstimate.returns(0)
  })

  describe('#deployment', () => {
    afterEach(async () => {
      // ensure controller has no funds at rest
      expect(await dsu.balanceOf(controller.address)).to.equal(0)
    })

    it('can create an account', async () => {
      // fund userA and pre-fund the collateral account with 15k DSU
      await fundWallet(userA)
      const accountAddressA = await controller.getAccountAddress(userA.address)
      await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'))

      // sign a message to deploy the account
      const deployAccountMessage = {
        ...createAction(accountAddressA, userA.address),
      }
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

      // keeper executes deployment of the account and is compensated
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature)
      accountA = Account__factory.connect(accountAddressA, userA)
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      // TODO: See if chai supports custom matchers; I once implemented a "to.be.between" for jest.
      expect(keeperFeePaid).to.be.greaterThan(utils.parseEther('0.001'))
      expect(keeperFeePaid).to.be.lessThan(utils.parseEther('0.005'))
    })

    it('keeper fee is limited by maxFee', async () => {
      // fund userA and pre-fund the collateral account with 15k DSU
      await fundWallet(userA)
      const accountAddressA = await controller.getAccountAddress(userA.address)
      await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'))

      // sign a message with maxFee smaller than the calculated keeper fee (~0.0033215)
      const maxFee = parse6decimal('0.000789')
      const deployAccountMessage = {
        ...createAction(accountAddressA, userA.address, maxFee),
      }
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

      // keeper executes deployment of the account and is compensated
      const keeperBalanceBefore = await dsu.balanceOf(keeper.address)
      await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature)
      accountA = Account__factory.connect(accountAddressA, userA)
      const keeperFeePaid = (await dsu.balanceOf(keeper.address)).sub(keeperBalanceBefore)
      expect(keeperFeePaid).to.equal(maxFee.mul(1e12)) // convert from 6- to 18- decimal
    })
  })
})
