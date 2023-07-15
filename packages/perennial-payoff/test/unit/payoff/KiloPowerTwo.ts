import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { KiloPowerTwo, KiloPowerTwo__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

describe('KiloPowerTwo', () => {
  let user: SignerWithAddress
  let provider: KiloPowerTwo

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    provider = await new KiloPowerTwo__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff (1)', async () => {
      expect(await provider.payoff(parse6decimal('1'))).to.equal(parse6decimal('1000'))
    })

    it('modifies price per payoff (2)', async () => {
      expect(await provider.payoff(parse6decimal('11'))).to.equal(parse6decimal('121000'))
    })

    it('modifies price per payoff (3)', async () => {
      expect(await provider.payoff(parse6decimal('0.1'))).to.equal(parse6decimal('10'))
    })

    it('modifies price per payoff (4)', async () => {
      expect(await provider.payoff(parse6decimal('-1'))).to.equal(parse6decimal('1000'))
    })

    it('modifies price per payoff (5)', async () => {
      expect(await provider.payoff(parse6decimal('-11'))).to.equal(parse6decimal('121000'))
    })

    it('modifies price per payoff (6)', async () => {
      expect(await provider.payoff(parse6decimal('-0.1'))).to.equal(parse6decimal('10'))
    })

    it('modifies price per payoff (7)', async () => {
      expect(await provider.payoff(parse6decimal('0'))).to.equal(0)
    })
  })
})
