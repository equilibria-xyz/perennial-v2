import { smock, FakeContract } from '@defi-wonderland/smock'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  MarketFactory,
  Market,
  MarketFactory__factory,
  Market__factory,
  IOracleProvider,
  IERC20Metadata,
  IFactory,
  CheckpointLib__factory,
  InvariantLib__factory,
  VersionLib__factory,
  CheckpointStorageLib__factory,
  MarketParameterStorageLib__factory,
  GlobalStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  GuaranteeStorageLocalLib__factory,
  GuaranteeStorageGlobalLib__factory,
  OrderStorageLocalLib__factory,
  OrderStorageGlobalLib__factory,
  VersionStorageLib__factory,
  IVerifier,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { constants } from 'ethers'
import { signAccessUpdateBatch, signOperatorUpdate, signSignerUpdate } from '../../helpers/erc712'

const { ethers } = HRE

describe('MarketFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let signer: SignerWithAddress
  let operator: SignerWithAddress
  let signer2: SignerWithAddress
  let operator2: SignerWithAddress
  let extension: SignerWithAddress
  let referrer: SignerWithAddress
  let oracleFactory: FakeContract<IFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>
  let verifier: FakeContract<IVerifier>

  let factory: MarketFactory
  let marketImpl: Market

  const fixture = async () => {
    ;[user, owner, signer, signer2, operator, operator2, extension, referrer] = await ethers.getSigners()
    oracleFactory = await smock.fake<IFactory>('IFactory')
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    verifier = await smock.fake<IVerifier>('IVerifier')
    marketImpl = await new Market__factory(
      {
        'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
        'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
        'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
        'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
          await new CheckpointStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Global.sol:GlobalStorageLib': (await new GlobalStorageLib__factory(owner).deploy()).address,
        'contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
          await new MarketParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageGlobalLib': (
          await new PositionStorageGlobalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageLocalLib': (
          await new PositionStorageLocalLib__factory(owner).deploy()
        ).address,
        'contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
          await new RiskParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Version.sol:VersionStorageLib': (await new VersionStorageLib__factory(owner).deploy()).address,
        'contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': (
          await new GuaranteeStorageLocalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': (
          await new GuaranteeStorageGlobalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Order.sol:OrderStorageLocalLib': (
          await new OrderStorageLocalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Order.sol:OrderStorageGlobalLib': (
          await new OrderStorageGlobalLib__factory(owner).deploy()
        ).address,
      },
      owner,
    ).deploy(verifier.address)
    factory = await new MarketFactory__factory(owner).deploy(
      oracleFactory.address,
      verifier.address,
      marketImpl.address,
    )
    await factory.initialize()
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await factory.implementation()).to.equal(marketImpl.address)
      expect(await factory.owner()).to.equal(owner.address)
      expect(await factory.pauser()).to.equal(constants.AddressZero)

      expect(await factory.oracleFactory()).to.equal(oracleFactory.address)
      expect(await factory.verifier()).to.equal(verifier.address)

      const parameter = await factory.parameter()
      expect(parameter.maxFee).to.equal(0)
      expect(parameter.maxLiquidationFee).to.equal(0)
      expect(parameter.maxCut).to.equal(0)
      expect(parameter.maxRate).to.equal(0)
      expect(parameter.minMaintenance).to.equal(0)
      expect(parameter.minEfficiency).to.equal(0)
      expect(parameter.referralFee).to.equal(0)
      expect(parameter.minScale).to.equal(0)
    })

    it('reverts if already initialized', async () => {
      await expect(factory.initialize())
        .to.be.revertedWithCustomError(factory, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#create', async () => {
    it('creates the market', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      const marketAddress = await factory.callStatic.create(marketDefinition)
      await expect(factory.connect(owner).create(marketDefinition))
        .to.emit(factory, 'InstanceRegistered')
        .withArgs(marketAddress)
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
      expect(await factory.markets(oracle.address)).to.be.equal(marketAddress)
    })

    it('creates the market w/ zero payoff', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      const marketAddress = await factory.callStatic.create(marketDefinition)
      await expect(factory.connect(owner).create(marketDefinition))
        .to.emit(factory, 'InstanceRegistered')
        .withArgs(marketAddress)
        .to.emit(factory, 'MarketCreated')
        .withArgs(marketAddress, marketDefinition)

      const market = Market__factory.connect(marketAddress, owner)
      expect(await market.factory()).to.equal(factory.address)
    })

    it('reverts when invalid oracle', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(false)

      await expect(factory.connect(owner).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'FactoryInvalidOracleError',
      )
    })

    it('reverts when already registered', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      await factory.connect(owner).create(marketDefinition)

      await expect(factory.connect(owner).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'FactoryAlreadyRegisteredError',
      )
    })

    it('reverts when not owner', async () => {
      const marketDefinition = {
        token: dsu.address,
        oracle: oracle.address,
      }

      oracleFactory.instances.whenCalledWith(oracle.address).returns(true)

      await expect(factory.connect(user).create(marketDefinition)).to.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#authorization', async () => {
    it('sender is account', async () => {
      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        user.address,
        constants.AddressZero,
        constants.AddressZero,
      )

      expect(isOperator).to.be.equal(true)
      expect(isSigner).to.be.equal(false)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })

    it('sender is extension', async () => {
      await factory.updateExtension(extension.address, true)

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        extension.address,
        constants.AddressZero,
        constants.AddressZero,
      )

      expect(isOperator).to.be.equal(true)
      expect(isSigner).to.be.equal(false)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })

    it('sender is signer', async () => {
      await factory.connect(user).updateSigner(signer.address, true)

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        constants.AddressZero,
        signer.address,
        constants.AddressZero,
      )

      expect(isOperator).to.be.equal(false)
      expect(isSigner).to.be.equal(true)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })

    it('sender is none', async () => {
      await factory.connect(user).updateSigner(signer.address, true)

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
      )

      expect(isOperator).to.be.equal(false)
      expect(isSigner).to.be.equal(false)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })

    it('referrerFee is zero', async () => {
      await factory.updateReferralFee(referrer.address, parse6decimal('0'))

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        user.address,
        constants.AddressZero,
        referrer.address,
      )

      expect(isOperator).to.be.equal(true)
      expect(isSigner).to.be.equal(false)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })

    it('referrerFee is non-zero', async () => {
      await factory.updateReferralFee(referrer.address, parse6decimal('0.35'))

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        user.address,
        constants.AddressZero,
        referrer.address,
      )

      expect(isOperator).to.be.equal(true)
      expect(isSigner).to.be.equal(false)
      expect(orderReferralFee).to.be.equal(parse6decimal('0.35'))
    })

    it('account is signer', async () => {
      await factory.updateExtension(extension.address, true)

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        extension.address,
        user.address,
        constants.AddressZero,
      )

      expect(isOperator).to.be.equal(true)
      expect(isSigner).to.be.equal(true)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })

    it('sender is operator', async () => {
      await factory.connect(user).updateOperator(extension.address, true)

      const [isOperator, isSigner, orderReferralFee] = await factory.authorization(
        user.address,
        extension.address,
        user.address,
        constants.AddressZero,
      )

      expect(isOperator).to.be.equal(true)
      expect(isSigner).to.be.equal(true)
      expect(orderReferralFee).to.be.equal(parse6decimal('0'))
    })
  })

  describe('#updateParameter', async () => {
    const newParameter = {
      maxFee: parse6decimal('0.01'),
      maxLiquidationFee: parse6decimal('20'),
      maxCut: parse6decimal('0.50'),
      maxRate: parse6decimal('10.00'),
      minMaintenance: parse6decimal('0.01'),
      minEfficiency: parse6decimal('0.1'),
      referralFee: parse6decimal('0.2'),
      minScale: parse6decimal('0.001'),
      maxStaleAfter: 3600,
    }

    it('updates the parameters', async () => {
      await expect(factory.updateParameter(newParameter)).to.emit(factory, 'ParameterUpdated').withArgs(newParameter)

      const parameter = await factory.parameter()
      expect(parameter.maxFee).to.equal(newParameter.maxFee)
      expect(parameter.maxLiquidationFee).to.equal(newParameter.maxLiquidationFee)
      expect(parameter.maxCut).to.equal(newParameter.maxCut)
      expect(parameter.maxRate).to.equal(newParameter.maxRate)
      expect(parameter.minMaintenance).to.equal(newParameter.minMaintenance)
      expect(parameter.minEfficiency).to.equal(newParameter.minEfficiency)
      expect(parameter.referralFee).to.equal(newParameter.referralFee)
      expect(parameter.minScale).to.equal(newParameter.minScale)
      expect(parameter.maxStaleAfter).to.equal(newParameter.maxStaleAfter)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateParameter(newParameter)).to.be.revertedWithCustomError(
        factory,
        'OwnableNotOwnerError',
      )
    })
  })

  describe('#updateReferralFee', async () => {
    const newParameter = {
      maxFee: parse6decimal('0.01'),
      maxLiquidationFee: parse6decimal('20'),
      maxCut: parse6decimal('0.50'),
      maxRate: parse6decimal('10.00'),
      minMaintenance: parse6decimal('0.01'),
      minEfficiency: parse6decimal('0.1'),
      referralFee: parse6decimal('0.2'),
      minScale: parse6decimal('0.001'),
    }

    it('updates the parameters', async () => {
      await expect(factory.updateReferralFee(user.address, parse6decimal('0.3')))
        .to.emit(factory, 'ReferralFeeUpdated')
        .withArgs(user.address, parse6decimal('0.3'))

      expect(await factory.referralFees(user.address)).to.equal(parse6decimal('0.3'))
    })

    it('reverts if not owner', async () => {
      await expect(
        factory.connect(user).updateReferralFee(user.address, parse6decimal('0.3')),
      ).to.be.revertedWithCustomError(factory, 'OwnableNotOwnerError')
    })

    it('reverts if too highr', async () => {
      await expect(factory.updateReferralFee(user.address, parse6decimal('2.3'))).to.be.revertedWithCustomError(
        factory,
        'MarketFactoryInvalidReferralFeeError',
      )
    })
  })

  describe('#updateExtension', async () => {
    it('updates the operator status', async () => {
      await expect(factory.connect(owner).updateExtension(owner.address, true))
        .to.emit(factory, 'ExtensionUpdated')
        .withArgs(owner.address, true)

      expect(await factory.extensions(owner.address)).to.equal(true)

      await expect(factory.connect(owner).updateExtension(owner.address, false))
        .to.emit(factory, 'ExtensionUpdated')
        .withArgs(owner.address, false)

      expect(await factory.extensions(owner.address)).to.equal(false)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).updateExtension(user.address, true))
        .to.be.revertedWithCustomError(factory, 'OwnableNotOwnerError')
        .withArgs(user.address)
    })
  })

  describe('#updateOperator', async () => {
    it('updates the operator status', async () => {
      await expect(factory.connect(user).updateOperator(owner.address, true))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, owner.address, true)

      expect(await factory.operators(user.address, owner.address)).to.equal(true)

      await expect(factory.connect(user).updateOperator(owner.address, false))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, owner.address, false)

      expect(await factory.operators(user.address, owner.address)).to.equal(false)
    })
  })

  describe('#updateOperatorWithSignature', async () => {
    const DEFAULT_OPERATOR_UPDATE = {
      access: {
        accessor: constants.AddressZero,
        approved: false,
      },
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('updates the operator status', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: user.address,
          signer: user.address,
          domain: factory.address,
        },
      }
      const signature = await signOperatorUpdate(user, verifier, operatorUpdate)

      verifier.verifyOperatorUpdate.returns()

      await expect(factory.connect(owner).updateOperatorWithSignature(operatorUpdate, signature))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, owner.address, true)

      expect(await factory.operators(user.address, owner.address)).to.equal(true)

      const operatorUpdate2 = {
        ...DEFAULT_OPERATOR_UPDATE,
        access: {
          accessor: owner.address,
          approved: false,
        },
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: user.address,
          signer: user.address,
          domain: factory.address,
          nonce: 1,
        },
      }
      const signature2 = await signOperatorUpdate(user, verifier, operatorUpdate2)

      verifier.verifyOperatorUpdate.returns()

      await expect(factory.connect(owner).updateOperatorWithSignature(operatorUpdate2, signature2))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, owner.address, false)

      expect(await factory.operators(user.address, owner.address)).to.equal(false)
    })

    it('reverts if signer does not match', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: user.address,
          signer: owner.address,
          domain: factory.address,
        },
      }
      const signature = await signOperatorUpdate(user, verifier, operatorUpdate)

      verifier.verifyOperatorUpdate.returns()

      await expect(
        factory.connect(owner).updateOperatorWithSignature(operatorUpdate, signature),
      ).to.revertedWithCustomError(factory, 'MarketFactoryInvalidSignerError')
    })
  })

  describe('#updateSigner', async () => {
    it('updates the signer status', async () => {
      await expect(factory.connect(user).updateSigner(owner.address, true))
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, owner.address, true)

      expect(await factory.signers(user.address, owner.address)).to.equal(true)

      await expect(factory.connect(user).updateSigner(owner.address, false))
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, owner.address, false)

      expect(await factory.signers(user.address, owner.address)).to.equal(false)
    })
  })

  describe('#updateSignerWithSignature', async () => {
    const DEFAULT_SIGNER_UPDATE = {
      access: {
        accessor: constants.AddressZero,
        approved: false,
      },
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('updates the signer status', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: user.address,
          signer: user.address,
          domain: factory.address,
        },
      }
      const signature = await signSignerUpdate(user, verifier, signerUpdate)

      verifier.verifySignerUpdate.returns()

      await expect(factory.connect(owner).updateSignerWithSignature(signerUpdate, signature))
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, owner.address, true)

      expect(await factory.signers(user.address, owner.address)).to.equal(true)

      const signerUpdate2 = {
        ...DEFAULT_SIGNER_UPDATE,
        access: {
          accessor: owner.address,
          approved: false,
        },
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: user.address,
          signer: user.address,
          domain: factory.address,
          nonce: 1,
        },
      }
      const signature2 = await signSignerUpdate(user, verifier, signerUpdate2)

      verifier.verifySignerUpdate.returns()

      await expect(factory.connect(owner).updateSignerWithSignature(signerUpdate2, signature2))
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, owner.address, false)

      expect(await factory.signers(user.address, owner.address)).to.equal(false)
    })

    it('reverts if signer does not match', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: user.address,
          signer: owner.address,
          domain: factory.address,
        },
      }
      const signature = await signSignerUpdate(user, verifier, signerUpdate)

      verifier.verifySignerUpdate.returns()

      await expect(
        factory.connect(owner).updateSignerWithSignature(signerUpdate, signature),
      ).to.revertedWithCustomError(factory, 'MarketFactoryInvalidSignerError')
    })
  })

  describe('#updateAccessBatch', async () => {
    it('updates the operator and signer status', async () => {
      await expect(
        factory.connect(user).updateAccessBatch(
          [
            { accessor: operator.address, approved: true },
            { accessor: operator2.address, approved: true },
          ],
          [
            { accessor: signer.address, approved: true },
            { accessor: signer2.address, approved: true },
          ],
        ),
      )
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator.address, true)
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator2.address, true)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer.address, true)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer2.address, true)

      expect(await factory.operators(user.address, operator.address)).to.equal(true)
      expect(await factory.operators(user.address, operator2.address)).to.equal(true)
      expect(await factory.signers(user.address, signer.address)).to.equal(true)
      expect(await factory.signers(user.address, signer2.address)).to.equal(true)

      await expect(
        factory.connect(user).updateAccessBatch(
          [
            { accessor: operator.address, approved: false },
            { accessor: operator2.address, approved: false },
          ],
          [
            { accessor: signer.address, approved: false },
            { accessor: signer2.address, approved: false },
          ],
        ),
      )
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator.address, false)
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator2.address, false)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer.address, false)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer2.address, false)

      expect(await factory.operators(user.address, operator.address)).to.equal(false)
      expect(await factory.operators(user.address, operator2.address)).to.equal(false)
      expect(await factory.signers(user.address, signer.address)).to.equal(false)
      expect(await factory.signers(user.address, signer2.address)).to.equal(false)
    })
  })

  describe('#updateAccessBatchSignature', async () => {
    const DEFAULT_ACCESS_UPDATE_BATCH = {
      operators: [{ accessor: constants.AddressZero, approved: false }],
      signers: [{ accessor: constants.AddressZero, approved: false }],
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('updates the signer status', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        operators: [
          { accessor: operator.address, approved: true },
          { accessor: operator2.address, approved: true },
        ],
        signers: [
          { accessor: signer.address, approved: true },
          { accessor: signer2.address, approved: true },
        ],
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: user.address,
          signer: user.address,
          domain: factory.address,
        },
      }
      const signature = await signAccessUpdateBatch(user, verifier, accessUpdateBatch)

      verifier.verifyAccessUpdateBatch.returns()

      await expect(factory.connect(owner).updateAccessBatchWithSignature(accessUpdateBatch, signature))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator.address, true)
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator2.address, true)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer.address, true)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer2.address, true)

      expect(await factory.operators(user.address, operator.address)).to.equal(true)
      expect(await factory.operators(user.address, operator2.address)).to.equal(true)
      expect(await factory.signers(user.address, signer.address)).to.equal(true)
      expect(await factory.signers(user.address, signer.address)).to.equal(true)

      const accessUpdateBatch2 = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        operators: [
          { accessor: operator.address, approved: false },
          { accessor: operator2.address, approved: false },
        ],
        signers: [
          { accessor: signer.address, approved: false },
          { accessor: signer2.address, approved: false },
        ],
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: user.address,
          signer: user.address,
          domain: factory.address,
          nonce: 1,
        },
      }
      const signature2 = await signAccessUpdateBatch(user, verifier, accessUpdateBatch2)

      verifier.verifyAccessUpdateBatch.returns()

      await expect(factory.connect(owner).updateAccessBatchWithSignature(accessUpdateBatch2, signature2))
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator.address, false)
        .to.emit(factory, 'OperatorUpdated')
        .withArgs(user.address, operator2.address, false)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer.address, false)
        .to.emit(factory, 'SignerUpdated')
        .withArgs(user.address, signer2.address, false)

      expect(await factory.operators(user.address, operator.address)).to.equal(false)
      expect(await factory.operators(user.address, operator2.address)).to.equal(false)
      expect(await factory.signers(user.address, signer.address)).to.equal(false)
      expect(await factory.signers(user.address, signer.address)).to.equal(false)
    })

    it('reverts if signer does not match', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        operators: [
          { accessor: operator.address, approved: true },
          { accessor: operator2.address, approved: true },
        ],
        signers: [
          { accessor: signer.address, approved: false },
          { accessor: signer2.address, approved: false },
        ],
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: user.address,
          signer: owner.address,
          domain: factory.address,
        },
      }
      const signature = await signAccessUpdateBatch(user, verifier, accessUpdateBatch)

      verifier.verifyAccessUpdateBatch.returns()

      await expect(
        factory.connect(owner).updateAccessBatchWithSignature(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(factory, 'MarketFactoryInvalidSignerError')
    })
  })
})
