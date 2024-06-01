import { expect } from 'chai'
import HRE from 'hardhat'
import { Address } from 'hardhat-deploy/dist/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { BigNumber, constants, utils } from 'ethers'
import {
  Controller,
  IAccount,
  IAccount__factory,
  IController,
  IERC20,
  IERC20Metadata,
  IEmptySetReserve,
  IVerifier,
  Verifier__factory,
} from '../../types/generated'
// import { RebalanceConfigChangeStruct, RebalanceConfigStruct } from '../../types/generated/contracts/Controller'
import { signDeployAccount, signMarketTransfer, signRebalanceConfigChange, signSignerUpdate } from '../helpers/erc712'
import { impersonate } from '../../../common/testutil'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { deployController, getEventArguments, mockMarket } from '../helpers/setupHelpers'
import { parse6decimal } from '../../../common/testutil/types'
import { IMarket } from '@equilibria/perennial-v2-oracle/types/generated'

const { ethers } = HRE

describe('Controller', () => {
  let controller: Controller
  let verifier: IVerifier
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let lastNonce = 0
  let currentTime: BigNumber

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(userAddress: Address, maxFee = utils.parseEther('0.3'), expiresInSeconds = 12) {
    return {
      action: {
        maxFee: maxFee,
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

  // deploys a collateral account for the specified user and returns the address
  async function createCollateralAccount(user: SignerWithAddress): Promise<IAccount> {
    const deployAccountMessage = {
      ...createAction(user.address),
    }
    const signatureCreate = await signDeployAccount(user, verifier, deployAccountMessage)
    const tx = await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signatureCreate)
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
    ;[owner, userA, userB, keeper] = await ethers.getSigners()
    controller = await deployController(owner)
    verifier = await new Verifier__factory(owner).deploy()

    const usdc = await smock.fake<IERC20>('IERC20')
    const dsu = await smock.fake<IERC20>('IERC20')
    const reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    await controller.initialize(verifier.address, usdc.address, dsu.address, reserve.address)
  }

  beforeEach(async () => {
    await loadFixture(fixture)
    currentTime = BigNumber.from(await currentBlockTimestamp())
  })

  describe('#creation', () => {
    it('calculates unique addresses', async () => {
      const accountAddressA = await controller.getAccountAddress(userA.address)
      expect(accountAddressA).to.not.equal(userA.address)

      const accountAddressB = await controller.getAccountAddress(userB.address)
      expect(accountAddressB).to.not.equal(accountAddressA)
    })

    it('created address matches calculated address', async () => {
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)

      const accountAddressActual = await controller.connect(userA).callStatic.deployAccount()
      await expect(controller.connect(userA).deployAccount())
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)

      expect(accountAddressCalculated).to.equal(accountAddressActual)
    })

    it('creates collateral accounts from a signed message', async () => {
      const deployAccountMessage = {
        ...createAction(userA.address),
      }
      const signature = await signDeployAccount(userA, verifier, deployAccountMessage)

      // deploy and confirm address of the account matches calculated expectation
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)
      await expect(controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature))
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)
    })

    it('creates collateral accounts from a delegated signer', async () => {
      // delegate userB to sign for userA
      await controller.connect(userA).updateSigner(userB.address, true)

      // create a message to create collateral account for userA but sign it as userB
      const deployAccountMessage = {
        ...createAction(userA.address),
      }
      const signature = await signDeployAccount(userB, verifier, deployAccountMessage)

      // create the account
      const accountAddressCalculated = await controller.getAccountAddress(userA.address)
      await expect(controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature))
        .to.emit(controller, 'AccountDeployed')
        .withArgs(userA.address, accountAddressCalculated)
    })

    it('third party cannot create account on owners behalf', async () => {
      // create a message to create collateral account for userA but sign it as userB
      const deployAccountMessage = {
        ...createAction(userA.address),
      }
      const signature = await signDeployAccount(userB, verifier, deployAccountMessage)

      await expect(
        controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'ControllerInvalidSigner')
    })
  })

  describe('#delegation', () => {
    let accountAddressA: Address

    before(async () => {
      accountAddressA = await controller.getAccountAddress(userA.address)
    })

    it('can assign and disable a delegate', async () => {
      // validate initial state
      expect(await controller.signers(accountAddressA, userB.address)).to.be.false

      // userA assigns userB as delegated signer for their collateral account
      await expect(controller.connect(userA).updateSigner(userB.address, true))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // no-op update should neither revert nor change state
      await expect(controller.connect(userA).updateSigner(userB.address, true))
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // userA disables userB's delegatation rights
      await expect(controller.connect(userA).updateSigner(userB.address, false))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, false)
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // no-op update should neither revert nor change state
      await expect(controller.connect(userA).updateSigner(userB.address, false))
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // userA re-enables userB's delegation rights
      await expect(controller.connect(userA).updateSigner(userB.address, true))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true
    })

    it('can assign a delegate from a signed message', async () => {
      // validate initial state
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...createAction(userA.address),
      }
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)

      // assign the delegate
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true
    })

    it('cannot assign a delegate from an unauthorized signer', async () => {
      // validate initial state
      expect(await controller.signers(userA.address, userB.address)).to.be.false

      // userB signs a message granting them delegation rights to userA's collateral account
      const updateSignerMessage = {
        signer: userB.address,
        approved: true,
        ...createAction(userA.address),
      }
      const signature = await signSignerUpdate(userB, verifier, updateSignerMessage)

      // ensure message verification fails
      const controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))
      const signerResult = await verifier
        .connect(controllerSigner)
        .callStatic.verifySignerUpdate(updateSignerMessage, signature)
      expect(signerResult).to.not.eq(userA.address)

      // ensure assignment fails
      await expect(
        controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'ControllerInvalidSigner')
    })

    it('cannot disable a delegate from an unauthorized signer', async () => {
      // userA assigns userB as delegated signer for their collateral account
      await expect(controller.connect(userA).updateSigner(userB.address, true))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // keeper signs a message disabling userB's delegation rights to userA's collateral account
      const updateSignerMessage = {
        signer: userB.address,
        approved: false,
        ...createAction(userA.address),
      }
      const signature = await signSignerUpdate(keeper, verifier, updateSignerMessage)

      // ensure update fails
      await expect(
        controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'ControllerInvalidSigner')
    })

    it('can disable a delegate from a signed message', async () => {
      // set up initial state
      await controller.connect(userA).updateSigner(userB.address, true)
      expect(await controller.signers(userA.address, userB.address)).to.be.true

      // userA signs a message assigning userB's delegation rights
      const updateSignerMessage = {
        signer: userB.address,
        approved: false,
        ...createAction(userA.address),
      }
      const signature = await signSignerUpdate(userA, verifier, updateSignerMessage)

      // disable the delegate
      await expect(controller.connect(keeper).updateSignerWithSignature(updateSignerMessage, signature))
        .to.emit(controller, 'SignerUpdated')
        .withArgs(userA.address, userB.address, false)
      expect(await controller.signers(userA.address, userB.address)).to.be.false
    })
  })

  describe('#rebalance', () => {
    let btcMarket: FakeContract<IMarket>
    let ethMarket: FakeContract<IMarket>

    beforeEach(async () => {
      btcMarket = await smock.fake('IMarket')
      ethMarket = await smock.fake('IMarket')
    })

    // helper which creates a new rebalance group and returns the group number
    async function createGroup(markets: Array<Address>, configs: Array<RebalanceConfigStruct>): Promise<number> {
      const message = {
        group: constants.Zero,
        markets: markets,
        configs: configs,
        ...createAction(userA.address),
      }
      const signature = await signRebalanceConfigChange(userA, verifier, message)
      const tx = await controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature)
      const eventArgs = await getEventArguments(tx, 'RebalanceGroupConfigured')
      return eventArgs.group
    }

    // TODO: eliminate group argument?
    async function verifyConfigAgainstMessage(
      user: SignerWithAddress,
      message: RebalanceConfigChangeStruct,
      group: number,
    ) {
      for (let i = 0; i < message.markets.length; ++i) {
        const marketAddress = message.markets[i]
        const config = await controller.rebalanceConfig(user.address, group, marketAddress)
        expect(config.target).to.equal(message.configs[i].target)
        expect(config.threshold).to.equal(message.configs[i].threshold)
      }
    }

    context('new group', async () => {
      it('can configure a new group', async () => {
        // sign message to create a new group
        const message = {
          group: constants.Zero,
          markets: [btcMarket.address, ethMarket.address],
          configs: [
            { target: parse6decimal('0.53'), threshold: parse6decimal('0.037') },
            { target: parse6decimal('0.47'), threshold: parse6decimal('0.036') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        // create the group
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature))
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, 1, btcMarket.address, message.configs[0])
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, 1, ethMarket.address, message.configs[1])
          .to.emit(controller, 'RebalanceGroupConfigured')
          .withArgs(userA.address, 1)

        await verifyConfigAgainstMessage(userA, message, 1)
      })

      it('rejects messages with mismatching array length', async () => {
        // sign invalid message
        let message = {
          group: constants.Zero,
          markets: [btcMarket.address, ethMarket.address],
          configs: [{ target: parse6decimal('0.51'), threshold: parse6decimal('0.04') }],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        // panic occurs during message verification
        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithPanic(0x32) // Array accessed at an out-of-bounds or negative index

        message = {
          group: constants.Zero,
          markets: [btcMarket.address],
          configs: [
            { target: parse6decimal('0.51'), threshold: parse6decimal('0.04') },
            { target: parse6decimal('0.49'), threshold: parse6decimal('0.04') },
          ],
          ...createAction(userA.address),
        }

        // await controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature)
        // FIXME: reason is misleading; might want to implicitly induce the same panic with a length check
        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithCustomError(controller, 'ControllerInvalidSigner')
      })

      it('rejects groups where targets do not add to 100%', async () => {
        // sign message with invalid configuration
        const message = {
          group: constants.Zero,
          markets: [btcMarket.address, ethMarket.address],
          configs: [
            { target: parse6decimal('0.51'), threshold: parse6decimal('0.04') },
            { target: parse6decimal('0.52'), threshold: parse6decimal('0.04') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithCustomError(controller, 'ControllerInvalidRebalanceTargets')
      })

      it('prevents markets from being added to multiple groups', async () => {
        // create a group with BTC and ETH markets
        let message = {
          group: constants.Zero,
          markets: [btcMarket.address, ethMarket.address],
          configs: [
            { target: parse6decimal('0.50'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.50'), threshold: parse6decimal('0.05') },
          ],
          ...createAction(userA.address),
        }
        let signature = await signRebalanceConfigChange(userA, verifier, message)
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature))
          .to.emit(controller, 'RebalanceGroupConfigured')
          .withArgs(userA.address, 1)

        // attempt to create a group with BTC and SOL markets
        const solMarket = await smock.fake('IMarket')
        message = {
          group: constants.Zero,
          markets: [btcMarket.address, solMarket.address],
          configs: [
            { target: parse6decimal('0.50'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.50'), threshold: parse6decimal('0.05') },
          ],
          ...createAction(userA.address),
        }
        signature = await signRebalanceConfigChange(userA, verifier, message)
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature))
          .to.be.revertedWithCustomError(controller, 'ControllerMarketAlreadyInGroup')
          .withArgs(btcMarket.address, 1)
      })

      it('rejects groups with duplicate markets when creating a new group', async () => {
        // sign message with invalid configuration
        const message = {
          group: constants.Zero,
          markets: [btcMarket.address, ethMarket.address, btcMarket.address],
          configs: [
            { target: parse6decimal('0.33'), threshold: parse6decimal('0.04') },
            { target: parse6decimal('0.34'), threshold: parse6decimal('0.04') },
            { target: parse6decimal('0.33'), threshold: parse6decimal('0.04') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithCustomError(controller, 'ControllerMarketAlreadyInGroup')
      })

      it('prevents owner from making up their own group number', async () => {
        // attempt to update a group which does not already exist
        const message = {
          group: 32,
          markets: [ethMarket.address],
          configs: [{ target: parse6decimal('0.50'), threshold: parse6decimal('0.05') }],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)
        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithCustomError(controller, 'ControllerInvalidRebalanceGroup')
      })
    })

    context('update group', async () => {
      let group: number

      beforeEach(async () => {
        group = await createGroup(
          [btcMarket.address, ethMarket.address],
          [
            { target: parse6decimal('0.5'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.5'), threshold: parse6decimal('0.05') },
          ],
        )
        expect(group).to.equal(1)
      })

      it('can update an existing group', async () => {
        // sign message to change the parameters
        const message = {
          group: group,
          markets: [btcMarket.address, ethMarket.address],
          configs: [
            { target: parse6decimal('0.51'), threshold: parse6decimal('0.042') },
            { target: parse6decimal('0.49'), threshold: parse6decimal('0.043') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        // perform the update
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature))
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, group, btcMarket.address, message.configs[0])
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, group, ethMarket.address, message.configs[1])
          .to.emit(controller, 'RebalanceGroupConfigured')
          .withArgs(userA.address, group)

        await verifyConfigAgainstMessage(userA, message, group)
      })

      it('can add a market', async () => {
        const solMarket = await smock.fake('IMarket')

        // sign message to add a market
        const message = {
          group: group,
          markets: [btcMarket.address, ethMarket.address, solMarket.address],
          configs: [
            { target: parse6decimal('0.333'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.334'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.333'), threshold: parse6decimal('0.05') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        // perform the update
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature))
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, group, btcMarket.address, message.configs[0])
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, group, ethMarket.address, message.configs[1])
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, group, solMarket.address, message.configs[2])
          .to.emit(controller, 'RebalanceGroupConfigured')
          .withArgs(userA.address, group)

        await verifyConfigAgainstMessage(userA, message, group)
      })

      it('can remove a market', async () => {
        // sign message to remove a market
        const message = {
          group: group,
          markets: [ethMarket.address],
          configs: [{ target: parse6decimal('1'), threshold: parse6decimal('0.05') }],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        // perform the update
        await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature))
          .to.emit(controller, 'RebalanceMarketConfigured')
          .withArgs(userA.address, group, ethMarket.address, message.configs[0])
          .to.emit(controller, 'RebalanceGroupConfigured')
          .withArgs(userA.address, group)

        await verifyConfigAgainstMessage(userA, message, group)
      })

      it('rejects groups with duplicate markets when updating a group', async () => {
        // sign message to change the parameters
        const message = {
          group: group,
          markets: [btcMarket.address, ethMarket.address, btcMarket.address],
          configs: [
            { target: parse6decimal('0.333'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.334'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.333'), threshold: parse6decimal('0.05') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        // perform the update
        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithCustomError(controller, 'ControllerMarketAlreadyInGroup')
      })

      it('rejects updating a market with a market which exists in another group', async () => {
        // test setup offers a BTC,ETH group
        const btcEthGroup = group

        // create a SOL,MATIC group
        const solMarket = await smock.fake('IMarket')
        const maticMarket = await smock.fake('IMarket')
        const solMaticGroup = await createGroup(
          [solMarket.address, maticMarket.address],
          [
            { target: parse6decimal('0.5'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.5'), threshold: parse6decimal('0.05') },
          ],
        )
        expect(solMaticGroup).to.equal(2)

        // try to modifiy the latter to add ETH
        const message = {
          group: group,
          markets: [solMarket.address, maticMarket.address, ethMarket.address],
          configs: [
            { target: parse6decimal('0.333'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.334'), threshold: parse6decimal('0.05') },
            { target: parse6decimal('0.333'), threshold: parse6decimal('0.05') },
          ],
          ...createAction(userA.address),
        }
        const signature = await signRebalanceConfigChange(userA, verifier, message)

        await expect(
          controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature),
        ).to.be.revertedWithCustomError(controller, 'ControllerMarketAlreadyInGroup')
      })
    })

    // TODO: delete a group
  })

  describe('#transfer', () => {
    it('reverts attempting to transfer to a non-DSU market', async () => {
      // create a market with a non-DSU collateral token
      const weth = await smock.fake<IERC20Metadata>('IERC20Metadata')
      const market = await mockMarket(weth.address)

      // create a collateral account
      createCollateralAccount(userA)

      // attempt a market transfer to the unsupported market
      const marketTransferMessage = {
        market: market.address,
        amount: utils.parseEther('4'),
        ...createAction(userA.address, utils.parseEther('0.3'), 24),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'ControllerUnsupportedMarket')
    })
  })
})
