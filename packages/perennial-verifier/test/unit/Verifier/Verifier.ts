import { smock } from '@defi-wonderland/smock'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import { Verifier, Verifier__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { signIntent, signFill, signCommon, signGroupCancellation } from '../../helpers/erc712'

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

  describe('#verifyCommon', () => {
    const DEFAULT_COMMON = {
      account: constants.AddressZero,
      domain: constants.AddressZero,
      nonce: 0,
      group: 0,
      expiry: constants.MaxUint256,
    }

    it('should verify default common', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address }
      const signature = await signCommon(caller, verifier, common)

      const result = await verifier.connect(caller).callStatic.verifyCommon(common, signature)
      await expect(verifier.connect(caller).verifyCommon(common, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify common w/ expiry', async () => {
      const now = await time.latest()
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address, expiry: now + 2 } // callstatic & call each take one second
      const signature = await signCommon(caller, verifier, common)

      const result = await verifier.connect(caller).callStatic.verifyCommon(common, signature)
      await expect(verifier.connect(caller).verifyCommon(common, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject common w/ invalid expiry', async () => {
      const now = await time.latest()
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address, expiry: now }
      const signature = await signCommon(caller, verifier, common)

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject common w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address, expiry: 0 }
      const signature = await signCommon(caller, verifier, common)

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify common w/ domain', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: market.address }
      const signature = await signCommon(caller, verifier, common)

      const result = await verifier.connect(market).callStatic.verifyCommon(common, signature)
      await expect(verifier.connect(market).verifyCommon(common, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject common w/ invalid domain', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: market.address }
      const signature = await signCommon(caller, verifier, common)

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject common w/ invalid domain (zero)', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address }
      const signature = await signCommon(caller, verifier, common)

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject common w/ invalid signature (too small)', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject common w/ invalid signature (too large)', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject common w/ invalid nonce', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address, nonce: 17 }
      const signature = await signCommon(caller, verifier, common)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject common w/ invalid nonce', async () => {
      const common = { ...DEFAULT_COMMON, account: caller.address, domain: caller.address, group: 17 }
      const signature = await signCommon(caller, verifier, common)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(caller).verifyCommon(common, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidGroupError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
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

  describe('#verifyGroupCancellation', () => {
    const DEFAULT_GROUP_CANCELLATION = {
      group: 0,
      common: {
        account: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify default group cancellation', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      const result = await verifier.connect(caller).callStatic.verifyGroupCancellation(groupCancellation, signature)
      await expect(verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify group cancellation w/ expiry', async () => {
      const now = await time.latest()
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: {
          ...DEFAULT_GROUP_CANCELLATION.common,
          account: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      const result = await verifier.connect(caller).callStatic.verifyGroupCancellation(groupCancellation, signature)
      await expect(verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid expiry', async () => {
      const now = await time.latest()
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address, expiry: now },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidExpiryError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid expiry (zero)', async () => {
      const now = await time.latest()
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address, expiry: 0 },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidExpiryError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify group cancellation w/ domain', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: market.address },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      const result = await verifier.connect(market).callStatic.verifyGroupCancellation(groupCancellation, signature)
      await expect(verifier.connect(market).verifyGroupCancellation(groupCancellation, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid domain', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: market.address },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidDomainError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid domain (zero)', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidDomainError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid signature (too small)', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidSignatureError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid signature (too large)', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address },
      }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidSignatureError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject group cancellation w/ invalid nonce', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address, nonce: 17 },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      await verifier.connect(caller).cancelNonce(17)

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidNonceError')

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject group cancellation w/ invalid nonce', async () => {
      const groupCancellation = {
        ...DEFAULT_GROUP_CANCELLATION,
        common: { ...DEFAULT_GROUP_CANCELLATION.common, account: caller.address, domain: caller.address, group: 17 },
      }
      const signature = await signGroupCancellation(caller, verifier, groupCancellation)

      await verifier.connect(caller).cancelGroup(17)

      await expect(
        verifier.connect(caller).verifyGroupCancellation(groupCancellation, signature),
      ).to.revertedWithCustomError(verifier, 'VerifierInvalidGroupError')

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })

  describe('#cancelNonce', () => {
    it('should cancel the nonce for the account', async () => {
      await expect(verifier.connect(caller).cancelNonce(1))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 1)

      expect(await verifier.nonces(caller.address, 1)).to.eq(true)
    })
  })

  describe('#cancelGroup', () => {
    it('should cancel the group for the account', async () => {
      await expect(verifier.connect(caller).cancelGroup(1))
        .to.emit(verifier, 'GroupCancelled')
        .withArgs(caller.address, 1)

      expect(await verifier.groups(caller.address, 1)).to.eq(true)
    })
  })
})
