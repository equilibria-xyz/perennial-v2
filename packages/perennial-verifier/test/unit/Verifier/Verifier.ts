import { smock } from '@defi-wonderland/smock'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import { Verifier, Verifier__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { signIntent, signFill, signOperatorUpdate, signSignerUpdate } from '../../helpers/erc712'

const { ethers } = HRE
use(smock.matchers)

describe('Verifier', () => {
  let owner: SignerWithAddress
  let market: SignerWithAddress
  let caller: SignerWithAddress
  let caller2: SignerWithAddress
  let verifier: Verifier

  beforeEach(async () => {
    ;[owner, market, caller, caller2] = await ethers.getSigners()

    verifier = await new Verifier__factory(owner).deploy()
  })

  describe('#verifyIntent', () => {
    const DEFAULT_INTENT = {
      amount: parse6decimal('10'),
      price: parse6decimal('123'),
      common: {
        account: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default intent', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      const result = await verifier.connect(caller).callStatic.verifyIntent(intent, signature)
      await expect(verifier.connect(caller).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify intent w/ expiry', async () => {
      const now = await time.latest()
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address, expiry: now + 2 },
      } // callstatic & call each take one second
      const signature = await signIntent(caller, verifier, intent)

      const result = await verifier.connect(caller).callStatic.verifyIntent(intent, signature)
      await expect(verifier.connect(caller).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid expiry', async () => {
      const now = await time.latest()
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address, expiry: now },
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address, expiry: 0 },
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: market.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      const result = await verifier.connect(market).callStatic.verifyIntent(intent, signature)
      await expect(verifier.connect(market).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid domain', async () => {
      const intent = {
        ...DEFAULT_INTENT,
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: market.address },
      }
      const signature = await signIntent(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid domain (zero)', async () => {
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address } }
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address },
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address },
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address, nonce: 17 },
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, domain: caller.address, group: 17 },
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

  describe('#verifyFill', () => {
    const DEFAULT_FILL = {
      intent: {
        amount: parse6decimal('10'),
        price: parse6decimal('123'),
        common: {
          account: constants.AddressZero,
          domain: constants.AddressZero,
          nonce: 0,
          group: 0,
          expiry: constants.MaxUint256,
        },
      },
      common: {
        account: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default fill', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address },
      }
      const signature = await signFill(caller, verifier, fill)

      const result = await verifier.connect(caller).callStatic.verifyFill(fill, signature)
      await expect(verifier.connect(caller).verifyFill(fill, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify fill w/ expiry', async () => {
      const now = await time.latest()
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address, expiry: now + 2 },
      } // callstatic & call each take one second
      const signature = await signFill(caller, verifier, fill)

      const result = await verifier.connect(caller).callStatic.verifyFill(fill, signature)
      await expect(verifier.connect(caller).verifyFill(fill, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject fill w/ invalid expiry', async () => {
      const now = await time.latest()
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address, expiry: now },
      }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address, expiry: 0 },
      }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify fill w/ domain', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: market.address },
      }
      const signature = await signFill(caller, verifier, fill)

      const result = await verifier.connect(market).callStatic.verifyFill(fill, signature)
      await expect(verifier.connect(market).verifyFill(fill, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject fill w/ invalid domain', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: market.address },
      }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid domain (zero)', async () => {
      const fill = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address } }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid signature (too small)', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid signature (too large)', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid nonce', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address, nonce: 17 },
      }
      const signature = await signFill(caller, verifier, fill)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject fill w/ invalid nonce', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: caller.address, group: 17 },
      }
      const signature = await signFill(caller, verifier, fill)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidGroupError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })

  describe('#verifyOperatorUpdate', () => {
    const DEFAULT_OPERATOR_UPDATE = {
      operator: constants.AddressZero,
      approved: false,
      common: {
        account: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default operator update', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        operator: owner.address,
        approved: true,
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      const result = await verifier.connect(caller).callStatic.verifyOperatorUpdate(operatorUpdate, signature)
      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify operator update w/ expiry', async () => {
      const now = await time.latest()
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: {
          ...DEFAULT_OPERATOR_UPDATE.common,
          account: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      const result = await verifier.connect(caller).callStatic.verifyOperatorUpdate(operatorUpdate, signature)
      await expect(verifier.connect(caller).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject operator update w/ invalid expiry', async () => {
      const now = await time.latest()
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address, expiry: now },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address, expiry: 0 },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: market.address },
      }
      const signature = await signOperatorUpdate(caller, verifier, operatorUpdate)

      const result = await verifier.connect(market).callStatic.verifyOperatorUpdate(operatorUpdate, signature)
      await expect(verifier.connect(market).verifyOperatorUpdate(operatorUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject operator update w/ invalid domain', async () => {
      const operatorUpdate = {
        ...DEFAULT_OPERATOR_UPDATE,
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: market.address },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address, nonce: 17 },
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
        common: { ...DEFAULT_OPERATOR_UPDATE.common, account: caller.address, domain: caller.address, group: 17 },
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
      signer: constants.AddressZero,
      approved: false,
      common: {
        account: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default group cancellation', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        signer: owner.address,
        approved: true,
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      const result = await verifier.connect(caller).callStatic.verifySignerUpdate(signerUpdate, signature)
      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify group cancellation w/ expiry', async () => {
      const now = await time.latest()
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: {
          ...DEFAULT_SIGNER_UPDATE.common,
          account: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      const result = await verifier.connect(caller).callStatic.verifySignerUpdate(signerUpdate, signature)
      await expect(verifier.connect(caller).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid expiry', async () => {
      const now = await time.latest()
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address, expiry: now },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address, expiry: 0 },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: market.address },
      }
      const signature = await signSignerUpdate(caller, verifier, signerUpdate)

      const result = await verifier.connect(market).callStatic.verifySignerUpdate(signerUpdate, signature)
      await expect(verifier.connect(market).verifySignerUpdate(signerUpdate, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid domain', async () => {
      const signerUpdate = {
        ...DEFAULT_SIGNER_UPDATE,
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: market.address },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address, nonce: 17 },
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
        common: { ...DEFAULT_SIGNER_UPDATE.common, account: caller.address, domain: caller.address, group: 17 },
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
})
