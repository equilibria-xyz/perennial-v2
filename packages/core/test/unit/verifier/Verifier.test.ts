import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import { Verifier, Verifier__factory, IERC1271, IMarketFactorySigners } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import {
  signIntent,
  signOperatorUpdate,
  signSignerUpdate,
  signAccessUpdateBatch,
  signCommon,
  signFill,
  signTake,
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
  let marketFactory: FakeContract<IMarketFactorySigners>
  let scSigner: FakeContract<IERC1271>

  beforeEach(async () => {
    ;[owner, market, caller, caller2, signer, operator] = await ethers.getSigners()

    marketFactory = await smock.fake<IMarketFactorySigners>('IMarketFactorySigners')
    verifier = await new Verifier__factory(owner).deploy()
    await verifier.initialize(marketFactory.address)
    scSigner = await smock.fake<IERC1271>('IERC1271')

    marketFactory.signers.whenCalledWith(caller.address, scSigner.address).returns(true)
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

    it('should reject common w/ invalid signer or operator', async () => {
      const commonMessage = {
        account: caller.address,
        signer: caller2.address,
        domain: caller2.address,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      }
      const signature = await signCommon(caller2, verifier, commonMessage)

      await expect(verifier.connect(caller2).verifyCommon(commonMessage, signature)).to.be.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })
  })

  describe('#verifyFill', () => {
    let trader: SignerWithAddress
    let solver: SignerWithAddress

    beforeEach(async () => {
      trader = signer
      solver = caller2
    })

    const DEFAULT_COMMON = {
      account: constants.AddressZero,
      signer: constants.AddressZero,
      domain: constants.AddressZero,
      nonce: 0,
      group: 0,
      expiry: constants.MaxUint256,
    }
    const DEFAULT_FILL = {
      intent: {
        amount: parse6decimal('4'),
        price: parse6decimal('151'),
        fee: parse6decimal('0.25'),
        originator: constants.AddressZero,
        solver: constants.AddressZero,
        collateralization: parse6decimal('0.3'),
        common: DEFAULT_COMMON,
      },
      common: DEFAULT_COMMON,
    }

    it('should verify fill message', async () => {
      const fill = {
        ...DEFAULT_FILL,
        intent: {
          ...DEFAULT_FILL.intent,
          common: {
            ...DEFAULT_FILL.intent.common,
            account: trader.address,
            signer: trader.address,
            domain: market.address,
            nonce: 6,
          },
        },
        common: {
          ...DEFAULT_FILL.common,
          account: solver.address,
          signer: solver.address,
          domain: market.address,
          nonce: 66,
        },
      }

      // confirm the intent within is verifiable
      const intentSignature = await signIntent(trader, verifier, fill.intent)
      await expect(verifier.connect(market).verifyIntent(fill.intent, intentSignature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(trader.address, 6)
      expect(await verifier.nonces(trader.address, 6)).to.eq(true)

      // confirm the fill is verifiable
      const signature = await signFill(solver, verifier, fill)
      await expect(verifier.connect(market).verifyFill(fill, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(solver.address, 66)
      expect(await verifier.nonces(solver.address, 66)).to.eq(true)
    })

    it('should verify fill message w/ sc signer', async () => {
      const fill = {
        ...DEFAULT_FILL,
        intent: {
          ...DEFAULT_FILL.intent,
        },
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }

      scSigner.isValidSignature.returns(0x1626ba7e)

      const signature = await signFill(caller, verifier, fill)
      await expect(verifier.connect(caller).verifyFill(fill, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject fill w/ invalid signer', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: market.address,
          domain: caller.address,
        },
      }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid sc signer', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signFill(caller, verifier, fill)

      scSigner.isValidSignature.returns(false)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify fill w/ expiry', async () => {
      const now = await time.latest()
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now + 2,
        },
      } // callstatic & call each take one second
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject fill w/ invalid expiry', async () => {
      const now = await time.latest()
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now,
        },
      }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid domain', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signFill(caller, verifier, fill)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid signature', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature = '0x78fd3b7ec5e96f69e2953bb6f9ba0ca4051e2d37699967630642ce1d8f4ac791'

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject fill w/ invalid nonce', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          nonce: 17,
        },
      }
      const signature = await signFill(caller, verifier, fill)

      await verifier.connect(caller).cancelNonce(17)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 17)).to.eq(true)
    })

    it('should reject fill w/ invalid group', async () => {
      const fill = {
        ...DEFAULT_FILL,
        common: {
          ...DEFAULT_FILL.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          group: 4,
        },
      }
      const signature = await signFill(caller, verifier, fill)

      await verifier.connect(caller).cancelGroup(4)

      await expect(verifier.connect(caller).verifyFill(fill, signature)).to.revertedWithCustomError(
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

    it('should reject intent w/ invalid group', async () => {
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

  describe('#verifyTake', () => {
    const DEFAULT_TAKE = {
      amount: parse6decimal('20'),
      referrer: constants.AddressZero,
      common: {
        account: constants.AddressZero,
        signer: constants.AddressZero,
        domain: constants.AddressZero,
        nonce: 0,
        group: 0,
        expiry: constants.MaxUint256,
      },
    }

    it('should verify Take message', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        referrer: constants.AddressZero,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await expect(verifier.connect(market).verifyTake(marketUpdateTaker, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should verify Take message w/ sc signer', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      scSigner.isValidSignature.returns(0x1626ba7e)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject Take message w/ invalid signer', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: market.address,
          domain: caller.address,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject Take message w/ invalid sc signer', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: scSigner.address,
          domain: caller.address,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      scSigner.isValidSignature.returns(false)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignerError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should verify Take message w/ expiry', async () => {
      const now = await time.latest()
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now + 3,
        },
      } // callstatic & call each take one second
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 0)

      expect(await verifier.nonces(caller.address, 0)).to.eq(true)
    })

    it('should reject Take message w/ invalid expiry', async () => {
      const now = await time.latest()
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          expiry: now - 1,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidExpiryError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject Take message w/ invalid domain', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: market.address,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidDomainError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject Take message w/ invalid signature', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
        },
      }
      const signature = '0x885b1eefff8ef92e3acee19ba145266137cb5bc1191f796b08e3375a8b8c9458'

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidSignatureError',
      )

      expect(await verifier.nonces(caller.address, 0)).to.eq(false)
    })

    it('should reject Take message w/ invalid nonce', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          nonce: 22,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await verifier.connect(caller).cancelNonce(22)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
        verifier,
        'VerifierInvalidNonceError',
      )

      expect(await verifier.nonces(caller.address, 22)).to.eq(true)
    })

    it('should reject Take message w/ invalid group', async () => {
      const marketUpdateTaker = {
        ...DEFAULT_TAKE,
        common: {
          ...DEFAULT_TAKE.common,
          account: caller.address,
          signer: caller.address,
          domain: caller.address,
          group: 14,
        },
      }
      const signature = await signTake(caller, verifier, marketUpdateTaker)

      await verifier.connect(caller).cancelGroup(14)

      await expect(verifier.connect(caller).verifyTake(marketUpdateTaker, signature)).to.revertedWithCustomError(
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
