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

const DEFAULT_SYNBOOK = {
  d0: utils.parseUnits('0.001', 6),
  d1: utils.parseUnits('0.002', 6),
  d2: utils.parseUnits('0.004', 6),
  d3: utils.parseUnits('0.008', 6),
  scale: utils.parseUnits('10', 6),
}

const DEFAULT_MATCHING_RESULT = {
  spreadPos: utils.parseUnits('0', 6),
  exposurePos: utils.parseUnits('0', 6),
  spreadNeg: utils.parseUnits('0', 6),
  exposureNeg: utils.parseUnits('0', 6),
  spreadMaker: utils.parseUnits('0', 6),
  spreadPreLong: utils.parseUnits('0', 6),
  spreadPreShort: utils.parseUnits('0', 6),
  spreadCloseLong: utils.parseUnits('0', 6),
  spreadCloseShort: utils.parseUnits('0', 6),
  spreadPostLong: utils.parseUnits('0', 6),
  spreadPostShort: utils.parseUnits('0', 6),
  exposureMakerPos: utils.parseUnits('0', 6),
  exposureMakerNeg: utils.parseUnits('0', 6),
  exposureLongPos: utils.parseUnits('0', 6),
  exposureLongNeg: utils.parseUnits('0', 6),
  exposureShortPos: utils.parseUnits('0', 6),
  exposureShortNeg: utils.parseUnits('0', 6),
}

