import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  GuaranteeGlobalTester,
  GuaranteeLocalTester,
  GuaranteeGlobalTester__factory,
  GuaranteeLocalTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { GuaranteeStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal, DEFAULT_ORDER, DEFAULT_GUARANTEE, expectGuaranteeEq } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Guarantee', () => {
  let owner: SignerWithAddress

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()
  })

  describe('global', () => {
    const VALID_STORED_GUARANTEE: GuaranteeStruct = {
      orders: 2,
      takerPos: 3,
      takerNeg: 4,
      notional: 0,
      referral: 0,
    }

    let guaranteeGlobal: GuaranteeGlobalTester

    beforeEach(async () => {
      guaranteeGlobal = await new GuaranteeGlobalTester__factory(owner).deploy()
    })

    describe('common behavoir', () => {
      shouldBehaveLike(() => ({ guarantee: guaranteeGlobal, validStoredGuarantee: VALID_STORED_GUARANTEE }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guaranteeGlobal.store(VALID_STORED_GUARANTEE)

        const value = await guaranteeGlobal.read()
        expect(value.takerPos).to.equal(3)
        expect(value.takerNeg).to.equal(4)
        expect(value.notional).to.equal(0)
      })
    })
  })

  describe('local', () => {
    const VALID_STORED_GUARANTEE: GuaranteeStruct = {
      orders: 2,
      takerPos: 3,
      takerNeg: 4,
      notional: 14,
      referral: 15,
    }

    let guaranteeLocal: GuaranteeLocalTester

    beforeEach(async () => {
      guaranteeLocal = await new GuaranteeLocalTester__factory(owner).deploy()
    })

    describe('common behavior', () => {
      shouldBehaveLike(() => ({ guarantee: guaranteeLocal, validStoredGuarantee: VALID_STORED_GUARANTEE }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guaranteeLocal.store(VALID_STORED_GUARANTEE)

        const value = await guaranteeLocal.read()
        expect(value.takerPos).to.equal(3)
        expect(value.takerNeg).to.equal(4)
        expect(value.notional).to.equal(14)
      })

      context('.notional', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            notional: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guaranteeLocal.read()
          expect(value.notional).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            notional: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await guaranteeLocal.read()
          expect(value.notional).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if notional out of range (above)', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              notional: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guaranteeLocal, 'GuaranteeStorageInvalidError')
        })

        it('reverts if notional out of range (below)', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              notional: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(guaranteeLocal, 'GuaranteeStorageInvalidError')
        })
      })

      context('.referral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            referral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guaranteeLocal.read()
          expect(value.referral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if referral out of range', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              referral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guaranteeLocal, 'GuaranteeStorageInvalidError')
        })
      })
    })

    describe('#from', () => {
      it('generates correct guarantee (long open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 1,
          takerPos: parse6decimal('10'),
          takerNeg: 0,
          notional: parse6decimal('1230'),
          referral: 0,
        })
      })

      it('generates correct guarantee (long close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 1,
          takerPos: 0,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: 0,
        })
      })

      it('generates correct guarantee (long settlementFee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 0,
          takerPos: parse6decimal('10'),
          takerNeg: 0,
          notional: parse6decimal('1230'),
          referral: 0,
        })
      })

      it('generates correct guarantee (long referral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 0,
          takerPos: parse6decimal('10'),
          takerNeg: 0,
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 1,
          takerPos: 0,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: 0,
        })
      })

      it('generates correct guarantee (short close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 1,
          takerPos: parse6decimal('10'),
          takerNeg: 0,
          notional: parse6decimal('1230'),
          referral: 0,
        })
      })

      it('generates correct guarantee (short settlementFee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 0,
          takerPos: 0,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: 0,
        })
      })

      it('generates correct guarantee (short referral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 0,
          takerPos: 0,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (maker open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, makerPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 0,
          takerPos: 0,
          takerNeg: 0,
          notional: 0,
          referral: 0,
        })
      })

      it('generates correct guarantee (maker close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, makerNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          orders: 0,
          takerPos: 0,
          takerNeg: 0,
          notional: 0,
          referral: 0,
        })
      })
    })
  })

  function shouldBehaveLike(
    getter: () => {
      guarantee: GuaranteeLocalTester | GuaranteeGlobalTester
      validStoredGuarantee: GuaranteeStruct
    },
  ) {
    let guarantee: GuaranteeLocalTester | GuaranteeGlobalTester
    let validStoredGuarantee: GuaranteeStruct

    beforeEach(async () => {
      ;({ guarantee, validStoredGuarantee } = getter())
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guarantee.store(validStoredGuarantee)

        const value = await guarantee.read()
        expect(value.orders).to.equal(2)
      })

      context('.orders', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await guarantee.store({
            ...validStoredGuarantee,
            orders: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.orders).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            guarantee.store({
              ...validStoredGuarantee,
              orders: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.takerPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            takerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.takerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if takerPos out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              takerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.takerNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            takerNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.takerNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if takerNeg out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              takerNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })
    })
  }
})
