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
import { PositionStruct } from '../../../types/generated/contracts/Market'

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

const VALID_POSITION: PositionStruct = {
  timestamp: 2,
  maker: 0,
  long: 0,
  short: 0,
  fee: 0,
  keeper: 0,
  collateral: 0,
  delta: 0,
  invalidation: {
    maker: 0,
    long: 0,
    short: 0,
  },
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
              makerMagnitudeFee: parse6decimal('0.02'),
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
              makerMagnitudeFee: parse6decimal('0.02'),
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
              makerMagnitudeFee: parse6decimal('0.02'),
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
              makerMagnitudeFee: parse6decimal('0.02'),
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
                  takerMagnitudeFee: parse6decimal('0.02'),
                  impactFee: parse6decimal('0.03'),
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
                  takerMagnitudeFee: parse6decimal('0.02'),
                  impactFee: parse6decimal('0.03'),
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
                  takerMagnitudeFee: parse6decimal('0.02'),
                  impactFee: parse6decimal('0.03'),
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
                  takerMagnitudeFee: parse6decimal('0.02'),
                  impactFee: parse6decimal('0.03'),
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

  describe('#decreasesLiquidity', () => {
    context('maker > net', () => {
      it('returns false', async () => {
        const result = await order.decreasesLiquidity({
          ...VALID_ORDER,
          maker: parse6decimal('-10'),
          net: parse6decimal('-11'),
        })

        expect(result).to.be.false
      })
    })

    context('maker < net', () => {
      it('returns false', async () => {
        const result = await order.decreasesLiquidity({
          ...VALID_ORDER,
          maker: parse6decimal('10'),
          net: parse6decimal('11'),
        })

        expect(result).to.be.true
      })
    })

    context('maker == net', () => {
      it('returns false', async () => {
        const result = await order.decreasesLiquidity({
          ...VALID_ORDER,
          maker: parse6decimal('10'),
          net: parse6decimal('10'),
        })

        expect(result).to.be.false
      })
    })
  })

  describe('#singleSided', () => {
    context('maker', () => {
      it('maker + maker returns true', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, maker: parse6decimal('-10') },
            { ...VALID_POSITION, maker: parse6decimal('10') },
          ),
        ).to.be.true
      })

      it('maker + long returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, maker: parse6decimal('-10') },
            { ...VALID_POSITION, long: parse6decimal('10') },
          ),
        ).to.be.false
      })

      it('maker + short returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, maker: parse6decimal('-10') },
            { ...VALID_POSITION, short: parse6decimal('10') },
          ),
        ).to.be.false
      })
    })

    context('long', () => {
      it('long + maker returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, long: parse6decimal('-10') },
            { ...VALID_POSITION, maker: parse6decimal('10') },
          ),
        ).to.be.false
      })

      it('long + long returns true', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, long: parse6decimal('-10') },
            { ...VALID_POSITION, long: parse6decimal('10') },
          ),
        ).to.be.true
      })

      it('long + short returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, long: parse6decimal('-10') },
            { ...VALID_POSITION, short: parse6decimal('10') },
          ),
        ).to.be.false
      })
    })

    context('short', () => {
      it('short + maker returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, short: parse6decimal('-10') },
            { ...VALID_POSITION, maker: parse6decimal('10') },
          ),
        ).to.be.false
      })

      it('short + long returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, short: parse6decimal('-10') },
            { ...VALID_POSITION, long: parse6decimal('10') },
          ),
        ).to.be.false
      })

      it('short + short returns true', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, short: parse6decimal('-10') },
            { ...VALID_POSITION, short: parse6decimal('10') },
          ),
        ).to.be.true
      })
    })

    context('2 sides', () => {
      it('maker + long returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, maker: parse6decimal('-10'), long: parse6decimal('-10') },
            { ...VALID_POSITION, maker: parse6decimal('10') },
          ),
        ).to.be.false
      })

      it('long + short returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, long: parse6decimal('-10'), short: parse6decimal('-10') },
            { ...VALID_POSITION, long: parse6decimal('10') },
          ),
        ).to.be.false
      })

      it('short + maker returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, short: parse6decimal('-10'), maker: parse6decimal('-10') },
            { ...VALID_POSITION, short: parse6decimal('10') },
          ),
        ).to.be.false
      })
    })

    context('3 sides', () => {
      it('maker + long returns false', async () => {
        expect(
          await order.singleSided(
            { ...VALID_ORDER, maker: parse6decimal('-10'), long: parse6decimal('-10'), short: parse6decimal('-10') },
            { ...VALID_POSITION, maker: parse6decimal('10') },
          ),
        ).to.be.false
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
      context('maker increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, maker: 10 },
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

          expect(result).to.be.true
        })
      })

      context('maker decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, maker: -10 },
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

    context('takerCloseAlways is true', () => {
      context('maker increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, maker: 10 },
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

          expect(result).to.be.true
        })
      })

      context('maker decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, maker: -10 },
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
      context('maker increase', () => {
        it('returns true', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, maker: 10 },
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

      context('maker decrease', () => {
        it('returns false', async () => {
          const result = await order.liquidityCheckApplicable(
            { ...VALID_ORDER, maker: -10 },
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

  describe('#liquidationFee', () => {
    it('returns notional * riskParameter.maintenance * riskParameter.liquidationFee', async () => {
      expect(
        await order.liquidationFee(
          { ...VALID_ORDER, maker: parse6decimal('-6') },
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
            { ...VALID_ORDER, maker: parse6decimal('-6') },
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
              { ...VALID_ORDER, maker: parse6decimal('-6') },
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
              { ...VALID_ORDER, maker: parse6decimal('-6') },
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
            { ...VALID_ORDER },
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
  })
})
