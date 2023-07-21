import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber } from 'ethers'

import { MappingTester, MappingTester__factory } from '../../../types/generated'
import { MappingStruct } from '../../../types/generated/contracts/Vault'

const { ethers } = HRE
use(smock.matchers)

const VALID_MAPPING: MappingStruct = {
  _ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
}

describe('Mapping', () => {
  let owner: SignerWithAddress

  let mapping: MappingTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    mapping = await new MappingTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores the value', async () => {
      await mapping.store(VALID_MAPPING)

      const value = await mapping.read()

      expect(value._ids[0]).to.equal(1)
      expect(value._ids[1]).to.equal(2)
      expect(value._ids[2]).to.equal(3)
      expect(value._ids[3]).to.equal(4)
      expect(value._ids[4]).to.equal(5)
      expect(value._ids[5]).to.equal(6)
      expect(value._ids[6]).to.equal(7)
      expect(value._ids[7]).to.equal(8)
      expect(value._ids[8]).to.equal(9)
      expect(value._ids[9]).to.equal(10)
    })

    it('reverts double store', async () => {
      await mapping.store(VALID_MAPPING)

      expect(mapping.store(VALID_MAPPING)).to.be.revertedWithCustomError(mapping, 'MappingStorageInvalidError')
    })

    describe('mapping.id[n]', () => {
      const STORAGE_SIZE = 32
      it('stores if in range', async () => {
        await mapping.store({ _ids: [BigNumber.from(2).pow(STORAGE_SIZE).sub(1), ...VALID_MAPPING._ids] })

        const value = await mapping.read()

        expect(value._ids[0]).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', () => {
        expect(
          mapping.store({ _ids: [BigNumber.from(2).pow(STORAGE_SIZE), ...VALID_MAPPING._ids] }),
        ).to.be.revertedWithCustomError(mapping, 'MappingStorageInvalidError')
      })
    })
  })

  describe('#initialize', () => {
    it('initializes the value with a length', async () => {
      await mapping.initialize(32)

      const value = await mapping.read()

      expect(value._ids.length).to.equal(32)
    })
  })

  describe('#update', () => {
    it('updates the value at index', async () => {
      await mapping.store(VALID_MAPPING)
      const value = await mapping.update(3, 37)

      expect(value._ids[3]).to.equal(37)
    })
  })

  describe('#length', () => {
    it('returns the length of the mapping', async () => {
      await mapping.store(VALID_MAPPING)

      expect(await mapping.length()).to.equal(10)
    })
  })

  describe('#get', () => {
    it('returns the length of the mapping', async () => {
      await mapping.store(VALID_MAPPING)

      expect(await mapping.get(0)).to.equal(1)
      expect(await mapping.get(1)).to.equal(2)
      expect(await mapping.get(2)).to.equal(3)
      expect(await mapping.get(3)).to.equal(4)
      expect(await mapping.get(4)).to.equal(5)
      expect(await mapping.get(5)).to.equal(6)
      expect(await mapping.get(6)).to.equal(7)
      expect(await mapping.get(7)).to.equal(8)
      expect(await mapping.get(8)).to.equal(9)
      expect(await mapping.get(9)).to.equal(10)
    })

    it('returns 0 if out of range', async () => {
      await mapping.store(VALID_MAPPING)

      expect(await mapping.get(10)).to.equal(0)
    })
  })

  describe('#ready', () => {
    context('latestMapping ids not all greater than ids', () => {
      it('returns false', async () => {
        await mapping.store(VALID_MAPPING)

        const latestMapping = { _ids: VALID_MAPPING._ids.map(id => BigNumber.from(id).add(1)) }
        latestMapping._ids[6] = BigNumber.from(6)

        expect(await mapping.ready(latestMapping)).to.be.false
      })
    })

    context('latestMapping ids all greater than ids', () => {
      it('returns false', async () => {
        await mapping.store(VALID_MAPPING)

        const latestMapping = { _ids: VALID_MAPPING._ids.map(id => BigNumber.from(id).add(1)) }

        expect(await mapping.ready(latestMapping)).to.be.true
      })
    })
  })

  context('#next', () => {
    context('currentMapping ids all equal to ids', () => {
      it('returns false', async () => {
        await mapping.store(VALID_MAPPING)

        const currentMapping = { _ids: [...VALID_MAPPING._ids] }

        expect(await mapping.next(currentMapping)).to.be.false
      })
    })

    context('currentMapping has an id greater than corresponding id', () => {
      it('returns false', async () => {
        await mapping.store(VALID_MAPPING)

        const currentMapping = { _ids: [...VALID_MAPPING._ids] }
        currentMapping._ids[6] = BigNumber.from(8)

        expect(await mapping.next(currentMapping)).to.be.true
      })
    })
  })
})
