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

  describe('#increasesPosition', () => {
    context('maker increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...DEFAULT_ORDER,
          maker: parse6decimal('10'),
          long: 0,
          short: 0,
        })

        expect(result).to.be.true
      })
    })

    context('long increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...DEFAULT_ORDER,
          maker: 0,
          long: parse6decimal('10'),
          short: 0,
        })

        expect(result).to.be.true
      })
    })

    context('short increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...DEFAULT_ORDER,
          maker: 0,
          long: 0,
          short: parse6decimal('10'),
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
          maker: parse6decimal('10'),
          long: 0,
          short: 0,
        })

        expect(result).to.be.false
      })
    })

    context('long increase', () => {
      it('returns true', async () => {
        const result = await order.increasesTaker({
          ...DEFAULT_ORDER,
          maker: 0,
          long: parse6decimal('10'),
          short: 0,
        })

        expect(result).to.be.true
      })
    })

    context('short increase', () => {
      it('returns true', async () => {
        const result = await order.increasesTaker({
          ...DEFAULT_ORDER,
          maker: 0,
          long: 0,
          short: parse6decimal('10'),
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
            maker: parse6decimal('-10'),
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
            maker: parse6decimal('10'),
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
            maker: parse6decimal('0'),
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
            long: parse6decimal('10'),
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
            short: parse6decimal('10'),
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
            long: parse6decimal('-10'),
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
            short: parse6decimal('-10'),
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
            { ...DEFAULT_ORDER, maker: 10 },
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
            { ...DEFAULT_ORDER, long: 10 },
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
            { ...DEFAULT_ORDER, short: 10 },
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
            { ...DEFAULT_ORDER, maker: -10 },
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
            { ...DEFAULT_ORDER, long: -10 },
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
            { ...DEFAULT_ORDER, short: -10 },
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
            { ...DEFAULT_ORDER, maker: 10 },
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
            { ...DEFAULT_ORDER, long: 10 },
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
            { ...DEFAULT_ORDER, short: 10 },
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
            { ...DEFAULT_ORDER, maker: -10 },
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
            { ...DEFAULT_ORDER, long: -10 },
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
            { ...DEFAULT_ORDER, short: -10 },
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
            { ...DEFAULT_ORDER, maker: 10 },
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
          const result = await order.liquidityCheckApplicable({ ...DEFAULT_ORDER, long: 10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...DEFAULT_ORDER, short: 10 }, VALID_MARKET_PARAMETER)

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
            { ...DEFAULT_ORDER, maker: -10 },
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
          const result = await order.liquidityCheckApplicable({ ...DEFAULT_ORDER, long: -10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('short decrease', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...DEFAULT_ORDER, short: -10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })
    })
  })

  describe('#liquidationFee', () => {
    it('returns notional * riskParameter.maintenance * riskParameter.liquidationFee', async () => {
      expect(
        await order.liquidationFee(
          { ...DEFAULT_ORDER, maker: parse6decimal('-6') },
          { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
          {
            ...VALID_RISK_PARAMETER,
            maintenance: parse6decimal('0.3'),
            liquidationFee: parse6decimal('0.1'),
            maxLiquidationFee: parse6decimal('1000'),
          },
        ),
      ).to.equal(parse6decimal('18'))
    })

    context('riskParameter.minMaintenance > notional * riskParameter.maintenance', () => {
      it('returns riskParameter.minMaintenance * riskParameter.liquidationFee', async () => {
        expect(
          await order.liquidationFee(
            { ...DEFAULT_ORDER, maker: parse6decimal('-6') },
            { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
            {
              ...VALID_RISK_PARAMETER,
              maintenance: parse6decimal('0.3'),
              minMaintenance: parse6decimal('200'),
              liquidationFee: parse6decimal('0.1'),
              maxLiquidationFee: parse6decimal('1000'),
            },
          ),
        ).to.equal(parse6decimal('20'))
      })
    })

    context(
      'riskParameter.maxLiquidationFee < notional * riskParameter.maintenance * riskParameter.liquidationFee',
      () => {
        it('returns riskParameter.maxLiquidationFee', async () => {
          expect(
            await order.liquidationFee(
              { ...DEFAULT_ORDER, maker: parse6decimal('-6') },
              { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
              {
                ...VALID_RISK_PARAMETER,
                maintenance: parse6decimal('0.3'),
                maxLiquidationFee: parse6decimal('5'),
                liquidationFee: parse6decimal('0.1'),
              },
            ),
          ).to.equal(parse6decimal('5'))
        })
      },
    )

    context(
      'riskParameter.minLiquidationFee > notional * riskParameter.maintenance * riskParameter.liquidationFee',
      () => {
        it('returns riskParameter.minLiquidationFee', async () => {
          expect(
            await order.liquidationFee(
              { ...DEFAULT_ORDER, maker: parse6decimal('-6') },
              { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
              {
                ...VALID_RISK_PARAMETER,
                maintenance: parse6decimal('0.3'),
                minLiquidationFee: parse6decimal('50'),
                liquidationFee: parse6decimal('0.1'),
              },
            ),
          ).to.equal(parse6decimal('50'))
        })
      },
    )

    context('empty order will return no fee', () => {
      it('returns riskParameter.minLiquidationFee', async () => {
        expect(
          await order.liquidationFee(
            { ...DEFAULT_ORDER },
            { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
            {
              ...VALID_RISK_PARAMETER,
              maintenance: parse6decimal('0.3'),
              minLiquidationFee: parse6decimal('50'),
              liquidationFee: parse6decimal('0.1'),
            },
          ),
        ).to.equal(parse6decimal('0'))
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

    context('order is not empty (maker)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          maker: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (long)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          long: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (short)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...DEFAULT_ORDER,
          short: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })
  })
})
