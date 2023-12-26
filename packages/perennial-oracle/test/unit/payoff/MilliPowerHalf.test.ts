import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { MilliPowerHalf, MilliPowerHalf__factory } from '../../../types/generated'

const { ethers } = HRE

describe('MilliPowerHalf', () => {
  let user: SignerWithAddress
  let provider: MilliPowerHalf

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    provider = await new MilliPowerHalf__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff (1)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('1'))).to.equal(ethers.utils.parseEther('0.001'))
    })

    it('modifies price per payoff (2)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('11'))).to.equal(
        ethers.utils.parseEther('0.003316624790355399'),
      )
    })

    it('modifies price per payoff (3)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('0.1'))).to.equal(
        ethers.utils.parseEther('0.000316227766016837'),
      )
    })

    it('modifies price per payoff (4)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('-1'))).to.equal(ethers.utils.parseEther('0.001'))
    })

    it('modifies price per payoff (5)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('-11'))).to.equal(
        ethers.utils.parseEther('0.003316624790355399'),
      )
    })

    it('modifies price per payoff (6)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('-0.1'))).to.equal(
        ethers.utils.parseEther('0.000316227766016837'),
      )
    })

    it('modifies price per payoff (7)', async () => {
      expect(await provider.payoff(ethers.utils.parseEther('0'))).to.equal(0)
    })
  })
})
