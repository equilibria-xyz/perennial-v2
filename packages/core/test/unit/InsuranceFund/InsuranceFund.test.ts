import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  IERC20Metadata,
  IMargin,
  IMarket,
  IMarketFactory,
  InsuranceFund,
  InsuranceFund__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('InsuranceFund', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let factory: FakeContract<IMarketFactory>
  let factoryOwner: SignerWithAddress
  let margin: FakeContract<IMargin>
  let market1: FakeContract<IMarket>
  let market2: FakeContract<IMarket>
  let insuranceFund: InsuranceFund

  beforeEach(async () => {
    ;[owner, factoryOwner, user] = await ethers.getSigners()

    market1 = await smock.fake<IMarket>('IMarket')
    market2 = await smock.fake<IMarket>('IMarket')
    margin = await smock.fake<IMargin>('IMargin')
    factory = await smock.fake<IMarketFactory>('IMarketFactory')
    insuranceFund = await new InsuranceFund__factory(owner).deploy(factory.address, margin.address)

    factory.owner.whenCalledWith().returns(factoryOwner.address)
    market1.margin.returns(margin.address)
    market2.margin.returns(margin.address)
  })

  it('initialize with the correct variables set', async () => {
    await insuranceFund.connect(owner).initialize()
    expect(await insuranceFund.owner()).to.be.equals(owner.address)
  })

  it('reverts if already initialized', async () => {
    await insuranceFund.initialize()
    await expect(insuranceFund.initialize())
      .to.be.revertedWithCustomError(insuranceFund, 'InitializableAlreadyInitializedError')
      .withArgs(1)
  })

  describe('#initialized', async () => {
    beforeEach(async () => {
      await insuranceFund.connect(owner).initialize()
      market1.claimFee.whenCalledWith(factoryOwner.address).returns()
      market2.claimFee.whenCalledWith(factoryOwner.address).returns()
      factory.instances.whenCalledWith(market1.address).returns(true)
      factory.instances.whenCalledWith(market2.address).returns(true)
    })

    context('#claim', async () => {
      it('claims protocol fee from market', async () => {
        await insuranceFund.connect(user).claim(market1.address)
        expect(market1.claimFee).to.have.been.calledWith(factoryOwner.address)

        await insuranceFund.connect(user).claim(market2.address)
        expect(market2.claimFee).to.have.been.calledWith(factoryOwner.address)
      })

      it('reverts with invalid market instance', async () => {
        factory.instances.whenCalledWith(market1.address).returns(false)

        await expect(insuranceFund.connect(user).claim(market1.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidInstanceError',
        )
      })
    })

    context('#resolve', async () => {
      it('resolves cross-margin shortfall', async () => {
        market1.settle.whenCalledWith(user.address).returns()
        const shortfall = parse6decimal('-1000')
        margin.crossMarginBalances.whenCalledWith(user.address).returns(shortfall)

        await insuranceFund.connect(owner).resolve(user.address)
        expect(margin.deposit).to.have.been.calledWith(user.address, shortfall.mul(-1))
      })

      it('resolves shortfall for an isolated market', async () => {
        market2.settle.whenCalledWith(user.address).returns()
        const shortfall = parse6decimal('-1200')
        margin.isolatedBalances.whenCalledWith(user.address, market2.address).returns(shortfall)

        await insuranceFund.connect(owner).resolveIsolated(market2.address, user.address)
        expect(market2.settle).to.have.been.calledWith(user.address)
        expect(market2['update(address,int256,int256,address)']).to.have.been.calledWith(
          user.address,
          0,
          shortfall.mul(-1),
          constants.AddressZero,
        )
      })

      it('reverts if no cross-margined shortfall', async () => {
        const shortfall = parse6decimal('100')
        margin.crossMarginBalances.whenCalledWith(user.address).returns(shortfall)
        await expect(insuranceFund.connect(owner).resolve(user.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'UFixed6UnderflowError',
        )
      })

      it('reverts if not owner', async () => {
        await expect(insuranceFund.connect(user).resolve(user.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'OwnableNotOwnerError',
        )
      })

      it('reverts with invalid market instance', async () => {
        factory.instances.whenCalledWith(market1.address).returns(false)

        await expect(
          insuranceFund.connect(owner).resolveIsolated(market1.address, user.address),
        ).to.be.revertedWithCustomError(insuranceFund, 'InsuranceFundInvalidInstanceError')
      })
    })
  })
})
