import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  OrderGlobalTester,
  OrderLocalTester,
  OrderGlobalTester__factory,
  OrderLocalTester__factory,
} from '../../../types/generated'
import { BigNumber, BigNumberish } from 'ethers'
import { OrderStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal } from '../../../../common/testutil/types'
import { VALID_ORACLE_VERSION } from './Position.test'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { DEFAULT_POSITION, DEFAULT_ORDER } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Order', () => {
  let owner: SignerWithAddress

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()
  })

  describe('global', () => {
    const VALID_STORED_ORDER: OrderStruct = {
      timestamp: 10,
      orders: 2,
      makerPos: 3,
      makerNeg: 4,
      longPos: 5,
      longNeg: 6,
      shortPos: 7,
      shortNeg: 8,
      collateral: 9,
      protection: 1,
      makerReferral: 11,
      takerReferral: 12,
    }

    let orderGlobal: OrderGlobalTester

    beforeEach(async () => {
      orderGlobal = await new OrderGlobalTester__factory(owner).deploy()
    })

    describe('common behavoir', () => {
      shouldBehaveLike(() => ({ order: orderGlobal, validStoredOrder: VALID_STORED_ORDER }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await orderGlobal.store(VALID_STORED_ORDER)

        const value = await orderGlobal.read()
        expect(value.makerPos).to.equal(3)
        expect(value.makerNeg).to.equal(4)
        expect(value.longPos).to.equal(5)
        expect(value.longNeg).to.equal(6)
        expect(value.shortPos).to.equal(7)
        expect(value.shortNeg).to.equal(8)
      })

      context('.makerPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await orderGlobal.store({
            ...DEFAULT_ORDER,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderGlobal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderGlobal.store({
              ...DEFAULT_ORDER,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderGlobal, 'OrderStorageInvalidError')
        })
      })

      context('.makerNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await orderGlobal.store({
            ...DEFAULT_ORDER,
            makerNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderGlobal.read()
          expect(value.makerNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderGlobal.store({
              ...DEFAULT_ORDER,
              makerNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderGlobal, 'OrderStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await orderGlobal.store({
            ...DEFAULT_ORDER,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderGlobal.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderGlobal.store({
              ...DEFAULT_ORDER,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderGlobal, 'OrderStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await orderGlobal.store({
            ...DEFAULT_ORDER,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderGlobal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderGlobal.store({
              ...DEFAULT_ORDER,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderGlobal, 'OrderStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await orderGlobal.store({
            ...DEFAULT_ORDER,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderGlobal.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderGlobal.store({
              ...DEFAULT_ORDER,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderGlobal, 'OrderStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await orderGlobal.store({
            ...DEFAULT_ORDER,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderGlobal.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderGlobal.store({
              ...DEFAULT_ORDER,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderGlobal, 'OrderStorageInvalidError')
        })
      })
    })
  })

  describe('local', () => {
    const VALID_STORED_ORDER: OrderStruct = {
      timestamp: 10,
      orders: 2,
      makerPos: 3,
      makerNeg: 4,
      longPos: 0,
      longNeg: 0,
      shortPos: 0,
      shortNeg: 0,
      collateral: 9,
      protection: 1,
      makerReferral: 11,
      takerReferral: 12,
    }

    let orderLocal: OrderLocalTester

    beforeEach(async () => {
      orderLocal = await new OrderLocalTester__factory(owner).deploy()
    })

    describe('common behavoir', () => {
      shouldBehaveLike(() => ({ order: orderLocal, validStoredOrder: VALID_STORED_ORDER }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await orderLocal.store(VALID_STORED_ORDER)

        const value = await orderLocal.read()
        expect(value.makerPos).to.equal(3)
        expect(value.makerNeg).to.equal(4)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(1)
      })

      context('.makerPos', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.makerNeg', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            makerNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.makerNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              makerNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.protection', async () => {
        const STORAGE_SIZE = 1
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            protection: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.protection).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              protection: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })
    })
  })

  function shouldBehaveLike(
    getter: () => {
      order: OrderLocalTester | OrderGlobalTester
      validStoredOrder: OrderStruct
    },
  ) {
    let order: OrderLocalTester | OrderGlobalTester
    let validStoredOrder: OrderStruct

    beforeEach(async () => {
      ;({ order, validStoredOrder } = getter())
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await order.store(validStoredOrder)

        const value = await order.read()
        expect(value.timestamp).to.equal(10)
        expect(value.orders).to.equal(2)
        expect(value.collateral).to.equal(9)
        expect(value.makerReferral).to.equal(11)
        expect(value.takerReferral).to.equal(12)
      })

      context('.timestamp', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            timestamp: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.timestamp).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              timestamp: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.orders', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            orders: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.orders).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              orders: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.collateral', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await order.store({
            ...validStoredOrder,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await order.store({
            ...validStoredOrder,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await order.read()
          expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if collateral out of range (above)', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              collateral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })

        it('reverts if collateral out of range (below)', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.makerReferral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            makerReferral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.makerReferral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              makerReferral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.takerReferral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            takerReferral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.takerReferral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              takerReferral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })
    })

    describe('#ready', () => {
      context('oracleVersion.timestamp > position.timestamp', () => {
        it('returns true', async () => {
          await order.store({ ...DEFAULT_ORDER, timestamp: 2 })
          expect(await order.ready(VALID_ORACLE_VERSION)).to.be.true
        })
      })

      context('position.timestamp = oracleVersion.timestamp', () => {
        it('returns true', async () => {
          await order.store({ ...DEFAULT_ORDER, timestamp: VALID_ORACLE_VERSION.timestamp })
          expect(await order.ready(VALID_ORACLE_VERSION)).to.be.true
        })
      })

      context('oracleVersion.timestamp < position.timestamp', () => {
        it('returns false', async () => {
          await order.store({ ...DEFAULT_ORDER, timestamp: 12346 })
          expect(await order.ready(VALID_ORACLE_VERSION)).to.be.false
        })
      })
    })

    describe('#increasesPosition', () => {
      context('maker increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          })
          const result = await order.increasesPosition()

          expect(result).to.be.true
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          })
          const result = await order.increasesPosition()

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          })
          const result = await order.increasesPosition()

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.increasesPosition()

          expect(result).to.be.false
        })
      })
    })

    describe('#increasesTaker', () => {
      context('maker increase', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          })
          const result = await order.increasesTaker()

          expect(result).to.be.false
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          })
          const result = await order.increasesTaker()

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          })
          const result = await order.increasesTaker()

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.increasesTaker()

          expect(result).to.be.false
        })
      })
    })

    describe('#decreasesLiquidity', () => {
      context('maker reduces', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerNeg: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
          })

          expect(result).to.be.true
        })
      })

      context('maker increases', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
          })

          expect(result).to.be.false
        })
      })

      context('maker equal', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.decreasesLiquidity(DEFAULT_POSITION)

          expect(result).to.be.false
        })
      })

      context('decreases net long', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.false
        })
      })

      context('decreases net short', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.false
        })
      })

      context('increases net long', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longNeg: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('0'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.true
        })
      })

      context('increases net short', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortNeg: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('0'),
          })

          expect(result).to.be.true
        })
      })

      context('equal net', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.false
        })
      })
    })

    describe('#liquidityCheckApplicable', () => {
      context('market is closed', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.liquidityCheckApplicable({
            ...VALID_MARKET_PARAMETER,
            closed: true,
          })

          expect(result).to.be.false
        })
      })

      context('makerCloseAlways is true', () => {
        context('maker increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, makerPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('long increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, longPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('short increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, shortPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('no increase', () => {
          it('returns false', async () => {
            await order.store(DEFAULT_ORDER)
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('maker decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, makerNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('long decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, longNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.false
          })
        })

        context('short decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, shortNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.false
          })
        })
      })

      context('takerCloseAlways is true', () => {
        context('maker increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, makerPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('long increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, longPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('short increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, shortPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('no increase', () => {
          it('returns false', async () => {
            await order.store(DEFAULT_ORDER)
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('maker decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, makerNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('long decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, longNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.false
          })
        })

        context('short decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, shortNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.false
          })
        })
      })

      context('closed, makerCloseAlways, and takerCloseAlways are false', () => {
        context('maker increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, makerPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('long increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, longPos: 10 })
            const result = await order.liquidityCheckApplicable(VALID_MARKET_PARAMETER)

            expect(result).to.be.true
          })
        })

        context('short increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, shortPos: 10 })
            const result = await order.liquidityCheckApplicable(VALID_MARKET_PARAMETER)

            expect(result).to.be.true
          })
        })

        context('no increase', () => {
          it('returns true', async () => {
            await order.store(DEFAULT_ORDER)
            const result = await order.liquidityCheckApplicable(VALID_MARKET_PARAMETER)

            expect(result).to.be.true
          })
        })

        context('maker decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, makerNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            })

            expect(result).to.be.true
          })
        })

        context('long decrease', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, longNeg: 10 })
            const result = await order.liquidityCheckApplicable(VALID_MARKET_PARAMETER)

            expect(result).to.be.true
          })
        })

        context('short decrease', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, shortNeg: 10 })
            const result = await order.liquidityCheckApplicable(VALID_MARKET_PARAMETER)

            expect(result).to.be.true
          })
        })
      })
    })

    describe('#isEmpty', () => {
      context('order is empty', () => {
        it('returns true', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.isEmpty()

          expect(result).to.be.true
        })
      })

      context('order is not empty (makerPos)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (makerNeg)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerNeg: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (longPos)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (longNeg)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longNeg: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (shortPos)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (shortNeg)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortNeg: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })
    })
  }
})