describe.only('MatchingLib', () => {
  let owner: SignerWithAddress

  let matchingLib: MatchingLibTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    matchingLib = await new MatchingLibTester__factory(owner).deploy()
  })

  describe('#_executeClose()', () => {
    it('executes the order (pos)', async () => {
      const [newOrderbook, newPosition, newResult] = await matchingLib._executeClose(
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
          makerPos: utils.parseUnits('1', 6),
          makerNeg: utils.parseUnits('4', 6),
          longPos: utils.parseUnits('2', 6),
          longNeg: utils.parseUnits('3', 6),
          shortPos: utils.parseUnits('5', 6),
          shortNeg: utils.parseUnits('6', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
        DEFAULT_MATCHING_RESULT,
      )

      expect(newResult.spreadPos).to.equal(utils.parseUnits('0.342528', 6)) // 2 -> 5.2 / 10
      expect(newResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadMaker).to.equal(utils.parseUnits('0.128448', 6)) // 1.2 exp
      expect(newResult.spreadPreLong).to.equal(utils.parseUnits('0.21408', 6)) // 2 exp
      expect(newResult.spreadPreShort).to.equal(utils.parseUnits('0', 6))

      expect(newResult.exposureMakerNeg).to.equal(utils.parseUnits('-0.8', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('6', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('5.2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })

    it('executes the order (neg)', async () => {
      const [newOrderbook, newPosition, newResult] = await matchingLib._executeClose(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('3', 6),
          bid: utils.parseUnits('-2', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('12', 6),
        },
        {
          makerPos: utils.parseUnits('1', 6),
          makerNeg: utils.parseUnits('4', 6),
          longPos: utils.parseUnits('2', 6),
          longNeg: utils.parseUnits('3', 6),
          shortPos: utils.parseUnits('5', 6),
          shortNeg: utils.parseUnits('6', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
        DEFAULT_MATCHING_RESULT,
      )

      expect(newResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadNeg).to.equal(utils.parseUnits('0.342528', 6)) // 2 -> 5.2 / 10
      expect(newResult.spreadMaker).to.equal(utils.parseUnits('0.128448', 6)) // 1.2 exp
      expect(newResult.spreadPreLong).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadPreShort).to.equal(utils.parseUnits('0.21408', 6)) // 2 exp

      expect(newResult.exposureMakerNeg).to.equal(utils.parseUnits('0.8', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('6', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('4', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('12', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('3', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-5.2', 6))
    })
  })

  describe('#_executeTaker()', () => {
    it('executes the order (pos)', async () => {
      const [newOrderbook, newPosition, newResult] = await matchingLib._executeTaker(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('16', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          longPos: utils.parseUnits('12', 6),
          longNeg: utils.parseUnits('4', 6),
          shortPos: utils.parseUnits('4', 6),
          shortNeg: utils.parseUnits('12', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
        DEFAULT_MATCHING_RESULT,
      )

      const spreadMakerPos = utils.parseUnits('195.63642', 6) // 20 exp
      const spreadMakerNeg = utils.parseUnits('0', 6) // 20 exp

      expect(newResult.spreadPos).to.equal(utils.parseUnits('205.418241', 6)) // 2 -> 23 / 10
      expect(newResult.spreadNeg).to.equal(utils.parseUnits('2.621376', 6)) // -3 -> -9
      expect(newResult.spreadMaker).to.equal(spreadMakerPos.add(spreadMakerNeg))

      expect(newResult.spreadPreLong).to.equal(utils.parseUnits('4.890910', 6)) // 0.5 exp
      expect(newResult.spreadCloseShort).to.equal(utils.parseUnits('4.890910', 6)) // 0.5 exp
      expect(newResult.spreadCloseLong).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadPreShort).to.equal(utils.parseUnits('2.621376', 6)) // 6 exp

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('8', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('23', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-9', 6))
    })
  })

  describe('#_executeOpen()', () => {
    it('executes the order (neg)', async () => {
      const [newOrderbook, newPosition, newResult] = await matchingLib._executeOpen(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('6', 6),
          long: utils.parseUnits('12', 6),
          short: utils.parseUnits('4', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          makerPos: utils.parseUnits('4', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
        DEFAULT_MATCHING_RESULT,
      )

      expect(newResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadNeg).to.equal(utils.parseUnits('0.462675', 6)) // -3 -> -6.2 / 10 (rounding error -1)
      expect(newResult.spreadMaker).to.equal(utils.parseUnits('0.173503', 6)) // 2 exp
      expect(newResult.spreadPostLong).to.equal(utils.parseUnits('0.289171', 6)) // 1.2 exp
      expect(newResult.spreadPostShort).to.equal(utils.parseUnits('0', 6))

      expect(newResult.exposureMakerPos).to.equal(utils.parseUnits('-0.8', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-6.2', 6))
    })

    it('executes the order (pos)', async () => {
      const [newOrderbook, newPosition, newResult] = await matchingLib._executeOpen(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('3', 6),
          bid: utils.parseUnits('-2', 6),
        },
        {
          maker: utils.parseUnits('6', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('12', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          makerPos: utils.parseUnits('4', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
        DEFAULT_MATCHING_RESULT,
      )

      expect(newResult.spreadPos).to.equal(utils.parseUnits('0.462675', 6)) // -3 -> -6.2 / 10 (rounding error -1)
      expect(newResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadMaker).to.equal(utils.parseUnits('0.173503', 6)) // 2 exp
      expect(newResult.spreadPostLong).to.equal(utils.parseUnits('0', 6))
      expect(newResult.spreadPostShort).to.equal(utils.parseUnits('0.289171', 6)) // 1.2 exp

      expect(newResult.exposureMakerPos).to.equal(utils.parseUnits('0.8', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('4', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('12', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('6.2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-2', 6))
    })
  })

  describe('#_fill()', () => {
    it('fills the order (empty)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('0', 6),
          ask: utils.parseUnits('0', 6),
          bid: utils.parseUnits('0', 6),
        },
        {
          maker: utils.parseUnits('0', 6),
          long: utils.parseUnits('0', 6),
          short: utils.parseUnits('0', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('0', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('0', 6))

      expect(exposure).to.equal(utils.parseUnits('0', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('0', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('0', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('0', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('0', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('0', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('0', 6))
    })

    it('fills the order (maker ask)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
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
          ...DEFAULT_MATCHING_ORDER,
          makerNeg: utils.parseUnits('2', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0.065245', 6)) // 2 -> 3.6 / 10
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.065245', 6)) // all to maker
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('1.6', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('8', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('3.6', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })

    it('fills the order (maker ask socialized)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
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
          ...DEFAULT_MATCHING_ORDER,
          makerNeg: utils.parseUnits('4', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0.342528', 6)) // 2 -> 5.2 / 10
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.128448', 6)) // 1.2 exp
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0.21408', 6)) // 2 exp
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('0.833333', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('3.2', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('6', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('5.2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })

    it('fills the order (taker ask)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
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
          ...DEFAULT_MATCHING_ORDER,
          longPos: utils.parseUnits('1', 6),
          shortNeg: utils.parseUnits('1', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0.108896', 6)) // 2 -> 4 / 10
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.108896', 6)) // all to maker
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('2', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('13', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('3', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('4', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })

    it('fills the order (taker ask socialized)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
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
          ...DEFAULT_MATCHING_ORDER,
          longPos: utils.parseUnits('2', 6),
          shortNeg: utils.parseUnits('2', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0.505337', 6)) // 2 -> 5.714286 / 10 (rounding error -1)
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.272104', 6)) // 2 exp
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0.233232', 6)) // 1.714285 exp
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('0.857142', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('3.714286', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('14', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('2', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('5.714286', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })

    it('fills the order (taker ask socialized both)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('16', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          longPos: utils.parseUnits('12', 6),
          shortNeg: utils.parseUnits('12', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('205.418241', 6)) // 2 -> 23 / 10
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('195.63642', 6)) // 20 exp
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('4.890910', 6)) // 0.5 exp
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('4.890910', 6)) // 0.5 exp

      expect(exposureClose.maker).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-0.875', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('0.875', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('21', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('16', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('23', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-3', 6))
    })

    it('fills the order (maker bid)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
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
          ...DEFAULT_MATCHING_ORDER,
          makerPos: utils.parseUnits('2', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0.058698', 6)) // -3 -> -4.333334 / 10 (rounding error -2)
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.058698', 6)) // all to maker
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.666666', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('-1.333334', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-4.333334', 6))
    })

    it('fills the order (maker bid socialized)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('6', 6),
          long: utils.parseUnits('12', 6),
          short: utils.parseUnits('4', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          makerPos: utils.parseUnits('4', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0.462675', 6)) // -3 -> -6.2 / 10 (rounding error -1)
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.173503', 6)) // 2 exp
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0.289171', 6)) // 1.2 exp
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('0.833333', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.8', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('-3.2', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('12', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('4', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-6.2', 6))
    })

    it('fills the order (taker bid)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('12', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          shortPos: utils.parseUnits('1', 6),
          longNeg: utils.parseUnits('1', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0.147469', 6)) // -3 -> -5 / 10
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.147469', 6)) // all to maker
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0', 6))

      expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposure).to.equal(utils.parseUnits('-2', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('3', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('13', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-5', 6))
    })

    it('fills the order (taker bid socialized)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('4', 6),
          short: utils.parseUnits('12', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          shortPos: utils.parseUnits('2', 6),
          longNeg: utils.parseUnits('2', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('0.680762', 6)) // -3 -> -6.714286 / 10 (rounding error -1)
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('0.366564', 6)) // 2 exp
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('0.314197', 6)) // 1.314197 exp

      expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-0.857142', 6))

      expect(exposure).to.equal(utils.parseUnits('-3.714286', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('2', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('14', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-6.714286', 6))
    })

    it('fills the order (taker bid socialized both)', async () => {
      const [fillResult, exposureClose, exposureOpen, exposure, newOrderbook, newPosition] = await matchingLib._fill(
        {
          midpoint: utils.parseUnits('1', 6),
          ask: utils.parseUnits('2', 6),
          bid: utils.parseUnits('-3', 6),
        },
        {
          maker: utils.parseUnits('10', 6),
          long: utils.parseUnits('16', 6),
          short: utils.parseUnits('4', 6),
        },
        {
          ...DEFAULT_MATCHING_ORDER,
          shortPos: utils.parseUnits('12', 6),
          longNeg: utils.parseUnits('12', 6),
        },
        DEFAULT_SYNBOOK,
        utils.parseUnits('123', 6),
      )

      expect(fillResult.spreadPos).to.equal(utils.parseUnits('0', 6))
      expect(fillResult.spreadNeg).to.equal(utils.parseUnits('238.940415', 6)) // -3 -> -24 / 10 (rounding error -1)
      expect(fillResult.spreadMaker).to.equal(utils.parseUnits('227.5623', 6)) // 20 exp
      expect(fillResult.spreadLong).to.equal(utils.parseUnits('5.689057', 6)) // 0.5 exp
      expect(fillResult.spreadShort).to.equal(utils.parseUnits('5.689057', 6)) // 0.5 exp

      expect(exposureClose.maker).to.equal(utils.parseUnits('-1.0', 6))
      expect(exposureClose.long).to.equal(utils.parseUnits('0.875', 6))
      expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

      expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
      expect(exposureOpen.short).to.equal(utils.parseUnits('-0.875', 6))

      expect(exposure).to.equal(utils.parseUnits('-21', 6))

      expect(newPosition.maker).to.equal(utils.parseUnits('10', 6))
      expect(newPosition.long).to.equal(utils.parseUnits('4', 6))
      expect(newPosition.short).to.equal(utils.parseUnits('16', 6))

      expect(newOrderbook.midpoint).to.equal(utils.parseUnits('1', 6))
      expect(newOrderbook.ask).to.equal(utils.parseUnits('2', 6))
      expect(newOrderbook.bid).to.equal(utils.parseUnits('-24', 6))
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

  describe('#_match(position, order)', () => {
    context('empty', () => {
      it('returns the correct change in exposure (no positions)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('0', 6),
            long: utils.parseUnits('0', 6),
            short: utils.parseUnits('0', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
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
    })

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

    context('taker pos', () => {
      context('longPos', () => {
        it('returns the correct change in exposure (no position)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('0', 6),
              short: utils.parseUnits('0', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('0.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('0.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.6', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.875', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('-1.5', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (short to long socialization)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('16', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longPos: utils.parseUnits('24', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-0.875', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.928571', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-20.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('-0.285715', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('-2.0', 6))
        })
      })

      context('shortNeg', () => {
        it('returns the correct change in exposure (zero skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              shortNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              shortNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.6', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              shortNeg: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.833333', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('0.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (short to long socialization)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('16', 6),
              short: utils.parseUnits('28', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortNeg: utils.parseUnits('24', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-0.928571', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.875', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-20.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('-0.285715', 6))
        })

        it('returns the correct change in exposure (zero skew full close)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortNeg: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.4', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('0.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-4.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
        })
      })

      context('longPos / shortNeg', () => {
        it('returns the correct change in exposure (zero skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longPos: utils.parseUnits('1', 6),
              shortNeg: utils.parseUnits('1', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('1', 6),
              shortNeg: utils.parseUnits('1', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('1', 6),
              shortNeg: utils.parseUnits('1', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.6', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longPos: utils.parseUnits('2', 6),
              shortNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.857142', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('-1.714286', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (short to long socialization)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('16', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longPos: utils.parseUnits('12', 6),
              shortNeg: utils.parseUnits('12', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-0.875', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.875', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-20.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('-0.5', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('-0.5', 6))
        })

        it('returns the correct change in exposure (full close / open)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('0', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longPos: utils.parseUnits('4', 6),
              shortNeg: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.4', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.4', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('0.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('-8.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
        })
      })
    })

    context('taker neg', () => {
      context('shortPos', () => {
        it('returns the correct change in exposure (no position)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('0', 6),
              short: utils.parseUnits('0', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('0.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              shortPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (long skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (short skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.6', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              shortPos: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-0.875', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('1.5', 6))
        })

        it('returns the correct change in exposure (long to short socialization)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('16', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('24', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('0.875', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-0.928571', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('20.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.285715', 6))
        })
      })

      context('longNeg', () => {
        it('returns the correct change in exposure (zero skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (long skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (short skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.6', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              longNeg: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-0.833333', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('2.0', 6))
        })

        it('returns the correct change in exposure (long to short socialization)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('28', 6),
              short: utils.parseUnits('16', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longNeg: utils.parseUnits('24', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('0.928571', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-0.875', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('20.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.285715', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('2.0', 6))
        })

        it('returns the correct change in exposure (zero skew full close)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              longNeg: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.4', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('4.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
        })
      })

      context('shortPos / longNeg', () => {
        it('returns the correct change in exposure (zero skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('1', 6),
              longNeg: utils.parseUnits('1', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.2', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (long skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('12', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('1', 6),
              longNeg: utils.parseUnits('1', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
        })

        it('returns the correct change in exposure (short skew)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('12', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('1', 6),
              longNeg: utils.parseUnits('1', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.6', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
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
              shortPos: utils.parseUnits('2', 6),
              longNeg: utils.parseUnits('2', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-0.857142', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('2.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('1.714286', 6))
        })

        it('returns the correct change in exposure (long to short socialization)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('16', 6),
              short: utils.parseUnits('4', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('12', 6),
              longNeg: utils.parseUnits('12', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-1.0', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('0.875', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-0.875', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('20.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0.5', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0.5', 6))
        })

        it('returns the correct change in exposure (full close / open)', async () => {
          const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
            {
              maker: utils.parseUnits('10', 6),
              long: utils.parseUnits('4', 6),
              short: utils.parseUnits('0', 6),
            },
            {
              ...DEFAULT_MATCHING_ORDER,
              shortPos: utils.parseUnits('4', 6),
              longNeg: utils.parseUnits('4', 6),
            },
          )

          expect(exposureClose.maker).to.equal(utils.parseUnits('-0.4', 6))
          expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
          expect(exposureClose.short).to.equal(utils.parseUnits('-0.0', 6))

          expect(exposureOpen.maker).to.equal(utils.parseUnits('0.4', 6))
          expect(exposureOpen.long).to.equal(utils.parseUnits('0.0', 6))
          expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

          expect(exposureFilled.maker).to.equal(utils.parseUnits('8.0', 6))
          expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
          expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
        })
      })
    })

    context('maker open', () => {
      it('returns the correct change in exposure (no positions)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('10', 6),
            long: utils.parseUnits('0', 6),
            short: utils.parseUnits('0', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('2', 6),
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
            makerPos: utils.parseUnits('2', 6),
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
            makerPos: utils.parseUnits('2', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('-0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.666666', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('1.333334', 6))
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
            makerPos: utils.parseUnits('2', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.8', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.666666', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('-1.333334', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (from long socialization)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('6', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('4', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('4', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('-1.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('0.833333', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.8', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('1.2', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('2.0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0', 6))
      })

      it('returns the correct change in exposure (from short socialization)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('6', 6),
            long: utils.parseUnits('4', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('4', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-0.833333', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.8', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('-1.2', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('-2.0', 6))
      })

      it('returns the correct change in exposure (no positions from zero)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('0', 6),
            long: utils.parseUnits('0', 6),
            short: utils.parseUnits('0', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('10', 6),
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

      it('returns the correct change in exposure (zero skew from zero)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('0', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('10', 6),
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

      it('returns the correct change in exposure (long skew from zero)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('0', 6),
            long: utils.parseUnits('12', 6),
            short: utils.parseUnits('4', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('10', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('0.333333', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('-0.8', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('8.0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('0.0', 6))
      })

      it('returns the correct change in exposure (short skew from zero)', async () => {
        const [exposureClose, exposureOpen, exposureFilled] = await matchingLib._match(
          {
            maker: utils.parseUnits('0', 6),
            long: utils.parseUnits('4', 6),
            short: utils.parseUnits('12', 6),
          },
          {
            ...DEFAULT_MATCHING_ORDER,
            makerPos: utils.parseUnits('10', 6),
          },
        )

        expect(exposureClose.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureClose.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureClose.short).to.equal(utils.parseUnits('-0.333333', 6))

        expect(exposureOpen.maker).to.equal(utils.parseUnits('0.8', 6))
        expect(exposureOpen.long).to.equal(utils.parseUnits('1.0', 6))
        expect(exposureOpen.short).to.equal(utils.parseUnits('-1.0', 6))

        expect(exposureFilled.maker).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureFilled.long).to.equal(utils.parseUnits('0.0', 6))
        expect(exposureFilled.short).to.equal(utils.parseUnits('-8.0', 6))
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

  describe('#_sub(exposure, exposure)', () => {
    it('returns the correct change in expsoure', async () => {
      const exposure = await matchingLib._sub(
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

      expect(exposure.maker).to.equal(utils.parseUnits('-3', 6))
      expect(exposure.long).to.equal(utils.parseUnits('-6', 6))
      expect(exposure.short).to.equal(utils.parseUnits('9', 6))
    })
  })

  describe('#_mul(exposure, position)', () => {
    it('returns the correct change in expsoure', async () => {
      const exposure = await matchingLib._mul(
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

      expect(exposure.maker).to.equal(utils.parseUnits('10', 6))
      expect(exposure.long).to.equal(utils.parseUnits('-10', 6))
      expect(exposure.short).to.equal(utils.parseUnits('12', 6))
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
