import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { IdTester, IdTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

describe.only('IdLib', () => {
  let owner: SignerWithAddress
  let idLib: IdTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    idLib = await new IdTester__factory(owner).deploy()
  })

  describe('#unique', () => {
    it('returns correct value all unique', async () => {
      expect(await idLib.unique([0, 1, 2, 3, 4])).to.equal(5)
    })
  })
})
