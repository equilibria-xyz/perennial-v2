import HRE from 'hardhat'
import { expect } from 'chai'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { BigNumber, constants, utils } from 'ethers'

import { signTake } from '@perennial/v2-core/test/helpers/erc712'
import { IMarket, IMarketFactory, IVerifier } from '@perennial/v2-core/types/generated'
import { TakeStruct } from '@perennial/v2-core/types/generated/contracts/Market'

import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { getEventArguments } from '../../../../common/testutil/transaction'
import { parse6decimal } from '../../../../common/testutil/types'
import { signDeployAccount, signRelayedTake } from '../../helpers/CollateralAccounts/eip712'
import {
  IAccount,
  IAccount__factory,
  IERC20,
  IERC20Metadata,
  IEmptySetReserve,
  IAccountVerifier,
  AccountVerifier__factory,
  Controller_Incentivized,
  Account__factory,
  Controller_Arbitrum__factory,
  AggregatorV3Interface,
  ArbGasInfo,
} from '../../../types/generated'
import { RelayedTakeStruct } from '../../../types/generated/contracts/CollateralAccounts/AccountVerifier'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
const { ethers } = HRE

const COMMON_PROTOTYPE = '(address,address,address,uint256,uint256,uint256)'
const KEEP_CONFIG = '(uint256,uint256,uint256,uint256)'
const MARKET_UPDATE_TAKE_PROTOTYPE = `update((int256,address,${COMMON_PROTOTYPE}),bytes)`

describe('Controller', () => {
  let controller: Controller_Incentivized
  let marketFactory: FakeContract<IMarketFactory>
  let marketVerifier: FakeContract<IVerifier>
  let verifier: IAccountVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let lastNonce = 0

  // create a default action for the specified user with reasonable fee and expiry
  async function createAction(
    userAddress: Address,
    signerAddress = userAddress,
    maxFee = utils.parseEther('0.2'),
    expiresInSeconds = 6,
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
          expiry: (await currentBlockTimestamp()) + expiresInSeconds,
        },
      },
    }
  }

  // deploys a collateral account for the specified user and returns the address
  async function createCollateralAccount(user: SignerWithAddress): Promise<IAccount> {
    const deployAccountMessage = {
      ...(await createAction(user.address)),
    }
    const signatureCreate = await signDeployAccount(user, verifier, deployAccountMessage)
    const tx = await controller.connect(user).deployAccountWithSignature(deployAccountMessage, signatureCreate)
    // verify the address from event arguments
    const creationArgs = await getEventArguments(tx, 'AccountDeployed')
    const accountAddress = await controller.getAccountAddress(user.address)
    expect(creationArgs.account).to.equal(accountAddress)
    return IAccount__factory.connect(accountAddress, user)
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  const fixture = async () => {
    ;[owner, userA, userB] = await ethers.getSigners()
    const usdc = await smock.fake<IERC20>('IERC20')
    const dsu = await smock.fake<IERC20>('IERC20')
    const reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    marketVerifier = await smock.fake<IVerifier>('IVerifier')

    const accountImpl = await new Account__factory(owner).deploy(usdc.address, dsu.address, reserve.address)
    accountImpl.initialize(constants.AddressZero)
    controller = await new Controller_Arbitrum__factory(owner).deploy(
      accountImpl.address,
      marketFactory.address,
      await marketFactory.verifier(),
    )

    // fake arbitrum gas calls used by Kept, required for Controller_Arbitrum,
    // a concrete implementation of abstract Controller_Incentivized contract
    const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
      address: '0x000000000000000000000000000000000000006C',
    })
    gasInfo.getL1BaseFeeEstimate.returns(1)

    const chainlink = await smock.fake<AggregatorV3Interface>('AggregatorV3Interface')
    verifier = await new AccountVerifier__factory(owner).deploy(marketFactory.address)
    const keepConfig = {
      multiplierBase: ethers.utils.parseEther('1'),
      bufferBase: 0,
      multiplierCalldata: ethers.utils.parseEther('1'),
      bufferCalldata: 0,
    }

    await controller[`initialize(address,address,${KEEP_CONFIG},${KEEP_CONFIG},${KEEP_CONFIG})`](
      verifier.address,
      chainlink.address,
      keepConfig,
      keepConfig,
      keepConfig,
    )

    // assume all token transfers are successful, including those used to compensate keepers
    dsu.transferFrom.returns(true)
    dsu.transfer.returns(true)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  describe('#relayer', () => {
    it('relays a message for a taker to update their market position with a delta', async () => {
      // create a collateral account for the taker
      const account = await createCollateralAccount(userA)
      // create a market in which taker position should be adjusted
      const dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
      const market = await smock.fake<IMarket>('IMarket')

      // taker (userA) creates and signs the inner message
      const take: TakeStruct = {
        amount: parse6decimal('7.5'),
        referrer: constants.AddressZero,
        common: {
          account: userA.address,
          signer: userA.address,
          domain: market.address,
          nonce: nextNonce(),
          group: 0,
          expiry: (await currentBlockTimestamp()) + 12,
        },
      }
      const innerSignature = await signTake(userA, marketVerifier, take)

      // relayer (userB) creates and signs the outer message
      const relayTake: RelayedTakeStruct = {
        take: take,
        ...(await createAction(userB.address)),
      }
      const outerSignature = await signRelayedTake(userB, verifier, relayTake)

      // relayer relays the message
      expect(await controller.connect(userB).relayTake(relayTake, outerSignature, innerSignature)).to.not.be.reverted

      // TODO: find a cleaner way to compare these structs, maybe using the expectEq pattern
      const actualTake = market[MARKET_UPDATE_TAKE_PROTOTYPE].getCall(0).args[0] as TakeStruct
      expect(actualTake.amount).to.equal(take.amount)
      expect(actualTake.referrer).to.equal(take.referrer)
      //expect(actualTake.common).to.deep.contain(take.common) // FIXME: this doesn't work
      expect(market[MARKET_UPDATE_TAKE_PROTOTYPE].getCall(0).args[1]).to.equal(innerSignature)
    })
  })
})
