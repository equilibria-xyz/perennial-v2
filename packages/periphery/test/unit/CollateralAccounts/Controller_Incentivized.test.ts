import HRE from 'hardhat'
import { expect } from 'chai'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { BigNumber, constants, utils } from 'ethers'

import { signAccessUpdateBatch, signSignerUpdate, signTake } from '@perennial/v2-core/test/helpers/erc712'
import { IMarket, IMarketFactory, IVerifier } from '@perennial/v2-core/types/generated'

import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { getEventArguments } from '../../../../common/testutil/transaction'
import {
  AccessUpdateBatch,
  expectAccessUpdateBatchEq,
  expectSignerUpdateEq,
  expectTakeEq,
  parse6decimal,
  SignerUpdate,
  Take,
} from '../../../../common/testutil/types'
import {
  signDeployAccount,
  signRelayedAccessUpdateBatch,
  signRelayedSignerUpdate,
  signRelayedTake,
} from '../../helpers/CollateralAccounts/eip712'
import {
  Account__factory,
  AccountVerifier__factory,
  AggregatorV3Interface,
  ArbGasInfo,
  Controller_Arbitrum__factory,
  Controller_Incentivized,
  IAccount,
  IAccount__factory,
  IAccountVerifier,
  IERC20,
  IEmptySetReserve,
} from '../../../types/generated'
import {
  RelayedTakeStruct,
  RelayedSignerUpdateStruct,
} from '../../../types/generated/contracts/CollateralAccounts/AccountVerifier'
const { ethers } = HRE

const COMMON_PROTOTYPE = '(address,address,address,uint256,uint256,uint256)'
const KEEP_CONFIG = '(uint256,uint256,uint256,uint256)'
const MARKET_UPDATE_TAKE_PROTOTYPE = `update((int256,address,${COMMON_PROTOTYPE}),bytes)`

describe('Controller_Incentivized', () => {
  let controller: Controller_Incentivized
  let marketFactory: FakeContract<IMarketFactory>
  let marketVerifier: FakeContract<IVerifier>
  let dsu: FakeContract<IERC20>
  let verifier: IAccountVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let relayer: SignerWithAddress
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
        ...(await createCommon(userAddress, signerAddress, controller.address, expiresInSeconds)),
      },
    }
  }

  async function createCommon(
    userAddress: Address,
    signerAddress = userAddress,
    domainAdress = controller.address,
    expiresInSeconds = 6,
  ) {
    return {
      common: {
        account: userAddress,
        signer: signerAddress,
        domain: domainAdress,
        nonce: nextNonce(),
        group: 0,
        expiry: (await currentBlockTimestamp()) + expiresInSeconds,
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
    ;[owner, userA, userB, userC, relayer] = await ethers.getSigners()
    const usdc = await smock.fake<IERC20>('IERC20')
    dsu = await smock.fake<IERC20>('IERC20')
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
      // create a collateral account for the taker to pay the relayer
      await createCollateralAccount(userA)
      // create a market in which taker position should be adjusted
      const market = await smock.fake<IMarket>('IMarket')

      // taker (userA) creates and signs the inner message
      const take: Take = {
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

      // userB creates and signs the outer message
      const relayTake: RelayedTakeStruct = {
        take: take,
        ...(await createAction(userB.address)),
      }
      const outerSignature = await signRelayedTake(userB, verifier, relayTake)
      // note the userB has no collateral account; relayer is paid from userA's collateral account

      // relayer relays the message
      expect(await controller.connect(relayer).relayTake(relayTake, outerSignature, innerSignature)).to.not.be.reverted
      const actualTake = market[MARKET_UPDATE_TAKE_PROTOTYPE].getCall(0).args[0] as Take
      expectTakeEq(actualTake, take)
      expect(market[MARKET_UPDATE_TAKE_PROTOTYPE].getCall(0).args[1]).to.equal(innerSignature)
    })

    it('reverts if outer message signature is invalid', async () => {
      // taker (userA) creates and signs the inner message
      const market = await smock.fake<IMarket>('IMarket')
      const take: Take = {
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

      // relayer creates and signs an outer message to have userB pay for the update
      const relayTake: RelayedTakeStruct = {
        take: take,
        ...(await createAction(userB.address)),
      }
      const outerSignature = await signRelayedTake(relayer, verifier, relayTake)

      // but relayer is not an authorized signer for userB
      await expect(
        controller.connect(relayer).relayTake(relayTake, outerSignature, innerSignature),
      ).to.be.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')
    })

    it('relays a signer update message wrapped be a third party', async () => {
      // userA signs a message to approve userB as a designated signer
      const signerUpdate = {
        access: {
          accessor: userC.address,
          approved: true,
        },
        ...(await createCommon(userA.address, userA.address, marketFactory.address)),
      }
      const innerSignature = await signSignerUpdate(userA, marketVerifier, signerUpdate)

      // userB wraps the message and will pay the relayer
      await createCollateralAccount(userB)
      const relaySignerUpdate: RelayedSignerUpdateStruct = {
        signerUpdate: signerUpdate,
        ...(await createAction(userB.address)),
      }
      const outerSignature = await signRelayedSignerUpdate(userB, verifier, relaySignerUpdate)

      // relayer performs the action
      expect(await controller.connect(relayer).relaySignerUpdate(relaySignerUpdate, outerSignature, innerSignature)).to
        .not.be.reverted
      const actualSignerUpdate = marketFactory.updateSignerWithSignature.getCall(0).args[0] as SignerUpdate
      expectSignerUpdateEq(actualSignerUpdate, signerUpdate)
      expect(marketFactory.updateSignerWithSignature.getCall(0).args[1]).to.equal(innerSignature)
    })

    it('relays a self-wrapped batch access update', async () => {
      // userA signs a message to approve userB and userC as operators
      const accessUpdateBatch = {
        operators: [
          { accessor: userB.address, approved: true },
          { accessor: userC.address, approved: true },
        ],
        signers: [],
        ...(await createCommon(userA.address, userA.address, marketFactory.address)),
      }
      const innerSignature = await signAccessUpdateBatch(userA, marketVerifier, accessUpdateBatch)

      // userA wraps the message and will pay the relayer themselves
      await createCollateralAccount(userA)
      const relayedAccessUpdateBatchMessage = {
        accessUpdateBatch: accessUpdateBatch,
        ...(await createAction(userA.address)),
      }
      const outerSignature = await signRelayedAccessUpdateBatch(userA, verifier, relayedAccessUpdateBatchMessage)

      // relayer performs the action
      expect(
        await controller
          .connect(relayer)
          .relayAccessUpdateBatch(relayedAccessUpdateBatchMessage, outerSignature, innerSignature),
      ).to.not.be.reverted
      const actualAccessUpdateBatch = marketFactory.updateAccessBatchWithSignature.getCall(0)
        .args[0] as AccessUpdateBatch
      expectAccessUpdateBatchEq(actualAccessUpdateBatch, accessUpdateBatch)
      expect(marketFactory.updateAccessBatchWithSignature.getCall(0).args[1]).to.equal(innerSignature)
    })
  })
})
