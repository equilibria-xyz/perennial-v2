import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  IntentGlobalTester,
  IntentLocalTester,
  IntentGlobalTester__factory,
  IntentLocalTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { IntentStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal, DEFAULT_ORDER, DEFAULT_INTENT, expectIntentEq } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Intent', () => {
  let owner: SignerWithAddress

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()
  })

  describe('global', () => {
    const VALID_STORED_INTENT: IntentStruct = {
      intents: 2,
      makerPos: 3,
      makerNeg: 4,
      longPos: 5,
      longNeg: 6,
      shortPos: 7,
      shortNeg: 8,
      notional: 0,
    }

    let intentGlobal: IntentGlobalTester

    beforeEach(async () => {
      intentGlobal = await new IntentGlobalTester__factory(owner).deploy()
    })

    describe('common behavoir', () => {
      shouldBehaveLike(() => ({ intent: intentGlobal, validStoredIntent: VALID_STORED_INTENT }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await intentGlobal.store(VALID_STORED_INTENT)

        const value = await intentGlobal.read()
        expect(value.makerPos).to.equal(3)
        expect(value.makerNeg).to.equal(4)
        expect(value.longPos).to.equal(5)
        expect(value.longNeg).to.equal(6)
        expect(value.shortPos).to.equal(7)
        expect(value.shortNeg).to.equal(8)
        expect(value.notional).to.equal(0)
      })

      context('.makerPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await intentGlobal.store({
            ...DEFAULT_INTENT,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentGlobal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentGlobal.store({
              ...DEFAULT_INTENT,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentGlobal, 'IntentStorageInvalidError')
        })
      })

      context('.makerNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await intentGlobal.store({
            ...DEFAULT_INTENT,
            makerNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentGlobal.read()
          expect(value.makerNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentGlobal.store({
              ...DEFAULT_INTENT,
              makerNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentGlobal, 'IntentStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await intentGlobal.store({
            ...DEFAULT_INTENT,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentGlobal.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentGlobal.store({
              ...DEFAULT_INTENT,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentGlobal, 'IntentStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await intentGlobal.store({
            ...DEFAULT_INTENT,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentGlobal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentGlobal.store({
              ...DEFAULT_INTENT,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentGlobal, 'IntentStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await intentGlobal.store({
            ...DEFAULT_INTENT,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentGlobal.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentGlobal.store({
              ...DEFAULT_INTENT,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentGlobal, 'IntentStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await intentGlobal.store({
            ...DEFAULT_INTENT,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentGlobal.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentGlobal.store({
              ...DEFAULT_INTENT,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentGlobal, 'IntentStorageInvalidError')
        })
      })
    })
  })

  describe('local', () => {
    const VALID_STORED_INTENT: IntentStruct = {
      intents: 2,
      makerPos: 3,
      makerNeg: 4,
      longPos: 0,
      longNeg: 0,
      shortPos: 0,
      shortNeg: 0,
      notional: 14,
    }

    let intentLocal: IntentLocalTester

    beforeEach(async () => {
      intentLocal = await new IntentLocalTester__factory(owner).deploy()
    })

    describe('common behavior', () => {
      shouldBehaveLike(() => ({ intent: intentLocal, validStoredIntent: VALID_STORED_INTENT }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await intentLocal.store(VALID_STORED_INTENT)

        const value = await intentLocal.read()
        expect(value.makerPos).to.equal(3)
        expect(value.makerNeg).to.equal(4)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.notional).to.equal(14)
      })

      context('.makerPos', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })

      context('.makerNeg', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            makerNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.makerNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              makerNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })

      context('.notional', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            notional: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intentLocal.read()
          expect(value.notional).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await intentLocal.store({
            ...DEFAULT_INTENT,
            notional: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await intentLocal.read()
          expect(value.notional).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if notional out of range (above)', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              notional: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })

        it('reverts if notional out of range (below)', async () => {
          await expect(
            intentLocal.store({
              ...DEFAULT_INTENT,
              notional: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(intentLocal, 'IntentStorageInvalidError')
        })
      })
    })

    describe('#from', () => {
      it('generates correct intent (long open)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') }, parse6decimal('123'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 1,
          makerPos: 0,
          makerNeg: 0,
          longPos: parse6decimal('10'),
          longNeg: 0,
          shortPos: 0,
          shortNeg: 0,
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct intent (long close)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, longNeg: parse6decimal('10') }, parse6decimal('123'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 1,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: parse6decimal('10'),
          shortPos: 0,
          shortNeg: 0,
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct intent (short open)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') }, parse6decimal('123'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 1,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: 0,
          shortPos: parse6decimal('10'),
          shortNeg: 0,
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct intent (short close)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, shortNeg: parse6decimal('10') }, parse6decimal('123'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 1,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: 0,
          shortPos: 0,
          shortNeg: parse6decimal('10'),
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct intent (maker open)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, makerPos: parse6decimal('10') }, parse6decimal('123'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 0,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: 0,
          shortPos: 0,
          shortNeg: 0,
          notional: 0,
        })
      })

      it('generates correct intent (maker close)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, makerNeg: parse6decimal('10') }, parse6decimal('123'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 0,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: 0,
          shortPos: 0,
          shortNeg: 0,
          notional: 0,
        })
      })

      it('generates correct intent (taker, zero price)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') }, parse6decimal('0'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 0,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: 0,
          shortPos: 0,
          shortNeg: 0,
          notional: 0,
        })
      })

      it('generates correct intent (maker, zero price)', async () => {
        await intentLocal.from({ ...DEFAULT_ORDER, orders: 1, makerPos: parse6decimal('10') }, parse6decimal('0'))
        const newIntent = await intentLocal.read()

        expectIntentEq(newIntent, {
          intents: 0,
          makerPos: 0,
          makerNeg: 0,
          longPos: 0,
          longNeg: 0,
          shortPos: 0,
          shortNeg: 0,
          notional: 0,
        })
      })
    })
  })

  function shouldBehaveLike(
    getter: () => {
      intent: IntentLocalTester | IntentGlobalTester
      validStoredIntent: IntentStruct
    },
  ) {
    let intent: IntentLocalTester | IntentGlobalTester
    let validStoredIntent: IntentStruct

    beforeEach(async () => {
      ;({ intent, validStoredIntent } = getter())
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await intent.store(validStoredIntent)

        const value = await intent.read()
        expect(value.intents).to.equal(2)
      })

      context('.intents', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await intent.store({
            ...validStoredIntent,
            intents: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await intent.read()
          expect(value.intents).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            intent.store({
              ...validStoredIntent,
              intents: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(intent, 'IntentStorageInvalidError')
        })
      })
    })
  }
})
