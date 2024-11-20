import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  InsuranceFund,
  InsuranceFund__factory,
  IMarketFactory,
  IMarket,
  IERC20Metadata,
} from '../../../types/generated'
import { IOracleProvider } from '@perennial/v2-oracle/types/generated'

const { ethers } = HRE
use(smock.matchers)

describe('InsuranceFund', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let factory: FakeContract<IMarketFactory>
  let factoryOwner: SignerWithAddress
  let market1: FakeContract<IMarket>
  let market2: FakeContract<IMarket>
  let oracle1: FakeContract<IOracleProvider>
  let oracle2: FakeContract<IOracleProvider>
  let insuranceFund: InsuranceFund
  let dsu: FakeContract<IERC20Metadata>

  beforeEach(async () => {
    ;[owner, factoryOwner, user] = await ethers.getSigners()

    market1 = await smock.fake<IMarket>('IMarket')
    market2 = await smock.fake<IMarket>('IMarket')
    oracle1 = await smock.fake<IOracleProvider>('IOracleProvider')
    oracle2 = await smock.fake<IOracleProvider>('IOracleProvider')
    factory = await smock.fake<IMarketFactory>('IMarketFactory')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    insuranceFund = await new InsuranceFund__factory(owner).deploy()
    factory.owner.whenCalledWith().returns(factoryOwner.address)
  })

  it('initialize with the correct variables set', async () => {
    await insuranceFund.initialize(factory.address, dsu.address)

    expect(await insuranceFund.marketFactoryOwner()).to.be.equals(factoryOwner.address)
    expect(await insuranceFund.DSU()).to.be.equals(dsu.address)
  })

  it('reverts if already initialized', async () => {
    await insuranceFund.initialize(factory.address, dsu.address)
    await expect(insuranceFund.initialize(factoryOwner.address, dsu.address))
      .to.be.revertedWithCustomError(insuranceFund, 'InitializableAlreadyInitializedError')
      .withArgs(1)
  })

  describe('#initialized', async () => {
    beforeEach(async () => {
      await insuranceFund.connect(owner).initialize(factory.address, dsu.address)
      market1.claimFee.whenCalledWith([owner.address]).returns(true)
      market2.claimFee.whenCalledWith([owner.address]).returns(true)

      factory.authorization
        .whenCalledWith(factoryOwner.address, insuranceFund.address, constants.AddressZero, constants.AddressZero)
        .returns([true, false, BigNumber.from(0)])
    })
    context('#claimFee', async () => {
      it('claims protocol fee from market', async () => {
        market1.oracle.whenCalledWith().returns(oracle1.address)
        market2.oracle.whenCalledWith().returns(oracle2.address)

        factory.markets.whenCalledWith(oracle1.address).returns(market1.address)
        factory.markets.whenCalledWith(oracle2.address).returns(market2.address)

        // claims protocol fee from market
        await insuranceFund.connect(owner).claimFees(market1.address)

        // ensure anyone can claim protocol fee
        await insuranceFund.connect(user).claimFees(market2.address)
      })

      it('reverts with invalid market address', async () => {
        market1.oracle.whenCalledWith().returns(oracle1.address)

        factory.markets.whenCalledWith(oracle1.address).returns(constants.AddressZero)

        await expect(insuranceFund.connect(owner).claimFees(market1.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidAddress',
        )
      })

      it('reverts with zero market address', async () => {
        await expect(insuranceFund.connect(user).claimFees(constants.AddressZero)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidAddress',
        )
      })
    })

    context('#resolveShortfall', async () => {
      it('resolves shortfall for a market by calling exposure', async () => {
        // should not approve DSU if already approved
        dsu.allowance.whenCalledWith(insuranceFund.address, market1.address).returns(constants.MaxUint256)
        market1.claimExposure.whenCalledWith().returns(true)

        await insuranceFund.connect(owner).resolveShortfall(market1.address)

        // should approve max DSU if not already approved
        dsu.allowance.whenCalledWith(insuranceFund.address, market2.address).returns(constants.Zero)
        dsu.approve.whenCalledWith(market2.address, constants.MaxUint256).returns(true)
        market2.claimExposure.whenCalledWith().returns(true)

        await insuranceFund.connect(owner).resolveShortfall(market2.address)
      })

      it('reverts if not owner (user)', async () => {
        dsu.allowance.whenCalledWith(insuranceFund.address, market1.address).returns(constants.MaxUint256)
        market1.claimExposure.whenCalledWith().returns(true)

        await expect(insuranceFund.connect(user).resolveShortfall(market1.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'OwnableNotOwnerError',
        )
      })
    })

    context('#sendDSUToMarket', async () => {
      it('send DSU to market', async () => {
        const amountToTransfer = BigNumber.from('10')
        dsu.transfer.whenCalledWith(market1.address, amountToTransfer).returns(true)

        await insuranceFund.connect(owner).sendDSUToMarket(market1.address, amountToTransfer)
      })

      it('reverts with zero market address', async () => {
        const amountToTransfer = BigNumber.from('10')
        dsu.transfer.whenCalledWith(market1.address, amountToTransfer).returns(true)

        await expect(
          insuranceFund.sendDSUToMarket(constants.AddressZero, amountToTransfer),
        ).to.be.revertedWithCustomError(insuranceFund, 'InsuranceFundInvalidAddress')
      })

      it('reverts with zero amount to transfer', async () => {
        const amountToTransfer = BigNumber.from('0')
        dsu.transfer.whenCalledWith(market1.address, amountToTransfer).returns(true)

        await expect(insuranceFund.sendDSUToMarket(market1.address, amountToTransfer)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidAmount',
        )
      })

      it('reverts if not owner (user)', async () => {
        const amountToTransfer = BigNumber.from('10')
        dsu.transfer.whenCalledWith(market1.address, amountToTransfer).returns(true)

        await expect(
          insuranceFund.connect(user).sendDSUToMarket(market1.address, amountToTransfer),
        ).to.be.revertedWithCustomError(insuranceFund, 'OwnableNotOwnerError')
      })
    })

    context('#withdrawDSU', async () => {
      it('withdraw DSU from Insurance fund', async () => {
        const amountToWithdraw = BigNumber.from('100')
        dsu.balanceOf.whenCalledWith(insuranceFund.address).returns(amountToWithdraw)
        dsu.transfer.whenCalledWith(owner.address, amountToWithdraw).returns(true)

        await insuranceFund.connect(owner).withdrawDSU(amountToWithdraw)
      })

      it('reverts when not owner(user)', async () => {
        const amountToWithdraw = BigNumber.from('100')
        dsu.balanceOf.whenCalledWith(insuranceFund.address).returns(amountToWithdraw)
        dsu.transfer.whenCalledWith(owner.address, amountToWithdraw).returns(true)

        await expect(insuranceFund.connect(user).withdrawDSU(amountToWithdraw)).to.be.revertedWithCustomError(
          insuranceFund,
          'OwnableNotOwnerError',
        )
      })

      it('reverts when amount is zero', async () => {
        const amountToWithdraw = BigNumber.from('0')
        dsu.balanceOf.whenCalledWith(insuranceFund.address).returns(amountToWithdraw)
        dsu.transfer.whenCalledWith(owner.address, amountToWithdraw).returns(true)

        await expect(insuranceFund.connect(owner).withdrawDSU(amountToWithdraw)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidAmount',
        )
      })

      it('reverts when amount is greater than available balance', async () => {
        const amountToWithdraw = BigNumber.from('1000')
        dsu.balanceOf.whenCalledWith(insuranceFund.address).returns(amountToWithdraw.sub(1))
        dsu.transfer.whenCalledWith(owner.address, amountToWithdraw).returns(true)

        await expect(insuranceFund.connect(owner).withdrawDSU(amountToWithdraw)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidAmount',
        )
      })
    })
  })
})
