import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import { FillStruct, IntentStruct } from '../../../types/generated/contracts/Verifier'
import { Verifier, Verifier__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

function erc721Domain(verifier: Verifier) {
  return {
    name: 'Perennial',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

async function signIntent(signer: SignerWithAddress, verifier: Verifier, intent: IntentStruct): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    Intent: [
      { name: 'amount', type: 'int256' },
      { name: 'price', type: 'int256' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, intent)
}

async function signFill(signer: SignerWithAddress, verifier: Verifier, fill: FillStruct): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    Intent: [
      { name: 'amount', type: 'int256' },
      { name: 'price', type: 'int256' },
      { name: 'common', type: 'Common' },
    ],
    Fill: [
      { name: 'intent', type: 'Intent' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, fill)
}

describe('Coordinator', () => {
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
        expiry: 0,
      },
    }

    it('should verify default intent', async () => {
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address } }
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
        common: { ...DEFAULT_INTENT.common, account: caller.address, expiry: now + 2 },
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
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address, expiry: now } }
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

    it('should reject intent w/ invalid signature (too small)', async () => {
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address } }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid signature (too large)', async () => {
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address } }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid nonce', async () => {
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address, nonce: 17 } }
      const signature = await signIntent(caller, verifier, intent)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(market).verifyIntent(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject intent w/ invalid nonce', async () => {
      const intent = { ...DEFAULT_INTENT, common: { ...DEFAULT_INTENT.common, account: caller.address, group: 17 } }
      const signature = await signIntent(caller, verifier, intent)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(market).verifyIntent(intent, signature)).to.revertedWithCustomError(
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
          expiry: 0,
        },
      },
      common: {
        account: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: 0,
      },
    }

    it('should verify default intent', async () => {
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address } }
      const signature = await signFill(caller, verifier, intent)

      const result = await verifier.connect(caller).callStatic.verifyFill(intent, signature)
      await expect(verifier.connect(caller).verifyFill(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify intent w/ expiry', async () => {
      const now = await time.latest()
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address, expiry: now + 2 } } // callstatic & call each take one second
      const signature = await signFill(caller, verifier, intent)

      const result = await verifier.connect(caller).callStatic.verifyFill(intent, signature)
      await expect(verifier.connect(caller).verifyFill(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid expiry', async () => {
      const now = await time.latest()
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address, expiry: now } }
      const signature = await signFill(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyFill(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify intent w/ domain', async () => {
      const intent = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: market.address },
      }
      const signature = await signFill(caller, verifier, intent)

      const result = await verifier.connect(market).callStatic.verifyFill(intent, signature)
      await expect(verifier.connect(market).verifyFill(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject intent w/ invalid domain', async () => {
      const intent = {
        ...DEFAULT_FILL,
        common: { ...DEFAULT_FILL.common, account: caller.address, domain: market.address },
      }
      const signature = await signFill(caller, verifier, intent)

      await expect(verifier.connect(caller).verifyFill(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid signature (too small)', async () => {
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address } }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

      await expect(verifier.connect(caller).verifyFill(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid signature (too large)', async () => {
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address } }
      const signature =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

      await expect(verifier.connect(caller).verifyFill(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject intent w/ invalid nonce', async () => {
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address, nonce: 17 } }
      const signature = await signFill(caller, verifier, intent)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(market).verifyFill(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject intent w/ invalid nonce', async () => {
      const intent = { ...DEFAULT_FILL, common: { ...DEFAULT_FILL.common, account: caller.address, group: 17 } }
      const signature = await signFill(caller, verifier, intent)

      await verifier.connect(caller).cancelGroup(17)

      await expect(verifier.connect(market).verifyFill(intent, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidGroupError',
      )

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
