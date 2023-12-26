import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { MicroPowerTwo, MicroPowerTwo__factory } from '../../../types/generated'

const { ethers } = HRE

describe('MicroPowerTwo', () => {
  let user: SignerWithAddress
  let provider: MicroPowerTwo

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    provider = await new MicroPowerTwo__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff (1)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('1000'))).to.equal(ethers.utils.parseEther('1'))
    })

    it('modifies price per payoff (2)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('11000'))).to.equal(ethers.utils.parseEther('121'))
    })

    it('modifies price per payoff (3)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('100'))).to.equal(ethers.utils.parseEther('0.01'))
    })

    it('modifies price per payoff (4)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('-1000'))).to.equal(ethers.utils.parseEther('1'))
    })

    it('modifies price per payoff (5)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('-11000'))).to.equal(ethers.utils.parseEther('121'))
    })

    it('modifies price per payoff (6)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('-100'))).to.equal(ethers.utils.parseEther('0.01'))
    })

    it('modifies price per payoff (7)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('0'))).to.equal(0)
    })
  })
})
