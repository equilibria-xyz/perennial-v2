import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import { Verifier, Verifier__factory, IERC1271 } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import {
  signIntent,
  signOperatorUpdate,
  signSignerUpdate,
  signAccessUpdateBatch,
  signCommon,
} from '../../helpers/erc712'

const { ethers } = HRE
use(smock.matchers)

describe('Verifier', () => {
  let owner: SignerWithAddress
  let market: SignerWithAddress
  let caller: SignerWithAddress
  let caller2: SignerWithAddress
  let signer: SignerWithAddress
  let operator: SignerWithAddress
  let verifier: Verifier
  let scSigner: FakeContract<IERC1271>

  beforeEach(async () => {
    ;[owner, market, caller, caller2, signer, operator] = await ethers.getSigners()

    verifier = await new Verifier__factory(owner).deploy()
    scSigner = await smock.fake<IERC1271>('IERC1271')
  })

  describe('#verifyCommon', () => {
    it('verifies common messages', async () => {
      // ensures base-layer verification is configured properly
      const commonMessage = {
        account: caller.address,
        signer: caller.address,
        domain: caller.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      }
      const signature = await signCommon(caller, verifier, commonMessage)

      await expect(verifier.connect(caller).verifyCommon(commonMessage, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })
  })

  describe('#verifyIntent', () => {
    const DEFAULT_INTENT = {
      amount: parse6decimal('10'),
      price: parse6decimal('123'),
      fee: parse6decimal('0.5'),
      originator: constants.AddressZero,
      solver: constants.AddressZero,
      collateralization: parse6decimal('0.1'),
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default intent', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: caller.address, domain: caller.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify default intent w/ sc signer', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: scSigner.address, domain: caller.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      scSigner.isValidSignature.returns(0x1626ba7e)

      await expect(verifier.connect(caller).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid signer', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: market.address, domain: caller.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid sc signer', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: scSigner.address, domain: caller.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      scSigner.isValidSignature.returns(false)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify intent w/ expiry', async () => {
      const now = await time.latest()
      const intent = {
        ...DEFAULT_INTENT,
        common: {
          ...DEFAULT_INTENT.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid expiry', async () => {
      const now = await time.latest()
      const intent = {
        ...DEFAULT_INTENT,
        common: {
          ...DEFAULT_INTENT.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now,
        },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const intent = {
        ...DEFAULT_INTENT,
        common: {
          ...DEFAULT_INTENT.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: 0,
        },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify intent w/ domain', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: caller.address, domain: market.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(market).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid domain', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: caller.address, domain: market.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid domain (zero)', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: caller.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid signature (too small)', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: caller.address, domain: caller.address },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid signature (too large)', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, signer: caller.address, domain: caller.address },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid nonce', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: {
          ...DEFAULT_INTENT.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          nonce: 17,
        },
      }
      const signature = await signIntent(caller, verifier, intent)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject intent w/ invalid nonce', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: {
          ...DEFAULT_INTENT.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          group: 17,
        },
      }
      const signature = await signIntent(caller, verifier, intent)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidGroupError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })

  describe('#verifyOperatorUpdate', () => {
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

    it('should verify default operator update', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify default operator update w/ sc signer', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      scSigner.isValidSignature.returns(0x1626ba7e)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject operator update w/ invalid signer', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: market.address,
          domain: caller.address,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject operator update w/ invalid sc signer', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      scSigner.isValidSignature.returns(false)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify operator update w/ expiry', async () => {
      const now = await time.latest()
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject operator update w/ invalid expiry', async () => {
      const now = await time.latest()
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject operator update w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: 0,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify operator update w/ domain', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(market).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject operator update w/ invalid domain', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject operator update w/ invalid domain (zero)', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, signer: caller.address },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject operator update w/ invalid signature (too small)', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject operator update w/ invalid signature (too large)', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject operator update w/ invalid nonce', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          nonce: 17,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject operator update w/ invalid nonce', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          group: 17,
        },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidGroupError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })

  describe('#verifySignerUpdate', () => {
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

    it('should verify default group cancellation', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        access: {
          accessor: owner.address,
          approved: true,
        },
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify default group cancellationc w/ sc signer', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        signer: owner.address,
        approved: true,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      scSigner.isValidSignature.returns(0x1626ba7e)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid signer', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: market.address,
          domain: caller.address,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid sc signer', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: market.address,
          domain: caller.address,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      scSigner.isValidSignature.returns(false)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify group cancellation w/ expiry', async () => {
      const now = await time.latest()
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid expiry', async () => {
      const now = await time.latest()
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: 0,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify group cancellation w/ domain', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(market).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid domain', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid domain (zero)', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, signer: caller.address },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid signature (too small)', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid signature (too large)', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid nonce', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          nonce: 17,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid nonce', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          group: 17,
        },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidGroupError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })

  describe('#verifyAccesUpdateBatch', () => {
    const DEFAULT_ACCESS_UPDATE_BATCH = {
      operators: [],
      signers: [],
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default group cancellation', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        operators: [{ accessor: operator.address, approved: true }],
        signers: [{ accessor: signer.address, approved: true }],
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify default group cancellation w/ sc signer', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        operators: [{ accessor: operator.address, approved: true }],
        signers: [{ accessor: signer.address, approved: true }],
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      scSigner.isValidSignature.returns(0x1626ba7e)

      await expect(verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid signer', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: market.address,
          domain: caller.address,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid sc signer', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      scSigner.isValidSignature.returns(false)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidSignerError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify group cancellation w/ expiry', async () => {
      const now = await time.latest()
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid expiry', async () => {
      const now = await time.latest()
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidExpiryError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: 0,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidExpiryError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify group cancellation w/ domain', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(verifier.connect(market).verifyAccessUpdateBatch(accessUpdateBatch, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid domain', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidDomainError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid domain (zero)', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: { ...DEFAULT_ACCESS_UPDATE_BATCH.common, account: caller.address, signer: caller.address },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidDomainError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid signature (too small)', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidSignatureError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid signature (too large)', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidSignatureError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid nonce', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          nonce: 17,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await verifier.connect(caller).cancelNonce(17)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidNonceError')

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid nonce', async () => {
      const accessUpdateBatch = {
        ...DEFAULT_ACCESS_UPDATE_BATCH,
        common: {
          ...DEFAULT_ACCESS_UPDATE_BATCH.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          group: 17,
        },
      }
      const signature = await signAccessUpdateBatch(caller, verifier, accessUpdateBatch)

      await verifier.connect(caller).cancelGroup(17)

      await expect(
        verifier.connect(caller).verifyAccessUpdateBatch(accessUpdateBatch, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidGroupError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })
})
