import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { DedupTester, DedupTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

function toByteArray(ids: number[]): string[] {
  return ids.map(id => ethers.utils.hexZeroPad(BigNumber.from(id).toHexString(), 32))
}

describe('DedupLib', () => {
  let owner: SignerWithAddress
  let dedupLib: DedupTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    dedupLib = await new DedupTester__factory(owner).deploy()
  })

  describe('#dedup', () => {
    it('returns correct value all unique', async () => {
      const value = await dedupLib.dedup(toByteArray([0, 1, 2, 3, 4]))
      expect(value[0]).to.deep.equal(toByteArray([0, 1, 2, 3, 4]))
      expect(value[1]).to.deep.equal(toByteArray([0, 1, 2, 3, 4]))
    })

    it('returns correct value duplicate start', async () => {
      const value = await dedupLib.dedup(toByteArray([0, 0, 2, 3, 4]))
      expect(value[0]).to.deep.equal(toByteArray([0, 2, 3, 4]))
      expect(value[1]).to.deep.equal(toByteArray([0, 0, 1, 2, 3]))
    })

    it('returns correct value duplicate end', async () => {
      const value = await dedupLib.dedup(toByteArray([0, 1, 2, 3, 3]))
      expect(value[0]).to.deep.equal(toByteArray([0, 1, 2, 3]))
      expect(value[1]).to.deep.equal(toByteArray([0, 1, 2, 3, 3]))
    })

    it('returns correct value duplicate middle', async () => {
      const value = await dedupLib.dedup(toByteArray([0, 2, 2, 2, 4]))
      expect(value[0]).to.deep.equal(toByteArray([0, 2, 4]))
      expect(value[1]).to.deep.equal(toByteArray([0, 1, 1, 1, 2]))
    })

    it('returns correct value duplicate all', async () => {
      const value = await dedupLib.dedup(toByteArray([0, 0, 0, 0, 0]))
      expect(value[0]).to.deep.equal(toByteArray([0]))
      expect(value[1]).to.deep.equal(toByteArray([0, 0, 0, 0, 0]))
    })

    it('returns correct value duplicate unsorted', async () => {
      const value = await dedupLib.dedup(toByteArray([3, 7, 3, 5, 7, 2, 1, 3, 12, 0, 7]))
      expect(value[0]).to.deep.equal(toByteArray([3, 7, 5, 2, 1, 12, 0]))
      expect(value[1]).to.deep.equal(toByteArray([0, 1, 0, 2, 1, 3, 4, 0, 5, 6, 1]))
    })
  })
})
