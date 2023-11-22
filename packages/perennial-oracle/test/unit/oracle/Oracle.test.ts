import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  IMarket,
  IMarketFactory,
  IOracleFactory,
  IOracleProvider,
  Oracle,
  Oracle__factory,
} from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { parse6decimal } from '../../../../common/testutil/types'
import { impersonate } from '../../../../common/testutil'
import { utils } from 'ethers'
import { OracleVersionStruct } from '../../../types/generated/contracts/Oracle'

const { ethers } = HRE

function mockVersion(
  oracle: FakeContract<IOracleProvider>,
  latestVersion: OracleVersionStruct,
  currentTimestamp: number,
) {
  oracle.request.returns()
  oracle.status.returns([latestVersion, currentTimestamp])
  oracle.latest.returns(latestVersion)
  oracle.current.returns(currentTimestamp)
  oracle.at.whenCalledWith(latestVersion.timestamp).returns(latestVersion)
}

describe('Oracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let caller: SignerWithAddress

  let oracle: Oracle
  let underlying0: FakeContract<IOracleProvider>
  let underlying1: FakeContract<IOracleProvider>
  let oracleFactory: FakeContract<IOracleFactory>
  let oracleFactorySigner: SignerWithAddress
  let market: FakeContract<IMarket>
  let marketFactory: FakeContract<IMarketFactory>

  beforeEach(async () => {
    ;[owner, user, caller] = await ethers.getSigners()
    market = await smock.fake<IMarket>('IMarket')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market.factory.returns(marketFactory.address)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    oracle = await new Oracle__factory(owner).deploy()
    underlying0 = await smock.fake<IOracleProvider>('IOracleProvider')
    underlying1 = await smock.fake<IOracleProvider>('IOracleProvider')
    oracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    oracleFactorySigner = await impersonate.impersonateWithBalance(oracleFactory.address, utils.parseEther('10'))
    oracleFactory.owner.returns(owner.address)
    oracleFactory.authorized.whenCalledWith(caller.address).returns(true)
  })

  describe('#initializer', async () => {
    it('sets initial oracle w/o initial version', async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 0,
          price: parse6decimal('0'),
          valid: false,
        },
        0,
      )

      await expect(oracle.connect(oracleFactorySigner).initialize(underlying0.address))
        .to.emit(oracle, 'OracleUpdated')
        .withArgs(underlying0.address)

      expect(await oracle.factory()).to.equal(oracleFactory.address)
      expect((await oracle.global()).current).to.equal(1)
      expect((await oracle.global()).latest).to.equal(1)
      expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
      expect((await oracle.oracles(1)).timestamp).to.equal(0)
    })

    it('sets initial oracle w/ initial version', async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        1687229905,
      )

      await expect(oracle.connect(oracleFactorySigner).initialize(underlying0.address))
        .to.emit(oracle, 'OracleUpdated')
        .withArgs(underlying0.address)

      expect(await oracle.factory()).to.equal(oracleFactory.address)
      expect((await oracle.global()).current).to.equal(1)
      expect((await oracle.global()).latest).to.equal(1)
      expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
      expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
    })

    it('reverts if already initialized', async () => {
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address)

      await expect(oracle.connect(oracleFactorySigner).initialize(underlying0.address))
        .to.be.revertedWithCustomError(oracle, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#update', async () => {
    beforeEach(async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        1687229905,
      )
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address)
    })

    context('updates the oracle w/o sync', async () => {
      beforeEach(async () => {
        await expect(oracle.connect(oracleFactorySigner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle', async () => {
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(0)

        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        expect(latestVersion.timestamp).to.equal(1687229000)
        expect(latestVersion.price).to.equal(parse6decimal('999'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(0)

        expect(await oracle.at(1687229000)).to.deep.equal(latestVersion)
      })

      it('syncs another version', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230605,
            price: parse6decimal('1006'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        // Latest should not be updated until we call request
        expect((await oracle.global()).latest).to.equal(1)

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230000)
        expect(latestVersion.price).to.equal(parse6decimal('1000'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('reverts when oracle out of sync', async () => {
        const underlying2 = await smock.fake<IOracleProvider>('IOracleProvider')

        await expect(oracle.connect(oracleFactorySigner).update(underlying2.address)).to.revertedWithCustomError(
          oracle,
          'OracleOutOfSyncError',
        )
      })
    })

    context('updates the oracle w/ sync', async () => {
      beforeEach(async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230005,
            price: parse6decimal('1001'),
            valid: true,
          },
          1687230905,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          1687230905,
        )
        await oracle.connect(caller).request(market.address, user.address)
        await expect(oracle.connect(oracleFactorySigner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle', async () => {
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687230905)

        underlying0.at.whenCalledWith(1687230905).returns({
          timestamp: 1687230905,
          price: parse6decimal('987'),
          valid: true,
        })
        underlying1.at.whenCalledWith(1687230905).returns({
          timestamp: 1687230905,
          price: parse6decimal('988'),
          valid: true,
        })
        expect((await oracle.at(1687230905)).timestamp).to.equal(1687230905)
        expect((await oracle.at(1687230905)).price).to.equal(parse6decimal('987'))
        expect((await oracle.at(1687230905)).valid).to.equal(true)
      })

      it('requests another before current has cleared', async () => {
        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230005)
        expect(latestVersion.price).to.equal(parse6decimal('1001'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687230905)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687230905)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.been.called
        expect(underlying1.request).to.have.not.been.called
      })

      it('syncs another version with previous latest', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230605,
            price: parse6decimal('1006'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230605)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version equal to latest', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230905,
            price: parse6decimal('1006'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230905)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version after latest before current', async () => {
        underlying0.at.whenCalledWith(1687230905).returns({
          timestamp: 1687230905,
          price: parse6decimal('1006'),
          valid: true,
        })
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1007'),
            valid: true,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230905)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version after latest after current', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230955,
            price: parse6decimal('1007'),
            valid: true,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230955)
        expect(latestVersion.price).to.equal(parse6decimal('1007'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version after all up-to-date', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230955,
            price: parse6decimal('1007'),
            valid: true,
          },
          1687231005,
        )
        await oracle.connect(caller).request(market.address, user.address)

        mockVersion(
          underlying1,
          {
            timestamp: 1687235000,
            price: parse6decimal('1015'),
            valid: true,
          },
          1687235080,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [
          await oracle.connect(caller).latest(),
          await oracle.connect(caller).current(),
        ]
        const [latestVersion, currentTimestamp] = await oracle.connect(caller).status()
        await oracle.connect(caller).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687235000)
        expect(latestVersion.price).to.equal(parse6decimal('1015'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687235080)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687235080)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('properly triages at', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230955,
            price: parse6decimal('1007'),
            valid: true,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        await oracle.connect(caller).request(market.address, user.address)

        expect((await oracle.at(0)).timestamp).to.equal(0)
        expect((await oracle.at(0)).price).to.equal(parse6decimal('0'))
        expect((await oracle.at(0)).valid).to.equal(false)
        underlying0.at.whenCalledWith(1677229905).returns({
          timestamp: 1677229905,
          price: parse6decimal('800'),
          valid: true,
        })
        expect((await oracle.at(1677229905)).timestamp).to.equal(1677229905)
        expect((await oracle.at(1677229905)).price).to.equal(parse6decimal('800'))
        expect((await oracle.at(1677229905)).valid).to.equal(true)
        underlying0.at.whenCalledWith(1687230905).returns({
          timestamp: 1687230905,
          price: parse6decimal('999'),
          valid: true,
        })
        expect((await oracle.at(1687230905)).timestamp).to.equal(1687230905)
        expect((await oracle.at(1687230905)).price).to.equal(parse6decimal('999'))
        expect((await oracle.at(1687230905)).valid).to.equal(true)
        underlying1.at.whenCalledWith(1687230906).returns({
          timestamp: 1687230906,
          price: parse6decimal('1001'),
          valid: true,
        })
        expect((await oracle.at(1687230906)).timestamp).to.equal(1687230906)
        expect((await oracle.at(1687230906)).price).to.equal(parse6decimal('1001'))
        expect((await oracle.at(1687230906)).valid).to.equal(true)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })
    })

    context('updates the oracle w/ non-requested latest', async () => {
      beforeEach(async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230005,
            price: parse6decimal('1001'),
            valid: true,
          },
          1687230905,
        )
        await oracle.connect(caller).request(market.address, user.address)

        mockVersion(
          underlying0,
          {
            timestamp: 1687231005,
            price: parse6decimal('1001'),
            valid: true,
          },
          1687231905,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          1687231905,
        )
        await expect(oracle.connect(oracleFactorySigner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle without going back in time', async () => {
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687231005)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231905)

        underlying0.at.whenCalledWith(1687231005).returns({
          timestamp: 1687231005,
          price: parse6decimal('987'),
          valid: true,
        })
        underlying1.at.whenCalledWith(1687231005).returns({
          timestamp: 1687231005,
          price: parse6decimal('988'),
          valid: true,
        })
        expect((await oracle.at(1687231005)).timestamp).to.equal(1687231005)
        expect((await oracle.at(1687231005)).price).to.equal(parse6decimal('987'))
        expect((await oracle.at(1687231005)).valid).to.equal(true)
      })
    })

    context('updates the oracle from a blank oracle', async () => {
      beforeEach(async () => {
        oracle = await new Oracle__factory(owner).deploy()
        await oracle.connect(oracleFactorySigner).initialize(underlying1.address)
      })

      it('updates the oracle', async () => {
        const underlying2 = await smock.fake<IOracleProvider>('IOracleProvider')
        await expect(oracle.connect(oracleFactorySigner).update(underlying2.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying2.address)

        expect((await oracle.global()).latest).to.equal(1)

        mockVersion(
          underlying2,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          1687231005,
        )
        underlying1.request.reset()
        underlying2.request.reset()
        await oracle.connect(caller).request(market.address, user.address)

        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).timestamp).to.equal(0)
      })

      it('cannot update the oracle to two successive blank oracles', async () => {
        const underlying2 = await smock.fake<IOracleProvider>('IOracleProvider')
        await expect(oracle.connect(oracleFactorySigner).update(underlying2.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying2.address)

        const underlying3 = await smock.fake<IOracleProvider>('IOracleProvider')
        await expect(oracle.connect(oracleFactorySigner).update(underlying3.address)).to.revertedWithCustomError(
          oracle,
          'OracleOutOfSyncError',
        )
      })
    })

    it('reverts when not the owner', async () => {
      await expect(oracle.connect(user).update(underlying1.address)).to.revertedWithCustomError(
        oracle,
        'InstanceNotFactoryError',
      )
    })
  })

  describe('#request', async () => {
    beforeEach(async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        1687229905,
      )
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address)
    })

    it('reverts when not the authorized', async () => {
      oracleFactory.authorized.whenCalledWith(user.address).returns(false)

      await expect(oracle.connect(user).request(market.address, user.address)).to.revertedWithCustomError(
        oracle,
        'OracleProviderUnauthorizedError',
      )
    })
  })
})
