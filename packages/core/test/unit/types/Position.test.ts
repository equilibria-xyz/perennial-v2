import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  PositionGlobalTester,
  PositionGlobalTester__factory,
  PositionLocalTester,
  PositionLocalTester__factory,
  PositionStorageGlobalLib,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib,
  PositionStorageLocalLib__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { OracleVersion, parse6decimal } from '../../../../common/testutil/types'
import { PositionStruct } from '../../../types/generated/contracts/Market'

import { VALID_RISK_PARAMETER } from './RiskParameter.test'

const { ethers } = HRE
use(smock.matchers)

export const VALID_ORACLE_VERSION: OracleVersion = {
  timestamp: 12345,
  price: parse6decimal('100'),
  valid: true,
}

const VALID_ORDER = {
  timestamp: 123456,
  orders: 1,
  collateral: parse6decimal('100'),
  makerPos: parse6decimal('4'),
  makerNeg: parse6decimal('5'),
  longPos: parse6decimal('8'),
  longNeg: parse6decimal('3'),
  shortPos: parse6decimal('6'),
  shortNeg: parse6decimal('3'),
  protection: 1,
  invalidation: 1,
  makerReferral: parse6decimal('4'),
  takerReferral: parse6decimal('5'),
  overrideMagnitude: parse6decimal('0'),
  overrideNotional: parse6decimal('0'),
}

