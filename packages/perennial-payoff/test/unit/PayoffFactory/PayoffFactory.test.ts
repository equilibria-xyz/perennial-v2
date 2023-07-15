import { smock, FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  IERC20Metadata,
  PayoffFactory,
  Oracle,
  Oracle__factory,
  PayoffFactory__factory,
  IOracleProviderFactory,
  IOracleProvider,
  IFactory,
  IPayoffFactory,
} from '../../../types/generated'
import { constants } from 'ethers'

const { ethers } = HRE

const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'

describe('PayoffFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let payoff: FakeContract<IPayoffFactory>

  let factory: PayoffFactory

  beforeEach(async () => {
    ;[user, owner] = await ethers.getSigners()
    payoff = await smock.fake<IPayoffFactory>('IPayoffFactory')
    factory = await new PayoffFactory__factory(owner).deploy()
    await factory.initialize()
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await factory.owner()).to.equal(owner.address)
    })

    it('reverts if already initialized', async () => {
      await expect(factory.initialize())
        .to.be.revertedWithCustomError(factory, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#register', async () => {
    it('registers the payoff', async () => {
      await expect(factory.register(payoff.address)).to.emit(factory, 'PayoffRegistered').withArgs(payoff.address)

      expect(await factory.payoffs(payoff.address)).to.equal(true)
    })

    it('reverts if not owner', async () => {
      await expect(factory.connect(user).register(payoff.address)).to.be.revertedWithCustomError(
        factory,
        'UOwnableNotOwnerError',
      )
    })
  })
})
