import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { OrderTester, OrderTester__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { VALID_ORACLE_VERSION } from './Position.test'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { VALID_RISK_PARAMETER } from './RiskParameter.test'
import { DEFAULT_POSITION, DEFAULT_ORDER } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Order', () => {
  let owner: SignerWithAddress

  let order: OrderTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    order = await new OrderTester__factory(owner).deploy()
  })

  describe('#ready', () => {
    context('oracleVersion.timestamp > position.timestamp', () => {
      it('returns true', async () => {
        expect(await order.ready({ ...DEFAULT_ORDER, timestamp: 2 }, VALID_ORACLE_VERSION)).to.be.true
      })
    })

    context('position.timestamp = oracleVersion.timestamp', () => {
      it('returns true', async () => {
        expect(await order.ready({ ...DEFAULT_ORDER, timestamp: VALID_ORACLE_VERSION.timestamp }, VALID_ORACLE_VERSION))
          .to.be.true
      })
    })

    context('oracleVersion.timestamp < position.timestamp', () => {
      it('returns false', async () => {
        expect(await order.ready({ ...DEFAULT_ORDER, timestamp: 12346 }, VALID_ORACLE_VERSION)).to.be.false
      })
    })
  })

  describe('#increasesPosition', () => {
    context('maker increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...DEFAULT_ORDER,
          makerPos: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('long increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...DEFAULT_ORDER,
          longPos: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('short increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...DEFAULT_ORDER,
          shortPos: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('no increase', () => {
      it('returns false', async () => {
        const result = await order.increasesPosition(DEFAULT_ORDER)

        expect(result).to.be.false
      })
    })
  })

  describe('#increasesTaker', () => {
    context('maker increase', () => {
      it('returns false', async () => {
        const result = await order.increasesTaker({
          ...DEFAULT_ORDER,
          makerPos: parse6decimal('10'),
        })

        expect(result).to.be.false
      })
    })

    context('long increase', () => {
      it('returns true', async () => {
        const result = await order.increasesTaker({
          ...DEFAULT_ORDER,
          longPos: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('short increase', () => {
      it('returns true', async () => {
        const result = await order.increasesTaker({
          ...DEFAULT_ORDER,
          shortPos: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('no increase', () => {
      it('returns false', async () => {
        const result = await order.increasesTaker(DEFAULT_ORDER)

        expect(result).to.be.false
      })
    })
  })

  describe('#decreasesLiquidity', () => {
    context('maker reduces', () => {
      it('returns false', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
            makerNeg: parse6decimal('10'),
          },
          {
            ...DEFAULT_POSITION,
          },
        )

        expect(result).to.be.true
      })
    })

    context('maker increases', () => {
      it('returns true', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          },
          {
            ...DEFAULT_POSITION,
          },
        )

        expect(result).to.be.false
      })
    })

    context('maker equal', () => {
      it('returns false', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
          },
          DEFAULT_POSITION,
        )

        expect(result).to.be.false
      })
    })

    context('decreases net long', () => {
      it('returns true', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          },
          {
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          },
        )

        expect(result).to.be.false
      })
    })

    context('decreases net short', () => {
      it('returns true', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          },
          {
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          },
        )

        expect(result).to.be.false
      })
    })

    context('increases net long', () => {
      it('returns true', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
            longNeg: parse6decimal('10'),
          },
          {
            ...DEFAULT_POSITION,
            long: parse6decimal('0'),
            short: parse6decimal('10'),
          },
        )

        expect(result).to.be.true
      })
    })

    context('increases net short', () => {
      it('returns true', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
            shortNeg: parse6decimal('10'),
          },
          {
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('0'),
          },
        )

        expect(result).to.be.true
      })
    })

    context('equal net', () => {
      it('returns true', async () => {
        const result = await order.decreasesLiquidity(
          {
            ...DEFAULT_ORDER,
          },
          {
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          },
        )

        expect(result).to.be.false
      })
    })
  })

  describe('#liquidityCheckApplicable', () => {
    context('market is closed', () => {
      it('returns false', async () => {
        const result = await order.liquidityCheckApplicable(DEFAULT_ORDER, {
          ...VALID_MARKET_PARAMETER,
          closed: true,
        })

        expect(result).to.be.false
      })
    })

    context('makerCloseAlways is true', () => {
      context('maker increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, makerPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, longPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, shortPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(DEFAULT_ORDER, {
            ...VALID_MARKET_PARAMETER,
            takerCloseAlways: true,
          })

          expect(result).to.be.true
        })
      })

      context('maker decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, makerNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('long decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, longNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.false
        })
      })

      context('short decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, shortNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.false
        })
      })
    })

    context('takerCloseAlways is true', () => {
      context('maker increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, makerPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, longPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, shortPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(DEFAULT_ORDER, {
            ...VALID_MARKET_PARAMETER,
            takerCloseAlways: true,
          })

          expect(result).to.be.true
        })
      })

      context('maker decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, makerNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('long decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, longNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.false
        })
      })

      context('short decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, shortNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.false
        })
      })
    })

    context('closed, makerCloseAlways, and takerCloseAlways are false', () => {
      context('maker increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, makerPos: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...DEFAULT_ORDER, longPos: 10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, shortPos: 10 },
            VALID_MARKET_PARAMETER,
          )

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(DEFAULT_ORDER, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('maker decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, makerNeg: 10 },
            {
              ...VALID_MARKET_PARAMETER,
              takerCloseAlways: true,
            },
          )

          expect(result).to.be.true
        })
      })

      context('long decrease', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...DEFAULT_ORDER, longNeg: 10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('short decrease', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...DEFAULT_ORDER, shortNeg: 10 },
            VALID_MARKET_PARAMETER,
          )

          expect(result).to.be.true
        })
      })
    })
  })

  describe('#isEmpty', () => {
    context('order is empty', () => {
      it('returns true', async () => {
        const result = await order.isEmpty(DEFAULT_ORDER)

        expect(result).to.be.true
      })
    })

    context('order is not empty (makerPos)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          makerPos: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (makerNeg)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          makerNeg: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (longPos)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          longPos: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (longNeg)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          longNeg: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (shortPos)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          shortPos: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (shortNeg)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          shortNeg: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })
  })
})