describe('Position', () => {
  let owner: SignerWithAddress

  describe('global position', () => {
    let positionStorageGlobalLib: PositionStorageGlobalLib
    let position: PositionGlobalTester

    const VALID_GLOBAL_POSITION: PositionStruct = {
      timestamp: 2,
      maker: 3,
      long: 4,
      short: 5,
    }

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()

      positionStorageGlobalLib = await new PositionStorageGlobalLib__factory(owner).deploy()
      position = await new PositionGlobalTester__factory(
        {
          'contracts/types/Position.sol:PositionStorageGlobalLib': positionStorageGlobalLib.address,
        },
        owner,
      ).deploy()
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await position.store(VALID_GLOBAL_POSITION)

        const value = await position.read()
        expect(value.timestamp).to.equal(2)
        expect(value.maker).to.equal(3)
        expect(value.long).to.equal(4)
        expect(value.short).to.equal(5)
      })

      describe('.timestamp', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            timestamp: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.timestamp).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if timestamp out of range', async () => {
          await expect(
            position.store({
              ...VALID_GLOBAL_POSITION,
              timestamp: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageGlobalLib, 'PositionStorageInvalidError')
        })
      })

      describe('.maker', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            maker: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.maker).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if maker out of range', async () => {
          await expect(
            position.store({
              ...VALID_GLOBAL_POSITION,
              maker: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageGlobalLib, 'PositionStorageInvalidError')
        })
      })

      describe('.long', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            long: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.long).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if long out of range', async () => {
          await expect(
            position.store({
              ...VALID_GLOBAL_POSITION,
              long: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageGlobalLib, 'PositionStorageInvalidError')
        })
      })

      describe('.short', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            short: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.short).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if short out of range', async () => {
          await expect(
            position.store({
              ...VALID_GLOBAL_POSITION,
              short: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageGlobalLib, 'PositionStorageInvalidError')
        })
      })
    })

    describe('view functions', () => {
      viewFunctions(() => ({ position, validStoredPosition: VALID_GLOBAL_POSITION }))

      describe('#major', () => {
        context('long is max', () => {
          it('returns long magnitude', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, maker: 103, long: 102, short: 2 })
            expect(await position.major()).to.equal(102)
          })
        })

        context('short is max', () => {
          it('returns long magnitude', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, maker: 104, long: 2, short: 103 })
            expect(await position.major()).to.equal(103)
          })
        })
      })

      describe('#minor', () => {
        context('long is min', () => {
          it('returns long magnitude', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, maker: 1, long: 2, short: 102 })
            expect(await position.minor()).to.equal(2)
          })
        })

        context('short is min', () => {
          it('returns short magnitude', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, maker: 1, long: 102, short: 3 })
            expect(await position.minor()).to.equal(3)
          })
        })
      })

      describe('#skew', () => {
        const RISK_PARAM_WITH_SKEW_SCALE = {
          ...VALID_RISK_PARAMETER,
          skewScale: parse6decimal('100'),
        }
        context('skewScale is 0', () => {
          it('returns 0', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: 0 })
            expect(await position.skew()).to.equal(0)
          })
        })

        context('long is major', () => {
          it('returns (long - short)', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('102'), short: parse6decimal('2') })
            expect(await position.skew()).to.equal(parse6decimal('100'))
          })
        })

        context('short is major', () => {
          it('returns (long - short)', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('2'), short: parse6decimal('102') })
            expect(await position.skew()).to.equal(parse6decimal('-100'))
          })
        })
      })

      describe('#utilization', () => {
        const RISK_PARAM_WITH_EFFICIENCY_LIMIT = {
          ...VALID_RISK_PARAMETER,
          efficiencyLimit: parse6decimal('0.50'),
        }
        context('major is 0', () => {
          it('returns 0', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: 0 })
            expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(0)
          })
        })

        context('maker is 0', () => {
          context('long is major', () => {
            it('returns 1', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('102'),
                short: parse6decimal('2'),
                maker: 0,
              })
              expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(parse6decimal('1'))
            })

            context('minor is 0', () => {
              it('returns 1', async () => {
                await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('102'), short: 0, maker: 0 })
                expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(parse6decimal('1'))
              })
            })
          })

          context('short is major', () => {
            it('returns 1', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('2'),
                short: parse6decimal('102'),
                maker: 0,
              })
              expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(parse6decimal('1'))
            })

            context('minor is 0', () => {
              it('returns 1', async () => {
                await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: parse6decimal('102'), maker: 0 })
                expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(parse6decimal('1'))
              })
            })
          })
        })

        context('maker is non-0', () => {
          context('long is major', () => {
            it('returns long/(short + maker)', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('102'),
                short: parse6decimal('2'),
                maker: parse6decimal('110'),
              })
              expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(BigNumber.from('910714'))
            })
          })

          context('short is major', () => {
            it('returns short/(long + maker)', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('2'),
                short: parse6decimal('102'),
                maker: parse6decimal('110'),
              })
              expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(BigNumber.from('910714'))
            })
          })
        })

        context('high efficiency', () => {
          context('long is major', () => {
            it('uses efficiency utilization instead of net', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('190'),
                short: parse6decimal('180'),
                maker: parse6decimal('100'),
              })
              expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(BigNumber.from('950000'))
            })
          })

          context('short is major', () => {
            it('uses efficiency utilization instead of net', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('180'),
                short: parse6decimal('190'),
                maker: parse6decimal('100'),
              })
              expect(await position.utilization(RISK_PARAM_WITH_EFFICIENCY_LIMIT)).to.equal(BigNumber.from('950000'))
            })
          })
        })
      })

      describe('#longSocialized', () => {
        context('maker + short > long', () => {
          it('returns long', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('2'),
              short: parse6decimal('1'),
              maker: parse6decimal('2'),
            })
            expect(await position.longSocialized()).to.equal(parse6decimal('2'))
          })
        })

        context('maker + short < long', () => {
          it('returns maker + short', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('5'),
              short: parse6decimal('1'),
              maker: parse6decimal('2'),
            })
            expect(await position.longSocialized()).to.equal(parse6decimal('3'))
          })
        })
      })

      describe('#shortSocialized', () => {
        context('maker + long > short', () => {
          it('returns short', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('1'),
              short: parse6decimal('2'),
              maker: parse6decimal('2'),
            })
            expect(await position.shortSocialized()).to.equal(parse6decimal('2'))
          })
        })

        context('maker + long < short', () => {
          it('returns maker + long', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('1'),
              short: parse6decimal('5'),
              maker: parse6decimal('2'),
            })
            expect(await position.shortSocialized()).to.equal(parse6decimal('3'))
          })
        })
      })

      describe('#takerSocialized', () => {
        context('long is major', () => {
          context('maker + short > long', () => {
            it('returns long', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('2'),
                short: parse6decimal('1'),
                maker: parse6decimal('2'),
              })
              expect(await position.takerSocialized()).to.equal(parse6decimal('2'))
            })
          })

          context('maker + short < long', () => {
            it('returns maker + short', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('5'),
                short: parse6decimal('1'),
                maker: parse6decimal('2'),
              })
              expect(await position.takerSocialized()).to.equal(parse6decimal('3'))
            })
          })
        })

        context('short is major', () => {
          context('maker + long > short', () => {
            it('returns short', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('1'),
                short: parse6decimal('2'),
                maker: parse6decimal('2'),
              })
              expect(await position.takerSocialized()).to.equal(parse6decimal('2'))
            })
          })

          context('maker + long < short', () => {
            it('returns maker + long', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('1'),
                short: parse6decimal('5'),
                maker: parse6decimal('2'),
              })
              expect(await position.takerSocialized()).to.equal(parse6decimal('3'))
            })
          })
        })
      })

      describe('#efficiency', () => {
        context('major is 0', () => {
          it('returns 1', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: 0, maker: parse6decimal('100') })
            expect(await position.efficiency()).to.equal(parse6decimal('1'))
          })
        })

        context('maker is 0', () => {
          it('returns 0', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('100'), short: 0, maker: 0 })
            expect(await position.efficiency()).to.equal(0)
          })
        })

        context('long is major', () => {
          context('maker > long', () => {
            it('returns 1', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('1'),
                short: parse6decimal('1'),
                maker: parse6decimal('2'),
              })
              expect(await position.efficiency()).to.equal(parse6decimal('1'))
            })
          })

          context('maker < long', () => {
            it('returns maker/long', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('2'),
                short: parse6decimal('1'),
                maker: parse6decimal('1'),
              })
              expect(await position.efficiency()).to.equal(parse6decimal('0.5'))
            })
          })
        })

        context('short is major', () => {
          context('maker > short', () => {
            it('returns 1', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('1'),
                short: parse6decimal('1'),
                maker: parse6decimal('2'),
              })
              expect(await position.efficiency()).to.equal(parse6decimal('1'))
            })
          })

          context('maker < short', () => {
            it('returns maker/short', async () => {
              await position.store({
                ...VALID_GLOBAL_POSITION,
                long: parse6decimal('1'),
                short: parse6decimal('2'),
                maker: parse6decimal('1'),
              })
              expect(await position.efficiency()).to.equal(parse6decimal('0.5'))
            })
          })
        })
      })

      describe('#socialized', () => {
        context('maker + long > short', () => {
          it('returns false', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('1'),
              short: parse6decimal('2'),
              maker: parse6decimal('2'),
            })
            expect(await position.socialized()).to.equal(false)
          })
        })

        context('maker + long = short', () => {
          it('returns false', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('3'),
              short: parse6decimal('5'),
              maker: parse6decimal('2'),
            })
            expect(await position.socialized()).to.equal(false)
          })
        })

        context('maker + long < short', () => {
          it('returns true', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('1'),
              short: parse6decimal('5'),
              maker: parse6decimal('2'),
            })
            expect(await position.socialized()).to.equal(true)
          })
        })

        context('maker + short > long', () => {
          it('returns false', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('2'),
              short: parse6decimal('1'),
              maker: parse6decimal('2'),
            })
            expect(await position.socialized()).to.equal(false)
          })
        })

        context('maker + short = long', () => {
          it('returns false', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('5'),
              short: parse6decimal('3'),
              maker: parse6decimal('2'),
            })
            expect(await position.socialized()).to.equal(false)
          })
        })

        context('maker + short < long', () => {
          it('returns true', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('5'),
              short: parse6decimal('1'),
              maker: parse6decimal('2'),
            })
            expect(await position.socialized()).to.equal(true)
          })
        })
      })
    })

    describe('update functions', () => {
      describe('#update(currentId, currentTimestamp, order)', () => {
        it('updates the position and the order', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            maker: parse6decimal('40'),
            long: parse6decimal('11'),
            short: parse6decimal('12'),
          })

          const updatedOrder = await position.callStatic.update(VALID_ORDER)
          await position.update(VALID_ORDER)

          const value = await position.read()
          expect(value.timestamp).to.equal(123456)
          expect(value.maker).to.equal(parse6decimal('39'))
          expect(value.long).to.equal(parse6decimal('16'))
          expect(value.short).to.equal(parse6decimal('15'))
        })
      })
    })
  })

  describe('local position', () => {
    let positionStorageLocalLib: PositionStorageLocalLib
    let position: PositionLocalTester

    const VALID_LOCAL_POSITION: PositionStruct = {
      timestamp: 2,
      maker: 0, // only max(maker, long, short) is stored
      long: 0,
      short: 0,
    }

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()

      positionStorageLocalLib = await new PositionStorageLocalLib__factory(owner).deploy()
      position = await new PositionLocalTester__factory(
        { 'contracts/types/Position.sol:PositionStorageLocalLib': positionStorageLocalLib.address },
        owner,
      ).deploy()
    })

    describe('#store', () => {
      context('no position', () => {
        it('stores a new value', async () => {
          await position.store(VALID_LOCAL_POSITION)

          const value = await position.read()
          expect(value.timestamp).to.equal(2)
          expect(value.maker).to.equal(0)
          expect(value.long).to.equal(0)
          expect(value.short).to.equal(0)
        })
      })

      context('maker', () => {
        it('stores a new value', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, maker: 100 })

          const value = await position.read()
          expect(value.timestamp).to.equal(2)
          expect(value.maker).to.equal(100)
          expect(value.long).to.equal(0)
          expect(value.short).to.equal(0)
        })
      })

      context('long', () => {
        it('stores a new value', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, long: 100 })

          const value = await position.read()
          expect(value.timestamp).to.equal(2)
          expect(value.maker).to.equal(0)
          expect(value.long).to.equal(100)
          expect(value.short).to.equal(0)
        })
      })

      context('short', () => {
        it('stores a new value', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, short: 100 })

          const value = await position.read()
          expect(value.timestamp).to.equal(2)
          expect(value.maker).to.equal(0)
          expect(value.long).to.equal(0)
          expect(value.short).to.equal(100)
        })
      })

      describe('.timestamp', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            timestamp: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.timestamp).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if timestamp out of range', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              timestamp: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageLocalLib, 'PositionStorageInvalidError')
        })
      })

      describe('.maker', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            maker: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.maker).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if maker out of range', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              maker: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageLocalLib, 'PositionStorageInvalidError')
        })
      })

      describe('.long', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            long: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.long).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if long out of range', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              long: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageLocalLib, 'PositionStorageInvalidError')
        })
      })

      describe('.short', async () => {
        const STORAGE_SIZE = 62
        it('saves if in range', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            short: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.short).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if short out of range', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              short: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(positionStorageLocalLib, 'PositionStorageInvalidError')
        })
      })
    })

    describe('view functions', () => {
      viewFunctions(() => ({ position, validStoredPosition: VALID_LOCAL_POSITION }))

      describe('#maintenance', () => {
        context('0 position', () => {
          it('returns 0', async () => {
            expect(await position.maintenance(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER)).to.equal(0)
          })
        })

        context('non-zero position', () => {
          it('returns notional * riskParameter.maintenance', async () => {
            await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

            expect(
              await position.maintenance(
                { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                { ...VALID_RISK_PARAMETER, maintenance: parse6decimal('0.3') },
              ),
            ).to.equal(parse6decimal('180'))
          })

          context('riskParameter.minMaintenance > notional * riskParameter.maintenance', () => {
            it('returns riskParameter.minMaintenance', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.maintenance(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, maintenance: parse6decimal('0.3'), minMaintenance: parse6decimal('200') },
                ),
              ).to.equal(parse6decimal('200'))
            })
          })
        })
      })

      describe('#maintained', () => {
        context('0 position', () => {
          it('returns true', async () => {
            expect(await position.maintained(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER, 0)).to.be.true
          })

          context('collateral is negative', () => {
            it('returns true', async () => {
              expect(await position.maintained(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER, parse6decimal('-1'))).to.be
                .true
            })
          })
        })

        context('non-zero position', () => {
          context('collateral > notional * riskParameter.maintenance', () => {
            it('returns true', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.maintained(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, maintenance: parse6decimal('0.3') },
                  parse6decimal('181'),
                ),
              ).to.be.true
            })
          })

          context('collateral = notional * riskParameter.maintenance', () => {
            it('returns true', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.maintained(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, maintenance: parse6decimal('0.3') },
                  parse6decimal('180'),
                ),
              ).to.be.true
            })
          })

          context('collateral < notional * riskParameter.maintenance', () => {
            it('returns false', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.maintained(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, maintenance: parse6decimal('0.3') },
                  parse6decimal('179'),
                ),
              ).to.be.false
            })
          })

          context(
            'collateral < riskParameter.minMaintenance and riskParameter.minMaintenance > notional * riskParameter.maintenance',
            () => {
              it('returns riskParameter.minMaintenance', async () => {
                await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

                expect(
                  await position.maintained(
                    { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                    {
                      ...VALID_RISK_PARAMETER,
                      maintenance: parse6decimal('0.3'),
                      minMaintenance: parse6decimal('200'),
                    },
                    parse6decimal('199'),
                  ),
                ).to.be.false
              })
            },
          )
        })
      })

      describe('#margined', () => {
        context('0 position', () => {
          it('returns true', async () => {
            expect(await position.margined(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER, 0, 0)).to.be.true
          })

          context('collateral is negative', () => {
            it('returns true', async () => {
              expect(await position.margined(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER, 0, parse6decimal('-1'))).to.be
                .true
            })
          })
        })

        context('non-zero position', () => {
          context('collateral > notional * riskParameter.maintenance', () => {
            it('returns true', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.margined(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, margin: parse6decimal('0.3') },
                  0,
                  parse6decimal('181'),
                ),
              ).to.be.true
            })
          })

          context('collateral = notional * riskParameter.maintenance', () => {
            it('returns true', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.margined(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, margin: parse6decimal('0.3') },
                  0,
                  parse6decimal('180'),
                ),
              ).to.be.true
            })
          })

          context('collateral < notional * riskParameter.maintenance', () => {
            it('returns false', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.margined(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, margin: parse6decimal('0.3') },
                  0,
                  parse6decimal('179'),
                ),
              ).to.be.false
            })
          })

          context('collateral < notional * collateralization', () => {
            it('returns false', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.margined(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  { ...VALID_RISK_PARAMETER, margin: parse6decimal('0.3') },
                  parse6decimal('0.35'),
                  parse6decimal('180'),
                ),
              ).to.be.false
            })
          })

          context(
            'collateral < riskParameter.minMaintenance and riskParameter.minMaintenance > notional * riskParameter.maintenance',
            () => {
              it('returns riskParameter.minMaintenance', async () => {
                await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

                expect(
                  await position.margined(
                    { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                    {
                      ...VALID_RISK_PARAMETER,
                      margin: parse6decimal('0.3'),
                      minMargin: parse6decimal('200'),
                    },
                    parse6decimal('199'),
                    0,
                  ),
                ).to.be.false
              })
            },
          )
        })
      })

      describe('#margin', () => {
        it('margin is positive', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })
          expect(await position.margin(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER)).to.equals(9000)
        })
      })
    })
  })
})

function viewFunctions(
  getter: () => {
    position: PositionGlobalTester | PositionLocalTester
    validStoredPosition: PositionStruct
  },
) {
  let position: PositionGlobalTester | PositionLocalTester
  let validStoredPosition: PositionStruct

  beforeEach(async () => {
    ;({ position, validStoredPosition } = getter())
  })

  describe('#magnitude', () => {
    context('maker is max', () => {
      it('returns maker magnitude', async () => {
        await position.store({ ...validStoredPosition, maker: 101, long: 1, short: 2 })
        expect(await position.magnitude()).to.equal(101)
      })
    })

    context('long is max', () => {
      it('returns long magnitude', async () => {
        await position.store({ ...validStoredPosition, maker: 1, long: 102, short: 2 })
        expect(await position.magnitude()).to.equal(102)
      })
    })

    context('short is max', () => {
      it('returns long magnitude', async () => {
        await position.store({ ...validStoredPosition, maker: 1, long: 2, short: 103 })
        expect(await position.magnitude()).to.equal(103)
      })
    })
  })
}
