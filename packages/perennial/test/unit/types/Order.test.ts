import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { OrderTester, OrderTester__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { OrderStruct } from '../../../types/generated/contracts/test/OrderTester'
import { VALID_ORACLE_VERSION } from './Position.test'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { VALID_RISK_PARAMETER } from './RiskParameter.test'

const { ethers } = HRE
use(smock.matchers)

export const VALID_ORDER: OrderStruct = {
  maker: 0,
  long: 0,
  short: 0,
  skew: 0,
  impact: 0,
  efficiency: 0,
  fee: 0,
  keeper: 0,
  utilization: 0,
  net: 0,
}

describe('Order', () => {
  let owner: SignerWithAddress

  let order: OrderTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    order = await new OrderTester__factory(owner).deploy()
  })

  describe('#registerFee', () => {
    describe('maker fees', async () => {
      context('positive change, negative impact (full refund)', () => {
        it('registers fees', async () => {
          const result = await order.registerFee(
            {
              ...VALID_ORDER,
              maker: parse6decimal('10'),
              utilization: parse6decimal('-0.5'),
            },
            {
              ...VALID_ORACLE_VERSION,
              price: parse6decimal('100'),
            },
            {
              ...VALID_MARKET_PARAMETER,
              settlementFee: parse6decimal('12'),
            },
            {
              ...VALID_RISK_PARAMETER,
              makerFee: parse6decimal('0.01'),
              makerImpactFee: parse6decimal('0.02'),
            },
          )

          expect(result.fee).to.eq(parse6decimal('0')) // = 100 * 10 * 0.01 - 100 * 10 * 0.5 * 0.02
          expect(result.keeper).to.eq(parse6decimal('12'))
        })
      })

      context('positive change, negative impact (excess refund)', () => {
        it('registers fees', async () => {
          const result = await order.registerFee(
            {
              ...VALID_ORDER,
              maker: parse6decimal('10'),
              utilization: parse6decimal('-1'),
            },
            {
              ...VALID_ORACLE_VERSION,
              price: parse6decimal('100'),
            },
            {
              ...VALID_MARKET_PARAMETER,
              settlementFee: parse6decimal('12'),
            },
            {
              ...VALID_RISK_PARAMETER,
              makerFee: parse6decimal('0.01'),
              makerImpactFee: parse6decimal('0.02'),
            },
          )

          expect(result.fee).to.eq(parse6decimal('0'))
          expect(result.keeper).to.eq(parse6decimal('12'))
        })
      })

      context('positive change, negative impact (partial refund)', () => {
        it('registers fees', async () => {
          const result = await order.registerFee(
            {
              ...VALID_ORDER,
              maker: parse6decimal('10'),
              utilization: parse6decimal('-0.25'),
            },
            {
              ...VALID_ORACLE_VERSION,
              price: parse6decimal('100'),
            },
            {
              ...VALID_MARKET_PARAMETER,
              settlementFee: parse6decimal('12'),
            },
            {
              ...VALID_RISK_PARAMETER,
              makerFee: parse6decimal('0.01'),
              makerImpactFee: parse6decimal('0.02'),
            },
          )

          expect(result.fee).to.eq(parse6decimal('5')) // = 100 * 10 * 0.01 - 100 * 10 * 0.25 * 0.02
          expect(result.keeper).to.eq(parse6decimal('12'))
        })
      })

      context('negative change, positive impact', () => {
        it('registers fees', async () => {
          const result = await order.registerFee(
            {
              ...VALID_ORDER,
              maker: parse6decimal('-10'),
              utilization: parse6decimal('0.5'),
            },
            {
              ...VALID_ORACLE_VERSION,
              price: parse6decimal('100'),
            },
            {
              ...VALID_MARKET_PARAMETER,
              settlementFee: parse6decimal('12'),
            },
            {
              ...VALID_RISK_PARAMETER,
              makerFee: parse6decimal('0.01'),
              makerImpactFee: parse6decimal('0.02'),
            },
          )

          expect(result.fee).to.eq(parse6decimal('20')) // = 100 * 10 * 0.01 + 100 * 10 * 0.5 * 0.02
          expect(result.keeper).to.eq(parse6decimal('12'))
        })
      })
    })

    describe('taker fees', async () => {
      ;['long', 'short'].forEach(direction => {
        describe(direction, () => {
          context('positive change, positive impact, positive skew', () => {
            it('registers fees', async () => {
              const result = await order.registerFee(
                {
                  ...VALID_ORDER,
                  [direction]: parse6decimal('10'),
                  skew: parse6decimal('0.5'),
                  impact: parse6decimal('0.75'),
                },
                {
                  ...VALID_ORACLE_VERSION,
                  price: parse6decimal('100'),
                },
                {
                  ...VALID_MARKET_PARAMETER,
                  settlementFee: parse6decimal('12'),
                },
                {
                  ...VALID_RISK_PARAMETER,
                  takerFee: parse6decimal('0.01'),
                  takerSkewFee: parse6decimal('0.02'),
                  takerImpactFee: parse6decimal('0.03'),
                },
              )

              expect(result.fee).to.eq(parse6decimal('42.5')) // = 100 * 10 * (0.01 + 0.5 * 0.02 + 0.75 * 0.03)
              expect(result.keeper).to.eq(parse6decimal('12'))
            })
          })

          context('positive change, negative impact, positive skew', () => {
            it('registers fees', async () => {
              const result = await order.registerFee(
                {
                  ...VALID_ORDER,
                  [direction]: parse6decimal('10'),
                  skew: parse6decimal('0.5'),
                  impact: parse6decimal('-0.25'),
                },
                {
                  ...VALID_ORACLE_VERSION,
                  price: parse6decimal('100'),
                },
                {
                  ...VALID_MARKET_PARAMETER,
                  settlementFee: parse6decimal('12'),
                },
                {
                  ...VALID_RISK_PARAMETER,
                  takerFee: parse6decimal('0.01'),
                  takerSkewFee: parse6decimal('0.02'),
                  takerImpactFee: parse6decimal('0.03'),
                },
              )

              expect(result.fee).to.eq(parse6decimal('12.5')) // = 100 * 10 * (0.01 + 0.5 * 0.02 + -0.25 * 0.03)
              expect(result.keeper).to.eq(parse6decimal('12'))
            })
          })

          context('negative change, negative impact, positive skew', () => {
            it('registers fees', async () => {
              const result = await order.registerFee(
                {
                  ...VALID_ORDER,
                  [direction]: parse6decimal('-10'),
                  skew: parse6decimal('0.5'),
                  impact: parse6decimal('-0.25'),
                },
                {
                  ...VALID_ORACLE_VERSION,
                  price: parse6decimal('100'),
                },
                {
                  ...VALID_MARKET_PARAMETER,
                  settlementFee: parse6decimal('12'),
                },
                {
                  ...VALID_RISK_PARAMETER,
                  takerFee: parse6decimal('0.01'),
                  takerSkewFee: parse6decimal('0.02'),
                  takerImpactFee: parse6decimal('0.03'),
                },
              )

              expect(result.fee).to.eq(parse6decimal('12.5')) // = 100 * 10 * (0.01 + 0.5 * 0.02 + -0.25 * 0.03)
              expect(result.keeper).to.eq(parse6decimal('12'))
            })
          })

          context('negative change, positive impact, positive skew', () => {
            it('registers fees', async () => {
              const result = await order.registerFee(
                {
                  ...VALID_ORDER,
                  [direction]: parse6decimal('-10'),
                  skew: parse6decimal('0.5'),
                  impact: parse6decimal('0.25'),
                },
                {
                  ...VALID_ORACLE_VERSION,
                  price: parse6decimal('100'),
                },
                {
                  ...VALID_MARKET_PARAMETER,
                  settlementFee: parse6decimal('12'),
                },
                {
                  ...VALID_RISK_PARAMETER,
                  takerFee: parse6decimal('0.01'),
                  takerSkewFee: parse6decimal('0.02'),
                  takerImpactFee: parse6decimal('0.03'),
                },
              )

              expect(result.fee).to.eq(parse6decimal('27.5')) // = 100 * 10 * (0.01 + 0.5 * 0.02 + 0.25 * 0.03)
              expect(result.keeper).to.eq(parse6decimal('12'))
            })
          })
        })
      })
    })

    describe('empty', () => {
      it('returns 0 settlement', async () => {
        const result = await order.registerFee(
          {
            ...VALID_ORDER,
            maker: 0,
            long: 0,
            short: 0,
          },
          VALID_ORACLE_VERSION,
          {
            ...VALID_MARKET_PARAMETER,
            settlementFee: parse6decimal('12'),
          },
          VALID_RISK_PARAMETER,
        )

        expect(result.keeper).to.eq(0)
      })

      context('offsetting changes', () => {
        it('returns non-0 settlement', async () => {
          const result = await order.registerFee(
            {
              ...VALID_ORDER,
              maker: 10,
              long: -8,
              short: -2,
            },
            VALID_ORACLE_VERSION,
            {
              ...VALID_MARKET_PARAMETER,
              settlementFee: parse6decimal('12'),
            },
            VALID_RISK_PARAMETER,
          )

          expect(result.keeper).to.eq(parse6decimal('12'))
        })
      })
    })
  })

  describe('#increasesPosition', () => {
    context('maker increase', () => {
      it('returns true', async () => {
        const result = await order.increasesPosition({
          ...VALID_ORDER,
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
          ...VALID_ORDER,
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
          ...VALID_ORDER,
          maker: 0,
          long: 0,
          short: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('no increase', () => {
      it('returns false', async () => {
        const result = await order.increasesPosition(VALID_ORDER)

        expect(result).to.be.false
      })
    })
  })

  describe('#increasesTaker', () => {
    context('maker increase', () => {
      it('returns false', async () => {
        const result = await order.increasesTaker({
          ...VALID_ORDER,
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
          ...VALID_ORDER,
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
          ...VALID_ORDER,
          maker: 0,
          long: 0,
          short: parse6decimal('10'),
        })

        expect(result).to.be.true
      })
    })

    context('no increase', () => {
      it('returns false', async () => {
        const result = await order.increasesTaker(VALID_ORDER)

        expect(result).to.be.false
      })
    })
  })

  describe('#liquidityCheckApplicable', () => {
    context('market is closed', () => {
      it('returns false', async () => {
        const result = await order.liquidityCheckApplicable(VALID_ORDER, {
          ...VALID_MARKET_PARAMETER,
          closed: true,
        })

        expect(result).to.be.false
      })
    })

    context('makerCloseAlways is true', () => {
      it('returns false', async () => {
        const result = await order.liquidityCheckApplicable(VALID_ORDER, {
          ...VALID_MARKET_PARAMETER,
          makerCloseAlways: true,
        })

        expect(result).to.be.false
      })
    })

    context('takerCloseAlways is true', () => {
      context('long increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, long: 10 },
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
            { ...VALID_ORDER, short: 10 },
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
          const result = await order.liquidityCheckApplicable(VALID_ORDER, {
            ...VALID_MARKET_PARAMETER,
            takerCloseAlways: true,
          })

          expect(result).to.be.false
        })
      })

      context('long decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, long: -10 },
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
            { ...VALID_ORDER, short: -10 },
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
      context('long increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...VALID_ORDER, long: 10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...VALID_ORDER, short: 10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(VALID_ORDER, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('long decrease', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...VALID_ORDER, long: -10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })

      context('short decrease', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable({ ...VALID_ORDER, short: -10 }, VALID_MARKET_PARAMETER)

          expect(result).to.be.true
        })
      })
    })
  })

  describe('#isEmpty', () => {
    context('order is empty', () => {
      it('returns true', async () => {
        const result = await order.isEmpty(VALID_ORDER)

        expect(result).to.be.true
      })
    })

    context('order is not empty (maker)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...VALID_ORDER,
          maker: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (long)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...VALID_ORDER,
          long: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (short)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...VALID_ORDER,
          short: parse6decimal('1'),
        })

        expect(result).to.be.false
      })
    })

    context('order is not empty (offsetting)', () => {
      it('returns false', async () => {
        const result = await order.isEmpty({
          ...VALID_ORDER,
          maker: parse6decimal('10'),
          long: parse6decimal('-9'),
          short: parse6decimal('-1'),
        })

        expect(result).to.be.false
      })
    })
  })
})
