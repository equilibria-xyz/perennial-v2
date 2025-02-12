import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  GuaranteeGlobalTester,
  GuaranteeLocalTester,
  GuaranteeGlobalTester__factory,
  GuaranteeLocalTester__factory,
  GuaranteeStorageGlobalLib,
  GuaranteeStorageLocalLib,
  GuaranteeStorageGlobalLib__factory,
  GuaranteeStorageLocalLib__factory,
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
      longPos: 3,
      longNeg: 4,
      shortPos: 6,
      shortNeg: 7,
      notional: 0,
      takerFee: 5,
      orderReferral: 9,
      solverReferral: 0,
    }

    let guaranteeStorageGlobalLib: GuaranteeStorageGlobalLib
    let guaranteeGlobal: GuaranteeGlobalTester

    beforeEach(async () => {
      guaranteeStorageGlobalLib = await new GuaranteeStorageGlobalLib__factory(owner).deploy()
      guaranteeGlobal = await new GuaranteeGlobalTester__factory(
        { 'contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': guaranteeStorageGlobalLib.address },
        owner,
      ).deploy()
    })

    describe('common behavoir', () => {
      shouldBehaveLike(() => ({
        guarantee: guaranteeGlobal,
        storageLib: guaranteeStorageGlobalLib,
        validStoredGuarantee: VALID_STORED_GUARANTEE,
      }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guaranteeGlobal.store(VALID_STORED_GUARANTEE)

        const value = await guaranteeGlobal.read()
        expect(value.orders).to.equal(2)
        expect(value.longPos).to.equal(3)
        expect(value.longNeg).to.equal(4)
        expect(value.shortPos).to.equal(6)
        expect(value.shortNeg).to.equal(7)
        expect(value.notional).to.equal(0)
        expect(value.takerFee).to.equal(5)
        expect(value.orderReferral).to.equal(9)
        expect(value.solverReferral).to.equal(0)
      })
    })
  })

  describe('local', () => {
    const VALID_STORED_GUARANTEE: GuaranteeStruct = {
      orders: 2,
      longPos: 3,
      longNeg: 4,
      shortPos: 6,
      shortNeg: 7,
      notional: 14,
      takerFee: 5,
      orderReferral: 16,
      solverReferral: 15,
    }

    let guaranteeStorageLocalLib: GuaranteeStorageLocalLib
    let guaranteeLocal: GuaranteeLocalTester

    beforeEach(async () => {
      guaranteeStorageLocalLib = await new GuaranteeStorageLocalLib__factory(owner).deploy()
      guaranteeLocal = await new GuaranteeLocalTester__factory(
        { 'contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': guaranteeStorageLocalLib.address },
        owner,
      ).deploy()
    })

    describe('common behavior', () => {
      shouldBehaveLike(() => ({
        guarantee: guaranteeLocal,
        storageLib: guaranteeStorageLocalLib,
        validStoredGuarantee: VALID_STORED_GUARANTEE,
      }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guaranteeLocal.store(VALID_STORED_GUARANTEE)

        const value = await guaranteeLocal.read()
        expect(value.orders).to.equal(2)
        expect(value.longPos).to.equal(3)
        expect(value.longNeg).to.equal(4)
        expect(value.shortPos).to.equal(6)
        expect(value.shortNeg).to.equal(7)
        expect(value.notional).to.equal(14)
        expect(value.takerFee).to.equal(5)
        expect(value.solverReferral).to.equal(15)
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
          ).to.be.revertedWithCustomError(guaranteeStorageLocalLib, 'GuaranteeStorageInvalidError')
        })

        it('reverts if notional out of range (below)', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              notional: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(guaranteeStorageLocalLib, 'GuaranteeStorageInvalidError')
        })
      })

      context('.solverReferral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            solverReferral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guaranteeLocal.read()
          expect(value.solverReferral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if solverReferral out of range', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              solverReferral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guaranteeStorageLocalLib, 'GuaranteeStorageInvalidError')
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
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
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
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct guarantee (long w/ solverReferral + trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          orderReferral: parse6decimal('2'),
          solverReferral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (long w/ solverReferral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
          orderReferral: parse6decimal('2'),
          solverReferral: parse6decimal('1'),
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
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
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
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortNeg: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ tarde fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct guarantee (short w/ solverReferral + trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          orderReferral: parse6decimal('2'),
          solverReferral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short w/ solverReferral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
          orderReferral: parse6decimal('2'),
          solverReferral: parse6decimal('1'),
        })
      })
    })

    describe('#takerPos', () => {
      it('calculates taker pos', async () => {
        await expect(
          await guaranteeLocal.takerPos({
            ...DEFAULT_GUARANTEE,
            longPos: 1,
            longNeg: 2,
            shortPos: 7,
            shortNeg: 6,
          }),
        ).to.equal(7)
      })
    })

    describe('#takerNeg', () => {
      it('calculates taker pos', async () => {
        await expect(
          await guaranteeLocal.takerNeg({
            ...DEFAULT_GUARANTEE,
            longPos: 1,
            longNeg: 2,
            shortPos: 7,
            shortNeg: 6,
          }),
        ).to.equal(9)
      })
    })

    describe('#taker', () => {
      it('calculates taker', async () => {
        await expect(
          await guaranteeLocal.taker({
            ...DEFAULT_GUARANTEE,
            longPos: 1,
            longNeg: 2,
            shortPos: 7,
            shortNeg: 6,
          }),
        ).to.equal(-2)
      })
    })

    describe('#takerTotal', () => {
      it('calculate taker total', async () => {
        await expect(
          await guaranteeLocal.takerTotal({
            ...DEFAULT_GUARANTEE,
            longPos: 1,
            longNeg: 2,
            shortPos: 7,
            shortNeg: 6,
          }),
        ).to.equal(16)
      })
    })

    describe('#isEmpty', () => {
      it('calculates empty', async () => {
        await expect(
          await guaranteeLocal.isEmpty({
            ...DEFAULT_GUARANTEE,
          }),
        ).to.equal(true)
      })

      it('calculates not empty longPos', async () => {
        await expect(
          await guaranteeLocal.isEmpty({
            ...DEFAULT_GUARANTEE,
            longPos: 1,
          }),
        ).to.equal(false)
      })

      it('calculates not empty longNeg', async () => {
        await expect(
          await guaranteeLocal.isEmpty({
            ...DEFAULT_GUARANTEE,
            longNeg: 1,
          }),
        ).to.equal(false)
      })

      it('calculates not empty shortPos', async () => {
        await expect(
          await guaranteeLocal.isEmpty({
            ...DEFAULT_GUARANTEE,
            shortPos: 1,
          }),
        ).to.equal(false)
      })

      it('calculates not empty shortNeg', async () => {
        await expect(
          await guaranteeLocal.isEmpty({
            ...DEFAULT_GUARANTEE,
            shortNeg: 1,
          }),
        ).to.equal(false)
      })
    })

    describe('#priceAdjustment', () => {
      it('long open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('long close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('short open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('short close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('long open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('long neg / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('short open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('short close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('zero price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('0'),
              shortPos: parse6decimal('10'),
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
      it('long open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('long close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('short open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('short close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('long open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('long close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('short open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('short close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('zero price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('0'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(ethers.constants.MaxUint256)
      })

      it('negative oracle price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('-125'),
          ),
        ).to.equal(parse6decimal('2.016260'))
      })

      it('negative guarantee price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('2.016260'))
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
      storageLib: GuaranteeStorageLocalLib | GuaranteeStorageGlobalLib
      validStoredGuarantee: GuaranteeStruct
    },
  ) {
    let guarantee: GuaranteeLocalTester | GuaranteeGlobalTester
    let storageLib: GuaranteeStorageLocalLib | GuaranteeStorageGlobalLib
    let validStoredGuarantee: GuaranteeStruct

    beforeEach(async () => {
      ;({ guarantee, storageLib, validStoredGuarantee } = getter())
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
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if longPos out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            longNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.longNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if longNeg out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              longNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if shortPos out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if shortNeg out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
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
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
        })
      })

      context('.orderReferral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            orderReferral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.orderReferral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if orderReferral out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              orderReferral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(storageLib, 'GuaranteeStorageInvalidError')
        })
      })
    })

    describe('#fresh', () => {
      it('creates a fresh guarantee', async () => {
        await guarantee.store({
          orders: 1,
          longPos: 2,
          longNeg: 3,
          shortPos: 4,
          shortNeg: 5,
          notional: 6,
          takerFee: 7,
          orderReferral: 8,
          solverReferral: 9,
        })

        await guarantee.fresh()
        const result = await guarantee.read()

        expect(result.orders).to.equal(0)
        expect(result.longPos).to.equal(0)
        expect(result.longNeg).to.equal(0)
        expect(result.shortPos).to.equal(0)
        expect(result.shortNeg).to.equal(0)
        expect(result.notional).to.equal(0)
        expect(result.takerFee).to.equal(0)
        expect(result.orderReferral).to.equal(0)
        expect(result.solverReferral).to.equal(0)
      })
    })
  }
})
