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
      takerFee: 5,
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
        expect(value.orders).to.equal(2)
        expect(value.takerPos).to.equal(3)
        expect(value.takerNeg).to.equal(4)
        expect(value.notional).to.equal(0)
        expect(value.takerFee).to.equal(5)
        expect(value.referral).to.equal(0)
      })
    })
  })

  describe('local', () => {
    const VALID_STORED_GUARANTEE: GuaranteeStruct = {
      orders: 2,
      takerPos: 3,
      takerNeg: 4,
      notional: 14,
      takerFee: 5,
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
        expect(value.orders).to.equal(2)
        expect(value.takerPos).to.equal(3)
        expect(value.takerNeg).to.equal(4)
        expect(value.notional).to.equal(14)
        expect(value.takerFee).to.equal(5)
        expect(value.referral).to.equal(15)
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
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct guarantee (long w/ both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct guarantee (long w/ referral + settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ referral + trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (long w/ referral + both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (long w/ referral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ tarde fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct guarantee (short w/ both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct guarantee (short w/ referral + settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ referral + trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short w/ referral + both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short w/ referral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          takerNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (maker open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, makerPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
        })
      })

      it('generates correct guarantee (maker close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, makerNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
        })
      })
    })

    describe('#takerTotal', () => {
      it('calculate taker total', async () => {
        await expect(
          await guaranteeLocal.takerTotal({
            ...DEFAULT_GUARANTEE,
            takerPos: 4,
            takerNeg: 3,
          }),
        ).to.equal(7)
      })
    })

    describe('#priceAdjustment', () => {
      it('long / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              takerPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('short / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              takerNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('long / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              takerPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('short / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              takerNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('zero price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('0'),
              takerNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-1210'))
      })

      it('zero size', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0'))
      })
    })

    describe('#priceDeviation', () => {
      it('long / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              takerPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('short / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              takerNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('long / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              takerPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('short / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              takerNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('zero price', async () => {
        await expect(
          guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('0'),
              takerNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.revertedWithPanic('0x12')
      })

      it('zero size', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0'))
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

      context('.takerFee', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            takerFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.takerFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if takerFee out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              takerFee: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })
    })
  }
})
