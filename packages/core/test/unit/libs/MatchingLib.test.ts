import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { MatchingLibTester, MatchingLibTester__factory } from '../../../types/generated'
import { BigNumber, utils } from 'ethers'

const { ethers } = HRE
use(smock.matchers)

const DEFAULT_MATCHING_ORDER = {
  makerPos: utils.parseUnits('0', 6),
  makerNeg: utils.parseUnits('0', 6),
  longPos: utils.parseUnits('0', 6),
  longNeg: utils.parseUnits('0', 6),
  shortPos: utils.parseUnits('0', 6),
  shortNeg: utils.parseUnits('0', 6),
}

describe.only('MatchingLib', () => {
  let owner: SignerWithAddress

  let matchingLib: MatchingLibTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    matchingLib = await new MatchingLibTester__factory(owner).deploy()
  })

  describe('#_fill()', () => {
    it('fills the order (makerNeg)', async () => {
      const [fillResult, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('12', 6),
          short: utils.parseUnits('4', 6),
        },
        {
          makerPos: utils.parseUnits('0', 6),
          makerNeg: utils.parseUnits('2', 6),
          longPos: utils.parseUnits('0', 6),
          longNeg: utils.parseUnits('0', 6),
          shortPos: utils.parseUnits('0', 6),
          shortNeg: utils.parseUnits('0', 6),
        },
        {
          d0: utils.parseUnits('0.001', 6),
          d1: utils.parseUnits('0.002', 6),
          d2: utils.parseUnits('0.004', 6),
          d3: utils.parseUnits('0.008', 6),
          scale: utils.parseUnits('100', 6),
        },
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0.003335', 6)) // 2 -> 3.6 / 100
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.003335', 6)) // all to maker
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('8', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('3.6', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })
  })

  describe('#_skew(position)', () => {
    it('returns correct skew (zero)', async () => {
      const skew = await matchingLib['_skew((uint256,uint256,uint256))']({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('10', 6),
        short: utils.parseUnits('10', 6),
      })

      expect(skew).to.equal(utils.parseUnits('0', 6))
    })

    it('returns correct skew (positive)', async () => {
      const skew = await matchingLib['_skew((uint256,uint256,uint256))']({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('10', 6),
        short: utils.parseUnits('5', 6),
      })

      expect(skew).to.equal(utils.parseUnits('5', 6))
    })

    it('returns correct skew (negative)', async () => {
      const skew = await matchingLib['_skew((uint256,uint256,uint256))']({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('5', 6),
        short: utils.parseUnits('10', 6),
      })

      expect(skew).to.equal(utils.parseUnits('-5', 6))
    })
  })

  describe('#_skew(exposure)', () => {
    it('returns correct skew (zero)', async () => {
      const skew = await matchingLib['_skew((int256,int256,int256))']({
        maker: utils.parseUnits('0', 6),
        long: utils.parseUnits('0', 6),
        short: utils.parseUnits('0', 6),
      })

      expect(skew).to.equal(utils.parseUnits('0', 6))
    })

    it('returns correct skew (positive)', async () => {
      const skew = await matchingLib['_skew((int256,int256,int256))']({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('10', 6),
        short: utils.parseUnits('5', 6),
      })

      expect(skew).to.equal(utils.parseUnits('25', 6))
    })

    it('returns correct skew (negative)', async () => {
      const skew = await matchingLib['_skew((int256,int256,int256))']({
        maker: utils.parseUnits('-10', 6),
        long: utils.parseUnits('-5', 6),
        short: utils.parseUnits('-10', 6),
      })

      expect(skew).to.equal(utils.parseUnits('-25', 6))
    })
  })

  describe('#_position(position)', () => {
    it('returns copy', async () => {
      const position = await matchingLib._position({
        maker: utils.parseUnits('1', 6),
        long: utils.parseUnits('2', 6),
        short: utils.parseUnits('3', 6),
      })

      expect(position.maker).to.equal(utils.parseUnits('1', 6))
      expect(position.long).to.equal(utils.parseUnits('2', 6))
      expect(position.short).to.equal(utils.parseUnits('3', 6))
    })
  })

  describe('#_orderbook(orderbook)', () => {
    it('returns copy', async () => {
      const orderbook = await matchingLib['_orderbook((int256,int256,int256))']({
        midpoint: utils.parseUnits('1', 6),
        ask: utils.parseUnits('2', 6),
        bid: utils.parseUnits('-3', 6),
      })

      expect(orderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })
  })

  describe('#_apply(orderbook, exposure)', () => {
    it('properly updated orderbook (zero)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),(int256,int256,int256))'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        {
          maker: utils.parseUnits('0', 6),
          long: utils.parseUnits('0', 6),
          short: utils.parseUnits('0', 6),
        },
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('11', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('8', 6))
    })

    it('properly updated orderbook (asks)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),(int256,int256,int256))'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        {
          maker: utils.parseUnits('1', 6),
          long: utils.parseUnits('2', 6),
          short: utils.parseUnits('3', 6),
        },
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('17', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('8', 6))
    })

    it('properly updated orderbook (bids)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),(int256,int256,int256))'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        {
          maker: utils.parseUnits('-1', 6),
          long: utils.parseUnits('-2', 6),
          short: utils.parseUnits('-3', 6),
        },
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('11', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('2', 6))
    })

    it('properly updated orderbook (both)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),(int256,int256,int256))'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        {
          maker: utils.parseUnits('-1', 6),
          long: utils.parseUnits('2', 6),
          short: utils.parseUnits('-3', 6),
        },
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('13', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('4', 6))
    })
  })

  describe('#_apply(orderbook, side)', () => {
    it('properly updated orderbook (zero)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),int256)'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        utils.parseUnits('0', 6),
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('11', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('8', 6))
    })

    it('properly updated orderbook (asks)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),int256)'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        utils.parseUnits('6', 6),
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('17', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('8', 6))
    })

    it('properly updated orderbook (bids)', async () => {
      const orderbook = await matchingLib['_apply((int256,int256,int256),int256)'](
        {
          midpoint: utils.parseUnits('10', 6),
          ask: utils.parseUnits('11', 6),
          bid: utils.parseUnits('8', 6),
        },
        utils.parseUnits('-6', 6),
      )

      expect(orderbook.midpoint).to.equal(utils.parseUnits('10', 6))
      expect(orderbook.ask).to.equal(utils.parseUnits('11', 6))
      expect(orderbook.bid).to.equal(utils.parseUnits('2', 6))
    })
  })

  describe('#_flip(exposure)', () => {
    it('returns correct exposure', async () => {
      const exposure = await matchingLib._flip({
        maker: utils.parseUnits('-1', 6),
        long: utils.parseUnits('2', 6),
        short: utils.parseUnits('-3', 6),
      })

      expect(exposure.maker).to.equal(utils.parseUnits('1', 6))
      expect(exposure.long).to.equal(utils.parseUnits('-2', 6))
      expect(exposure.short).to.equal(utils.parseUnits('3', 6))
    })
  })

  describe('#_extractMakerClose(order)', () => {
    it('extracts correct order', async () => {
      const order = await matchingLib._extractMakerClose({
        makerPos: utils.parseUnits('1', 6),
        makerNeg: utils.parseUnits('2', 6),
        longPos: utils.parseUnits('3', 6),
        longNeg: utils.parseUnits('4', 6),
        shortPos: utils.parseUnits('5', 6),
        shortNeg: utils.parseUnits('6', 6),
      })

      expect(order.makerPos).to.equal(utils.parseUnits('0', 6))
      expect(order.makerNeg).to.equal(utils.parseUnits('2', 6))
      expect(order.longPos).to.equal(utils.parseUnits('0', 6))
      expect(order.longNeg).to.equal(utils.parseUnits('0', 6))
      expect(order.shortPos).to.equal(utils.parseUnits('0', 6))
      expect(order.shortNeg).to.equal(utils.parseUnits('0', 6))
    })
  })

  describe('#_extractTakerPos(order)', () => {
    it('extracts correct order', async () => {
      const order = await matchingLib._extractTakerPos({
        makerPos: utils.parseUnits('1', 6),
        makerNeg: utils.parseUnits('2', 6),
        longPos: utils.parseUnits('3', 6),
        longNeg: utils.parseUnits('4', 6),
        shortPos: utils.parseUnits('5', 6),
        shortNeg: utils.parseUnits('6', 6),
      })

      expect(order.makerPos).to.equal(utils.parseUnits('0', 6))
      expect(order.makerNeg).to.equal(utils.parseUnits('0', 6))
      expect(order.longPos).to.equal(utils.parseUnits('3', 6))
      expect(order.longNeg).to.equal(utils.parseUnits('0', 6))
      expect(order.shortPos).to.equal(utils.parseUnits('0', 6))
      expect(order.shortNeg).to.equal(utils.parseUnits('6', 6))
    })
  })

  describe('#_extractTakerNeg(order)', () => {
    it('extracts correct order', async () => {
      const order = await matchingLib._extractTakerNeg({
        makerPos: utils.parseUnits('1', 6),
        makerNeg: utils.parseUnits('2', 6),
        longPos: utils.parseUnits('3', 6),
        longNeg: utils.parseUnits('4', 6),
        shortPos: utils.parseUnits('5', 6),
        shortNeg: utils.parseUnits('6', 6),
      })

      expect(order.makerPos).to.equal(utils.parseUnits('0', 6))
      expect(order.makerNeg).to.equal(utils.parseUnits('0', 6))
      expect(order.longPos).to.equal(utils.parseUnits('0', 6))
      expect(order.longNeg).to.equal(utils.parseUnits('4', 6))
      expect(order.shortPos).to.equal(utils.parseUnits('5', 6))
      expect(order.shortNeg).to.equal(utils.parseUnits('0', 6))
    })
  })

  describe('#_extractMakerOpen(order)', () => {
    it('extracts correct order', async () => {
      const order = await matchingLib._extractMakerOpen({
        makerPos: utils.parseUnits('1', 6),
        makerNeg: utils.parseUnits('2', 6),
        longPos: utils.parseUnits('3', 6),
        longNeg: utils.parseUnits('4', 6),
        shortPos: utils.parseUnits('5', 6),
        shortNeg: utils.parseUnits('6', 6),
      })

      expect(order.makerPos).to.equal(utils.parseUnits('1', 6))
      expect(order.makerNeg).to.equal(utils.parseUnits('0', 6))
      expect(order.longPos).to.equal(utils.parseUnits('0', 6))
      expect(order.longNeg).to.equal(utils.parseUnits('0', 6))
      expect(order.shortPos).to.equal(utils.parseUnits('0', 6))
      expect(order.shortNeg).to.equal(utils.parseUnits('0', 6))
    })
  })

  describe('#_extractClose(order)', () => {
    it('extracts correct order', async () => {
      const order = await matchingLib._extractClose({
        makerPos: utils.parseUnits('1', 6),
        makerNeg: utils.parseUnits('2', 6),
        longPos: utils.parseUnits('3', 6),
        longNeg: utils.parseUnits('4', 6),
        shortPos: utils.parseUnits('5', 6),
        shortNeg: utils.parseUnits('6', 6),
      })

      expect(order.makerPos).to.equal(utils.parseUnits('0', 6))
      expect(order.makerNeg).to.equal(utils.parseUnits('2', 6))
      expect(order.longPos).to.equal(utils.parseUnits('0', 6))
      expect(order.longNeg).to.equal(utils.parseUnits('4', 6))
      expect(order.shortPos).to.equal(utils.parseUnits('0', 6))
      expect(order.shortNeg).to.equal(utils.parseUnits('6', 6))
    })
  })

  describe('#_apply(position, order)', () => {
    it('correctly updates the position', async () => {
      const position = await matchingLib[
        '_apply((uint256,uint256,uint256),(uint256,uint256,uint256,uint256,uint256,uint256))'
      ](
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('6', 6),
          short: utils.parseUnits('12', 6),
        },
        {
          makerPos: utils.parseUnits('1', 6),
          makerNeg: utils.parseUnits('2', 6),
          longPos: utils.parseUnits('3', 6),
          longNeg: utils.parseUnits('5', 6),
          shortPos: utils.parseUnits('8', 6),
          shortNeg: utils.parseUnits('4', 6),
        },
      )

      expect(position.maker).to.equal(utils.parseUnits('9', 6))
      expect(position.long).to.equal(utils.parseUnits('4', 6))
      expect(position.short).to.equal(utils.parseUnits('16', 6))
    })
  })

  describe('#_exposure(position)', () => {
    it('correctly updates the position (zero)', async () => {
      const exposure = await matchingLib._exposure({
        maker: utils.parseUnits('0', 6),
        long: utils.parseUnits('0', 6),
        short: utils.parseUnits('0', 6),
      })

      expect(exposure.maker).to.equal(utils.parseUnits('0', 6))
      expect(exposure.long).to.equal(utils.parseUnits('0', 6))
      expect(exposure.short).to.equal(utils.parseUnits('0', 6))
    })

    it('correctly updates the position (long skew)', async () => {
      const exposure = await matchingLib._exposure({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('12', 6),
        short: utils.parseUnits('6', 6),
      })

      expect(exposure.maker).to.equal(utils.parseUnits('-6', 6))
      expect(exposure.long).to.equal(utils.parseUnits('12', 6))
      expect(exposure.short).to.equal(utils.parseUnits('-6', 6))
    })

    it('correctly updates the position (short skew)', async () => {
      const exposure = await matchingLib._exposure({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('6', 6),
        short: utils.parseUnits('12', 6),
      })

      expect(exposure.maker).to.equal(utils.parseUnits('6', 6))
      expect(exposure.long).to.equal(utils.parseUnits('6', 6))
      expect(exposure.short).to.equal(utils.parseUnits('-12', 6))
    })

    it('correctly updates the position (long skew socialization)', async () => {
      const exposure = await matchingLib._exposure({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('18', 6),
        short: utils.parseUnits('6', 6),
      })

      expect(exposure.maker).to.equal(utils.parseUnits('-10', 6))
      expect(exposure.long).to.equal(utils.parseUnits('16', 6))
      expect(exposure.short).to.equal(utils.parseUnits('-6', 6))
    })

    it('correctly updates the position (short skew socialization)', async () => {
      const exposure = await matchingLib._exposure({
        maker: utils.parseUnits('10', 6),
        long: utils.parseUnits('6', 6),
        short: utils.parseUnits('18', 6),
      })

      expect(exposure.maker).to.equal(utils.parseUnits('10', 6))
      expect(exposure.long).to.equal(utils.parseUnits('6', 6))
      expect(exposure.short).to.equal(utils.parseUnits('-16', 6))
    })
  })

  describe.only('#_match(position, order)', () => {
    context('maker close', () => {
      it('returns the correct change in exposure (no positions)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('0', 6),
            short: utils.parseUnits('0', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('2', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-0.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-0.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (zero skew)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('2', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (long skew)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('4', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('2', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('-1.6', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (short skew)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('4', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('2', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('1.6', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (to long socialization)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('4', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('4', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('0.833333', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('-1.2', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('-2.0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (to short socialization)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('4', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('4', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-0.833333', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('1.2', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('2.0', 6))
      })

      it('returns the correct change in exposure (no positions full close)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('0', 6),
            short: utils.parseUnits('0', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('10', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-0.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-0.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (zero skew full close)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('10', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (long skew full close)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('4', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('10', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('0.333333', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('-8.0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (short skew full close)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('4', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerNeg: utils.parseUnits('10', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-0.333333', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('8.0', 6))
      })
    })
  })

  describe('#_add(exposure, exposure)', () => {
    it('returns the correct change in expsoure', async () => {
      const exposure = await matchingLib._add(
        {
          maker: utils.parseUnits('1', 6),
          long: utils.parseUnits('-2', 6),
          short: utils.parseUnits('3', 6),
        },
        {
          maker: utils.parseUnits('4', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('-6', 6),
        },
      )

      expect(exposure.maker).to.equal(utils.parseUnits('5', 6))
      expect(exposure.long).to.equal(utils.parseUnits('2', 6))
      expect(exposure.short).to.equal(utils.parseUnits('-3', 6))
    })
  })

  describe('#_div(exposure, position)', () => {
    it('returns the correct change in expsoure', async () => {
      const exposure = await matchingLib._div(
        {
          maker: utils.parseUnits('1', 6),
          long: utils.parseUnits('-2', 6),
          short: utils.parseUnits('3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('5', 6),
          short: utils.parseUnits('4', 6),
        },
      )

      expect(exposure.maker).to.equal(utils.parseUnits('0.1', 6))
      expect(exposure.long).to.equal(utils.parseUnits('-0.4', 6))
      expect(exposure.short).to.equal(utils.parseUnits('0.75', 6))
    })
  })
})
