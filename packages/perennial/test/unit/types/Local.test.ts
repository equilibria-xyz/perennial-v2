import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { LocalTester, LocalTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { LocalStruct, PositionStruct, VersionStruct } from '../../../types/generated/contracts/Market'

const { ethers } = HRE
use(smock.matchers)

describe('Local', () => {
  let owner: SignerWithAddress

  let local: LocalTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    local = await new LocalTester__factory(owner).deploy()
  })

  describe('#store', () => {
    const VALID_STORED_VALUE: LocalStruct = {
      currentId: 1,
      latestId: 5,
      collateral: 2,
      reward: 3,
      protection: 4,
    }
    it('stores a new value', async () => {
      await local.store(VALID_STORED_VALUE)

      const value = await local.read()
      expect(value.currentId).to.equal(1)
      expect(value.latestId).to.equal(5)
      expect(value.collateral).to.equal(2)
      expect(value.reward).to.equal(3)
      expect(value.protection).to.equal(4)
    })

    context('.currentId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          currentId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.currentId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            currentId: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.latestId', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          latestId: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.latestId).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if currentId out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            latestId: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.collateral', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await local.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if collateral out of range (above)', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })

      it('reverts if collateral out of range (below)', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.reward', async () => {
      const STORAGE_SIZE = 64
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          reward: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.reward).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if reward out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            reward: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })

    context('.protection', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await local.store({
          ...VALID_STORED_VALUE,
          protection: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await local.read()
        expect(value.protection).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if protection out of range', async () => {
        await expect(
          local.store({
            ...VALID_STORED_VALUE,
            protection: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(local, 'LocalStorageInvalidError')
      })
    })
  })

  describe('#update', () => {
    it('adds collateral (increase)', async () => {
      await local.store({
        currentId: 0,
        latestId: 0,
        collateral: 0,
        reward: 0,
        protection: 0,
      })

      await local.update(1)

      const value = await local.read()
      expect(value.collateral).to.equal(1)
    })

    it('adds collateral (decrease)', async () => {
      await local.store({
        currentId: 0,
        latestId: 0,
        collateral: 0,
        reward: 0,
        protection: 0,
      })

      await local.update(-1)

      const value = await local.read()
      expect(value.collateral).to.equal(-1)
    })
  })

  describe('#accumulate', () => {
    const FROM_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: parse6decimal('987'),
      long: parse6decimal('654'),
      short: parse6decimal('321'),
      fee: 0, // unused
      keeper: 0, // unused
      collateral: 0, // unused
      delta: 0, // unused
    }

    const TO_POSITION: PositionStruct = {
      timestamp: 0, // unused
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: parse6decimal('123'),
      keeper: parse6decimal('456'),
      collateral: 0, // unused
      delta: 0, // unused
    }

    const FROM_VERSION: VersionStruct = {
      valid: true,
      makerValue: { _value: parse6decimal('100') },
      longValue: { _value: parse6decimal('200') },
      shortValue: { _value: parse6decimal('300') },
      makerReward: { _value: parse6decimal('400') },
      longReward: { _value: parse6decimal('500') },
      shortReward: { _value: parse6decimal('600') },
    }

    const TO_VERSION: VersionStruct = {
      valid: true,
      makerValue: { _value: parse6decimal('1000') },
      longValue: { _value: parse6decimal('2000') },
      shortValue: { _value: parse6decimal('3000') },
      makerReward: { _value: parse6decimal('4000') },
      longReward: { _value: parse6decimal('5000') },
      shortReward: { _value: parse6decimal('6000') },
    }

    context('zero initial values', () => {
      beforeEach(async () => {
        await local.store({
          currentId: 1,
          latestId: 0,
          collateral: 0,
          reward: 0,
          protection: 0,
        })
      })

      it('accumulates values (increase)', async () => {
        const values = await local.callStatic.accumulate(1, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION)
        await local.accumulate(1, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION)

        const value = await local.read()

        const expectedCollateral = parse6decimal('2932200') // = 900 * 987 + 1800 * 654 + 2700 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')
        const expectedReward = parse6decimal('8229600') // = 3600 * 987 + 4500 * 654 + 5400 * 321

        expect(values.collateralAmount).to.equal(expectedCollateral)
        expect(values.rewardAmount).to.equal(expectedReward)
        expect(values.positionFee).to.equal(expectedPositionFee)
        expect(values.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(1)
        expect(value.latestId).to.equal(1)
        expect(value.collateral).to.equal(expectedCollateral.sub(expectedPositionFee.add(expectedKeeper)))
        expect(value.reward).to.equal(expectedReward)
        expect(value.protection).to.equal(0)
      })

      it('accumulates values (decrease)', async () => {
        const TO_VERSION_NEG = {
          ...TO_VERSION,
          makerValue: { _value: BigNumber.from(TO_VERSION.makerValue._value).mul(-1) },
          longValue: { _value: BigNumber.from(TO_VERSION.longValue._value).mul(-1) },
          shortValue: { _value: BigNumber.from(TO_VERSION.shortValue._value).mul(-1) },
        }
        const values = await local.callStatic.accumulate(1, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION_NEG)
        await local.accumulate(1, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION_NEG)

        const value = await local.read()

        const expectedCollateral = parse6decimal('-3583800') // = -1100 * 987 + -2200 * 654 + -3300 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')
        const expectedReward = parse6decimal('8229600') // = 3600 * 987 + 4500 * 654 + 5400 * 321

        expect(values.collateralAmount).to.equal(expectedCollateral)
        expect(values.rewardAmount).to.equal(expectedReward)
        expect(values.positionFee).to.equal(expectedPositionFee)
        expect(values.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(1)
        expect(value.latestId).to.equal(1)
        expect(value.collateral).to.equal(expectedCollateral.sub(expectedPositionFee.add(expectedKeeper)))
        expect(value.reward).to.equal(expectedReward)
        expect(value.protection).to.equal(0)
      })

      it('reverts on negative rewards', async () => {
        await expect(local.accumulate(1, FROM_POSITION, TO_POSITION, TO_VERSION, FROM_VERSION)).to.be.revertedWithPanic(
          17,
        )
      })
    })

    context('non-zero initial values', () => {
      const INITIAL_VALUES = {
        currentId: 12,
        latestId: 10,
        collateral: parse6decimal('10'),
        reward: parse6decimal('20'),
        protection: parse6decimal('34'),
      }
      beforeEach(async () => {
        await local.store(INITIAL_VALUES)
      })

      it('accumulates values (increase)', async () => {
        const values = await local.callStatic.accumulate(11, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION)
        await local.accumulate(11, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION)

        const value = await local.read()

        const expectedCollateral = parse6decimal('2932200') // = 900 * 987 + 1800 * 654 + 2700 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')
        const expectedReward = parse6decimal('8229600') // = 3600 * 987 + 4500 * 654 + 5400 * 321

        expect(values.collateralAmount).to.equal(expectedCollateral)
        expect(values.rewardAmount).to.equal(expectedReward)
        expect(values.positionFee).to.equal(expectedPositionFee)
        expect(values.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(INITIAL_VALUES.currentId)
        expect(value.latestId).to.equal(11)
        expect(value.collateral).to.equal(
          expectedCollateral.add(INITIAL_VALUES.collateral).sub(expectedPositionFee.add(expectedKeeper)),
        )
        expect(value.reward).to.equal(expectedReward.add(INITIAL_VALUES.reward))
        expect(value.protection).to.equal(INITIAL_VALUES.protection)
      })

      it('accumulates values (decrease)', async () => {
        const TO_VERSION_NEG = {
          ...TO_VERSION,
          makerValue: { _value: BigNumber.from(TO_VERSION.makerValue._value).mul(-1) },
          longValue: { _value: BigNumber.from(TO_VERSION.longValue._value).mul(-1) },
          shortValue: { _value: BigNumber.from(TO_VERSION.shortValue._value).mul(-1) },
        }
        const values = await local.callStatic.accumulate(11, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION_NEG)
        await local.accumulate(11, FROM_POSITION, TO_POSITION, FROM_VERSION, TO_VERSION_NEG)

        const value = await local.read()

        const expectedCollateral = parse6decimal('-3583800') // = -1100 * 987 + -2200 * 654 + -3300 * 321
        const expectedPositionFee = parse6decimal('123')
        const expectedKeeper = parse6decimal('456')
        const expectedReward = parse6decimal('8229600') // = 3600 * 987 + 4500 * 654 + 5400 * 321

        expect(values.collateralAmount).to.equal(expectedCollateral)
        expect(values.rewardAmount).to.equal(expectedReward)
        expect(values.positionFee).to.equal(expectedPositionFee)
        expect(values.keeper).to.equal(expectedKeeper)

        expect(value.currentId).to.equal(INITIAL_VALUES.currentId)
        expect(value.latestId).to.equal(11)
        expect(value.collateral).to.equal(
          expectedCollateral.add(INITIAL_VALUES.collateral).sub(expectedPositionFee.add(expectedKeeper)),
        )
        expect(value.reward).to.equal(expectedReward.add(INITIAL_VALUES.reward))
        expect(value.protection).to.equal(INITIAL_VALUES.protection)
      })

      it('reverts on negative rewards', async () => {
        await expect(
          local.accumulate(11, FROM_POSITION, TO_POSITION, TO_VERSION, FROM_VERSION),
        ).to.be.revertedWithPanic(17)
      })
    })
  })

  describe('#protect', () => {
    const LATEST_POSITION: PositionStruct = {
      timestamp: BigNumber.from('123456'),
      maker: 0, // unused
      long: 0, // unused
      short: 0, // unused
      fee: 0, // unused
      keeper: 0, // unused
      collateral: 0, // unused
      delta: 0, // unused
    }

    context('tryProtect = false', () => {
      it("doesn't protect", async () => {
        await local.store({
          currentId: 0,
          latestId: 0,
          collateral: 0,
          reward: 0,
          protection: 0,
        })

        const protection = await local.callStatic.protect(LATEST_POSITION, 0, false)
        await local.protect(LATEST_POSITION, 0, false)

        const value = await local.read()
        expect(protection).to.equal(false)
        expect(value.protection).to.equal(0)
      })
    })

    context('tryProtect = true', () => {
      context('protection < latestPosition.timestamp', () => {
        it('protects', async () => {
          await local.store({
            currentId: 0,
            latestId: 0,
            collateral: 0,
            reward: 0,
            protection: 0,
          })

          const protection = await local.callStatic.protect(
            LATEST_POSITION,
            BigNumber.from(LATEST_POSITION.timestamp).add(100),
            true,
          )
          await local.protect(LATEST_POSITION, BigNumber.from(LATEST_POSITION.timestamp).add(100), true)

          const value = await local.read()
          expect(protection).to.equal(true)
          expect(value.protection).to.equal(BigNumber.from(LATEST_POSITION.timestamp).add(100))
        })
      })

      context('protection = latestPosition.timestamp', () => {
        it('protects', async () => {
          await local.store({
            currentId: 0,
            latestId: 0,
            collateral: 0,
            reward: 0,
            protection: BigNumber.from(LATEST_POSITION.timestamp),
          })

          const protection = await local.callStatic.protect(
            LATEST_POSITION,
            BigNumber.from(LATEST_POSITION.timestamp).add(100),
            true,
          )
          await local.protect(LATEST_POSITION, BigNumber.from(LATEST_POSITION.timestamp).add(100), true)

          const value = await local.read()
          expect(protection).to.equal(true)
          expect(value.protection).to.equal(BigNumber.from(LATEST_POSITION.timestamp).add(100))
        })
      })

      context('protection > latestPosition.timestamp', () => {
        it("doesn't protect", async () => {
          await local.store({
            currentId: 0,
            latestId: 0,
            collateral: 0,
            reward: 0,
            protection: BigNumber.from(LATEST_POSITION.timestamp).add(1),
          })

          const protection = await local.callStatic.protect(
            LATEST_POSITION,
            BigNumber.from(LATEST_POSITION.timestamp).add(100),
            true,
          )
          await local.protect(LATEST_POSITION, BigNumber.from(LATEST_POSITION.timestamp).add(100), true)

          const value = await local.read()
          expect(protection).to.equal(false)
          expect(value.protection).to.equal(BigNumber.from(LATEST_POSITION.timestamp).add(1))
        })
      })
    })
  })
})
