import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { IOracleProvider, SwappableOracle, SwappableOracle__factory } from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { OracleVersionStruct } from '../../../types/generated/contracts/IOracleProvider'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE

function mockVersion(
  oracle: FakeContract<IOracleProvider>,
  latestVersion: OracleVersionStruct,
  currentTimestamp: number,
) {
  oracle.sync.returns([latestVersion, currentTimestamp])
  oracle.latest.returns(latestVersion)
  oracle.current.returns(currentTimestamp)
  oracle.at.whenCalledWith(latestVersion.timestamp).returns(latestVersion)
}

// TODO: at tests w/ zero timestamp

describe('SwappableOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let oracle: SwappableOracle
  let underlying0: FakeContract<IOracleProvider>
  let underlying1: FakeContract<IOracleProvider>

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()
    oracle = await new SwappableOracle__factory(owner).deploy()
    underlying0 = await smock.fake<IOracleProvider>('IOracleProvider')
    underlying1 = await smock.fake<IOracleProvider>('IOracleProvider')
  })

  describe('#initializer', async () => {
    it('sets initial oracle', async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        1687229905,
      )
      await expect(oracle.connect(owner).initialize(underlying0.address))
        .to.emit(oracle, 'OracleUpdated')
        .withArgs(underlying0.address)

      expect(await oracle.owner()).to.equal(owner.address)
      expect(await oracle.currentOracle()).to.equal(1)
      expect(await oracle.latestOracle()).to.equal(1)
      expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
      expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
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
      await oracle.connect(owner).initialize(underlying0.address)
    })

    context('updates the oracle w/o sync', async () => {
      beforeEach(async () => {
        await expect(oracle.connect(owner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle', async () => {
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(0)
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
        const [latestVersion, currentTimestamp] = await oracle.connect(owner).callStatic.sync()
        await oracle.connect(owner).sync()

        expect(latestVersion.timestamp).to.equal(1687230000)
        expect(latestVersion.price).to.equal(parse6decimal('1000'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
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
        await oracle.sync()
        await expect(oracle.connect(owner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle', async () => {
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(1)
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
        const [latestVersion, currentTimestamp] = await oracle.connect(owner).callStatic.sync()
        await oracle.connect(owner).sync()

        expect(latestVersion.timestamp).to.equal(1687230605)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
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
        const [latestVersion, currentTimestamp] = await oracle.connect(owner).callStatic.sync()
        await oracle.connect(owner).sync()

        expect(latestVersion.timestamp).to.equal(1687230905)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
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
        const [latestVersion, currentTimestamp] = await oracle.connect(owner).callStatic.sync()
        await oracle.connect(owner).sync()

        expect(latestVersion.timestamp).to.equal(1687230905)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
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
        const [latestVersion, currentTimestamp] = await oracle.connect(owner).callStatic.sync()
        await oracle.connect(owner).sync()

        expect(latestVersion.timestamp).to.equal(1687230955)
        expect(latestVersion.price).to.equal(parse6decimal('1007'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect(await oracle.currentOracle()).to.equal(2)
        expect(await oracle.latestOracle()).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
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
        await oracle.connect(owner).sync()

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
      })
    })

    it('reverts when not the owner', async () => {
      await expect(oracle.connect(user).update(underlying1.address))
        .to.revertedWithCustomError(oracle, 'UOwnableNotOwnerError')
        .withArgs(user.address)
    })
  })
})
