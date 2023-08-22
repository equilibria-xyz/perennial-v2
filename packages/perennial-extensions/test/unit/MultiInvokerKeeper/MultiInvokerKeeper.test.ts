import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { MultiInvoker, IERC20, MultiInvokerKeeper, MultiInvokerKeeper__factory } from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const ethers = { HRE }
use(smock.matchers)

describe.only('MultiInvokerKeeper', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let dsu: FakeContract<IERC20>
  let multiInvoker: FakeContract<MultiInvoker>
  let multiInvokerKeeper: MultiInvokerKeeper

  const fixture = async () => {
    ;[owner, user] = await ethers.HRE.ethers.getSigners()
  }

  beforeEach(async () => {
    await loadFixture(fixture)

    dsu = await smock.fake<IERC20>('IERC20')
    multiInvoker = await smock.fake<MultiInvoker>('MultiInvoker')
    multiInvoker.DSU.returns(dsu.address)
    multiInvokerKeeper = await new MultiInvokerKeeper__factory(owner).deploy(multiInvoker.address)
    await multiInvokerKeeper.initialize()
  })

  describe('#invoke', () => {
    it('calls invoke on the MultiInvoker', async () => {
      const invocations = [
        {
          action: 0,
          args: '0x',
        },
      ]
      await multiInvokerKeeper.connect(user).invoke(invocations)
      expect(multiInvoker.invoke).to.have.been.calledWith(invocations)
    })
  })

  describe('#sweepDSU', () => {
    const BALANCE = 1

    const fixture = async () => {
      dsu.balanceOf.returns(BALANCE)
      dsu.transfer.returns(true)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('only allows the owner to call', async () => {
      await expect(multiInvokerKeeper.connect(user).sweepDSU(user.address)).to.be.revertedWithCustomError(
        multiInvokerKeeper,
        'UOwnableNotOwnerError',
      )
    })

    it('sweeps all the DSU from the MultiInvoker', async () => {
      await multiInvokerKeeper.sweepDSU(user.address)
      expect(dsu.transfer).to.have.been.calledWith(user.address, BALANCE)
    })
  })
})
