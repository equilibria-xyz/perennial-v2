import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  PositionGlobalTester,
  PositionGlobalTester__factory,
  PositionLocalTester,
  PositionLocalTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { parse6decimal } from '../../../../common/testutil/types'
import { OracleVersionStruct, PositionStruct } from '../../../types/generated/contracts/Market'
import { VALID_RISK_PARAMETER } from './RiskParameter.test'
import { OrderStruct } from '../../../types/generated/contracts/test/PositionTester.sol/PositionGlobalTester'

const { ethers } = HRE
use(smock.matchers)

export const VALID_ORACLE_VERSION: OracleVersionStruct = {
  timestamp: 12345,
  price: parse6decimal('100'),
  valid: true,
}

const VALID_ORDER: OrderStruct = {
  maker: parse6decimal('1'),
  long: parse6decimal('2'),
  short: parse6decimal('3'),
  skew: 1, // set by update
  impact: 2, // set by update
  efficiency: 3, // set by update
  fee: 4, // unused
  keeper: 5, // unused
  utilization: 6, // unused
  net: 7, // unused
}

describe('Position', () => {
  let owner: SignerWithAddress

  describe('global position', () => {
    let position: PositionGlobalTester

    const VALID_GLOBAL_POSITION: PositionStruct = {
      timestamp: 2,
      maker: 3,
      long: 4,
      short: 5,
      fee: 6,
      keeper: 7,
      collateral: 123456890, // not stored
      delta: 9876543210, // not stored
    }

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()

      position = await new PositionGlobalTester__factory(owner).deploy()
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await position.store(VALID_GLOBAL_POSITION)

        const value = await position.read()
        expect(value.timestamp).to.equal(2)
        expect(value.maker).to.equal(3)
        expect(value.long).to.equal(4)
        expect(value.short).to.equal(5)
        expect(value.fee).to.equal(6)
        expect(value.keeper).to.equal(7)
        expect(value.collateral).to.equal(0)
        expect(value.delta).to.equal(0)
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.fee', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            fee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.fee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if fee out of range', async () => {
          await expect(
            position.store({
              ...VALID_GLOBAL_POSITION,
              fee: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.keeper', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            keeper: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.keeper).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if keeper out of range', async () => {
          await expect(
            position.store({
              ...VALID_GLOBAL_POSITION,
              keeper: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
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

      describe('#net', () => {
        context('long is min', () => {
          it('returns abs(long - short)', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, maker: 1, long: 2, short: 102 })
            expect(await position.net()).to.equal(100)
          })
        })

        context('short is min', () => {
          it('returns abs(long - short)', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, maker: 1, long: 102, short: 3 })
            expect(await position.net()).to.equal(99)
          })
        })
      })

      describe('#skew', () => {
        context('major is 0', () => {
          it('returns 0', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: 0 })
            expect(await position.skew()).to.equal(0)
          })
        })

        context('long is major', () => {
          it('returns (long - short)/long', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('102'), short: parse6decimal('2') })
            expect(await position.skew()).to.equal(BigNumber.from('980392'))
          })
        })

        context('short is major', () => {
          it('returns (short - long)/short', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('2'), short: parse6decimal('102') })
            expect(await position.skew()).to.equal(BigNumber.from('-980392'))
          })
        })
      })

      describe('#virtualSkew', () => {
        const RISK_PARAM_WITH_VIRTUAL_TAKER = {
          ...VALID_RISK_PARAMETER,
          virtualTaker: parse6decimal('100'),
        }
        context('major is 0', () => {
          it('returns 0', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: 0 })
            expect(await position.virtualSkew(RISK_PARAM_WITH_VIRTUAL_TAKER)).to.equal(0)
          })
        })

        context('long is major', () => {
          it('returns (long - short)/(long + virtualTaker)', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('102'), short: parse6decimal('2') })
            expect(await position.virtualSkew(RISK_PARAM_WITH_VIRTUAL_TAKER)).to.equal(BigNumber.from('495049'))
          })
        })

        context('short is major', () => {
          it('returns (short - long)/(short + virtualTaker)', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('2'), short: parse6decimal('102') })
            expect(await position.virtualSkew(RISK_PARAM_WITH_VIRTUAL_TAKER)).to.equal(BigNumber.from('-495049'))
          })
        })
      })

      describe('#utilization', () => {
        context('major is 0', () => {
          it('returns 0', async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: 0 })
            expect(await position.utilization()).to.equal(0)
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
              expect(await position.utilization()).to.equal(parse6decimal('1'))
            })

            context('minor is 0', () => {
              it('returns 1', async () => {
                await position.store({ ...VALID_GLOBAL_POSITION, long: parse6decimal('102'), short: 0, maker: 0 })
                expect(await position.utilization()).to.equal(parse6decimal('1'))
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
              expect(await position.utilization()).to.equal(parse6decimal('1'))
            })

            context('minor is 0', () => {
              it('returns 1', async () => {
                await position.store({ ...VALID_GLOBAL_POSITION, long: 0, short: parse6decimal('102'), maker: 0 })
                expect(await position.utilization()).to.equal(parse6decimal('1'))
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
              expect(await position.utilization()).to.equal(BigNumber.from('910714'))
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
              expect(await position.utilization()).to.equal(BigNumber.from('910714'))
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

      describe('#singleSided', () => {
        context('only makers', () => {
          it('returns true', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: 0,
              short: 0,
              maker: parse6decimal('2'),
            })
            expect(await position.singleSided()).to.equal(true)
          })
        })

        context('only longs', () => {
          it('returns true', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('2'),
              short: 0,
              maker: 0,
            })
            expect(await position.singleSided()).to.equal(true)
          })
        })

        context('only shorts', () => {
          it('returns true', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: 0,
              short: parse6decimal('2'),
              maker: 0,
            })
            expect(await position.singleSided()).to.equal(true)
          })
        })

        context('mix of positions', () => {
          it('returns false', async () => {
            await position.store({
              ...VALID_GLOBAL_POSITION,
              long: parse6decimal('1'),
              short: parse6decimal('1'),
              maker: parse6decimal('1'),
            })
            expect(await position.singleSided()).to.equal(false)
          })
        })
      })
    })

    describe('update functions', () => {
      describe('#update(newPosition)', () => {
        it('updates the position to the new position', async () => {
          await position.store(VALID_GLOBAL_POSITION)

          await position['update((uint256,uint256,uint256,uint256,uint256,uint256,int256,int256))']({
            timestamp: 20,
            maker: 30,
            long: 40,
            short: 50,
            fee: 60, // not updated
            keeper: 70, // not updated
            collateral: 123456890, // not stored
            delta: 9876543210, // not stored
          })

          const value = await position.read()
          expect(value.timestamp).to.equal(20)
          expect(value.maker).to.equal(30)
          expect(value.long).to.equal(40)
          expect(value.short).to.equal(50)
          expect(value.fee).to.equal(6)
          expect(value.keeper).to.equal(7)
          expect(value.collateral).to.equal(0)
          expect(value.delta).to.equal(0)
        })
      })

      describe('#update(currentId, currentTimestamp, order)', () => {
        it('updates the position and the order', async () => {
          await position.store({
            ...VALID_GLOBAL_POSITION,
            maker: parse6decimal('40'),
            long: parse6decimal('11'),
            short: parse6decimal('12'),
            fee: parse6decimal('100'),
          })
          const latestSkew = await position.skew()
          const latestEfficiency = await position.efficiency()

          const updatedOrder = await position.callStatic[
            'update(uint256,(int256,int256,int256,int256,uint256,int256,int256,int256,uint256,uint256),(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,(uint256,uint256,uint256,uint256),(uint256,uint256),uint256,uint256,uint256,bool))'
          ](123456, VALID_ORDER, VALID_RISK_PARAMETER)

          await position[
            'update(uint256,(int256,int256,int256,int256,uint256,int256,int256,int256,uint256,uint256),(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,(uint256,uint256,uint256,uint256),(uint256,uint256),uint256,uint256,uint256,bool))'
          ](123456, VALID_ORDER, VALID_RISK_PARAMETER)

          const value = await position.read()
          expect(value.timestamp).to.equal(123456)
          expect(value.maker).to.equal(parse6decimal('41'))
          expect(value.long).to.equal(parse6decimal('13'))
          expect(value.short).to.equal(parse6decimal('15'))
          expect(value.fee).to.equal(parse6decimal('100'))

          const skew = await position.skew()
          const efficiency = await position.efficiency()

          expect(updatedOrder.skew).to.equal(skew.sub(latestSkew).abs())
          expect(updatedOrder.impact).to.equal(skew.abs().sub(latestSkew.abs()))
          expect(updatedOrder.efficiency).to.equal(efficiency.sub(latestEfficiency))
          expect(updatedOrder.net).to.equal(parse6decimal('1'))
          expect(updatedOrder.utilization).to.equal(BigNumber.from('42483'))
        })

        context('same ID', async () => {
          it("doesn't clear fee or keeper", async () => {
            await position.store({ ...VALID_GLOBAL_POSITION, fee: 50, keeper: 60 })

            await position[
              'update(uint256,(int256,int256,int256,int256,uint256,int256,int256,int256,uint256,uint256),(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,(uint256,uint256,uint256,uint256),(uint256,uint256),uint256,uint256,uint256,bool))'
            ](123456, VALID_ORDER, VALID_RISK_PARAMETER)

            const value = await position.read()
            expect(value.fee).to.equal(50)
            expect(value.keeper).to.equal(60)
          })
        })
      })

      describe('#invalidate', () => {
        it('sets the position to latestPosition and zeroes fee', async () => {
          const latestPosition = {
            ...VALID_GLOBAL_POSITION,
            maker: 50,
            long: 60,
            short: 70,
          }

          await position.store({ ...VALID_GLOBAL_POSITION, fee: 100 })

          await position.invalidate(latestPosition)
          const value = await position.read()

          expect(value.maker).to.equal(50)
          expect(value.long).to.equal(60)
          expect(value.short).to.equal(70)
          expect(value.fee).to.equal(0)
        })
      })

      describe('#sync', () => {
        it('sets the position to latestPosition and zeroes fee', async () => {
          await position.store({ ...VALID_GLOBAL_POSITION, fee: 100, keeper: 10 })

          await position.sync(VALID_ORACLE_VERSION)
          const value = await position.read()

          expect(value.timestamp).to.equal(12345)
          expect(value.fee).to.equal(0)
          expect(value.keeper).to.equal(0)
        })
      })

      describe('#registerFee', () => {
        it('updates the fees', async () => {
          await position.store({ ...VALID_GLOBAL_POSITION, fee: 50, keeper: 10 })

          await position.registerFee({ ...VALID_ORDER, fee: 10, keeper: 20 })

          const value = await position.read()
          expect(value.fee).to.equal(60)
          expect(value.keeper).to.equal(30)
        })
      })
    })
  })

  describe('local position', () => {
    let position: PositionLocalTester

    const VALID_LOCAL_POSITION: PositionStruct = {
      timestamp: 2,
      maker: 0, // only max(maker, long, short) is stored
      long: 0,
      short: 0,
      fee: 3,
      keeper: 4,
      collateral: 5,
      delta: 6,
    }

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()

      position = await new PositionLocalTester__factory(owner).deploy()
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
          expect(value.fee).to.equal(3)
          expect(value.keeper).to.equal(4)
          expect(value.collateral).to.equal(5)
          expect(value.delta).to.equal(6)
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
          expect(value.fee).to.equal(3)
          expect(value.keeper).to.equal(4)
          expect(value.collateral).to.equal(5)
          expect(value.delta).to.equal(6)
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
          expect(value.fee).to.equal(3)
          expect(value.keeper).to.equal(4)
          expect(value.collateral).to.equal(5)
          expect(value.delta).to.equal(6)
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
          expect(value.fee).to.equal(3)
          expect(value.keeper).to.equal(4)
          expect(value.collateral).to.equal(5)
          expect(value.delta).to.equal(6)
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.maker', async () => {
        const STORAGE_SIZE = 64
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.long', async () => {
        const STORAGE_SIZE = 64
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.short', async () => {
        const STORAGE_SIZE = 64
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
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.fee', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            fee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.fee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if fee out of range', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              fee: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.keeper', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            keeper: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.keeper).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if keeper out of range', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              keeper: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.collateral', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await position.read()
          expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if collateral out of range (above)', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              collateral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })

        it('reverts if collateral out of range (below)', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })
      })

      describe('.delta', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            delta: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await position.read()
          expect(value.delta).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await position.store({
            ...VALID_LOCAL_POSITION,
            delta: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await position.read()
          expect(value.delta).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if delta out of range (above)', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              delta: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
        })

        it('reverts if delta out of range (below)', async () => {
          await expect(
            position.store({
              ...VALID_LOCAL_POSITION,
              delta: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(position, 'PositionStorageInvalidError')
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

      describe('#collateralized', () => {
        context('0 position', () => {
          it('returns true', async () => {
            expect(await position.collateralized(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER, 0)).to.be.true
          })

          context('collateral is negative', () => {
            it('returns true', async () => {
              expect(await position.collateralized(VALID_ORACLE_VERSION, VALID_RISK_PARAMETER, parse6decimal('-1'))).to
                .be.true
            })
          })
        })

        context('non-zero position', () => {
          context('collateral > notional * riskParameter.maintenance', () => {
            it('returns true', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.collateralized(
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
                await position.collateralized(
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
                await position.collateralized(
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
                  await position.collateralized(
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

      describe('#liquidationFee', () => {
        it('returns notional * riskParameter.maintenance * riskParameter.liquidationFee', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

          expect(
            await position.liquidationFee(
              { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
              {
                ...VALID_RISK_PARAMETER,
                maintenance: parse6decimal('0.3'),
                liquidationFee: parse6decimal('0.1'),
                maxLiquidationFee: parse6decimal('1000'),
              },
            ),
          ).to.equal(parse6decimal('18'))
        })

        context('riskParameter.minMaintenance > notional * riskParameter.maintenance', () => {
          it('returns riskParameter.minMaintenance * riskParameter.liquidationFee', async () => {
            await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

            expect(
              await position.liquidationFee(
                { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                {
                  ...VALID_RISK_PARAMETER,
                  maintenance: parse6decimal('0.3'),
                  minMaintenance: parse6decimal('200'),
                  liquidationFee: parse6decimal('0.1'),
                  maxLiquidationFee: parse6decimal('1000'),
                },
              ),
            ).to.equal(parse6decimal('20'))
          })
        })

        context(
          'riskParameter.maxLiquidationFee < notional * riskParameter.maintenance * riskParameter.liquidationFee',
          () => {
            it('returns riskParameter.maxLiquidationFee', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.liquidationFee(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  {
                    ...VALID_RISK_PARAMETER,
                    maintenance: parse6decimal('0.3'),
                    maxLiquidationFee: parse6decimal('5'),
                    liquidationFee: parse6decimal('0.1'),
                  },
                ),
              ).to.equal(parse6decimal('5'))
            })
          },
        )

        context(
          'riskParameter.minLiquidationFee > notional * riskParameter.maintenance * riskParameter.liquidationFee',
          () => {
            it('returns riskParameter.minLiquidationFee', async () => {
              await position.store({ ...VALID_LOCAL_POSITION, maker: parse6decimal('6') })

              expect(
                await position.liquidationFee(
                  { ...VALID_ORACLE_VERSION, price: parse6decimal('100') },
                  {
                    ...VALID_RISK_PARAMETER,
                    maintenance: parse6decimal('0.3'),
                    minLiquidationFee: parse6decimal('50'),
                    liquidationFee: parse6decimal('0.1'),
                  },
                ),
              ).to.equal(parse6decimal('50'))
            })
          },
        )
      })
    })

    describe('update functions', () => {
      describe('#update(newPosition)', () => {
        it('updates the position to the new position', async () => {
          await position.store(VALID_LOCAL_POSITION)

          await position['update((uint256,uint256,uint256,uint256,uint256,uint256,int256,int256))']({
            timestamp: 20,
            maker: 0, // only max is stored
            long: 0, // only max is stored
            short: 50,
            fee: 60, // not updated
            keeper: 70, // not updated
            collateral: 123456890, // not updated
            delta: 9876543210, // not updated
          })

          const value = await position.read()
          expect(value.timestamp).to.equal(20)
          expect(value.maker).to.equal(0)
          expect(value.long).to.equal(0)
          expect(value.short).to.equal(50)
          expect(value.fee).to.equal(3)
          expect(value.keeper).to.equal(4)
          expect(value.collateral).to.equal(5)
          expect(value.delta).to.equal(6)
        })
      })

      describe('#update(currentId, currentTimestamp, newMaker, newLong, newShort)', () => {
        context('maker order (increase)', () => {
          it('updates the position and returns the newOrder', async () => {
            await position.store(VALID_LOCAL_POSITION)

            const newOrder = await position.callStatic['update(uint256,uint256,uint256,uint256)'](20, 30, 0, 0)
            await position['update(uint256,uint256,uint256,uint256)'](20, 30, 0, 0)

            const value = await position.read()

            expect(value.timestamp).to.equal(20)
            expect(value.maker).to.equal(30)
            expect(value.long).to.equal(0)
            expect(value.short).to.equal(0)
            expect(value.fee).to.equal(VALID_LOCAL_POSITION.fee)
            expect(value.keeper).to.equal(VALID_LOCAL_POSITION.keeper)
            expect(value.collateral).to.equal(VALID_LOCAL_POSITION.collateral)
            expect(value.delta).to.equal(VALID_LOCAL_POSITION.delta)

            expect(newOrder.maker).to.equal(30)
            expect(newOrder.long).to.equal(0)
            expect(newOrder.short).to.equal(0)
          })
        })

        context('maker order (decrease)', () => {
          it('updates the position and returns the newOrder', async () => {
            await position.store({ ...VALID_LOCAL_POSITION, maker: 50 })

            const newOrder = await position.callStatic['update(uint256,uint256,uint256,uint256)'](20, 30, 0, 0)
            await position['update(uint256,uint256,uint256,uint256)'](20, 30, 0, 0)

            const value = await position.read()

            expect(value.timestamp).to.equal(20)
            expect(value.maker).to.equal(30)
            expect(value.long).to.equal(0)
            expect(value.short).to.equal(0)
            expect(value.fee).to.equal(VALID_LOCAL_POSITION.fee)
            expect(value.keeper).to.equal(VALID_LOCAL_POSITION.keeper)
            expect(value.collateral).to.equal(VALID_LOCAL_POSITION.collateral)
            expect(value.delta).to.equal(VALID_LOCAL_POSITION.delta)

            expect(newOrder.maker).to.equal(-20)
            expect(newOrder.long).to.equal(0)
            expect(newOrder.short).to.equal(0)
          })
        })

        context('long order (increase)', () => {
          it('updates the position and returns the newOrder', async () => {
            await position.store(VALID_LOCAL_POSITION)

            const newOrder = await position.callStatic['update(uint256,uint256,uint256,uint256)'](20, 0, 30, 0)
            await position['update(uint256,uint256,uint256,uint256)'](20, 0, 30, 0)

            const value = await position.read()

            expect(value.timestamp).to.equal(20)
            expect(value.maker).to.equal(0)
            expect(value.long).to.equal(30)
            expect(value.short).to.equal(0)
            expect(value.fee).to.equal(VALID_LOCAL_POSITION.fee)
            expect(value.keeper).to.equal(VALID_LOCAL_POSITION.keeper)
            expect(value.collateral).to.equal(VALID_LOCAL_POSITION.collateral)
            expect(value.delta).to.equal(VALID_LOCAL_POSITION.delta)

            expect(newOrder.maker).to.equal(0)
            expect(newOrder.long).to.equal(30)
            expect(newOrder.short).to.equal(0)
          })
        })

        context('long order (decrease)', () => {
          it('updates the position and returns the newOrder', async () => {
            await position.store({ ...VALID_LOCAL_POSITION, long: 50 })

            const newOrder = await position.callStatic['update(uint256,uint256,uint256,uint256)'](20, 0, 30, 0)
            await position['update(uint256,uint256,uint256,uint256)'](20, 0, 30, 0)

            const value = await position.read()

            expect(value.timestamp).to.equal(20)
            expect(value.maker).to.equal(0)
            expect(value.long).to.equal(30)
            expect(value.short).to.equal(0)
            expect(value.fee).to.equal(VALID_LOCAL_POSITION.fee)
            expect(value.keeper).to.equal(VALID_LOCAL_POSITION.keeper)
            expect(value.collateral).to.equal(VALID_LOCAL_POSITION.collateral)
            expect(value.delta).to.equal(VALID_LOCAL_POSITION.delta)

            expect(newOrder.maker).to.equal(0)
            expect(newOrder.long).to.equal(-20)
            expect(newOrder.short).to.equal(0)
          })
        })

        context('short order (increase)', () => {
          it('updates the position and returns the newOrder', async () => {
            await position.store(VALID_LOCAL_POSITION)

            const newOrder = await position.callStatic['update(uint256,uint256,uint256,uint256)'](20, 0, 0, 30)
            await position['update(uint256,uint256,uint256,uint256)'](20, 0, 0, 30)

            const value = await position.read()

            expect(value.timestamp).to.equal(20)
            expect(value.maker).to.equal(0)
            expect(value.long).to.equal(0)
            expect(value.short).to.equal(30)
            expect(value.fee).to.equal(VALID_LOCAL_POSITION.fee)
            expect(value.keeper).to.equal(VALID_LOCAL_POSITION.keeper)
            expect(value.collateral).to.equal(VALID_LOCAL_POSITION.collateral)
            expect(value.delta).to.equal(VALID_LOCAL_POSITION.delta)

            expect(newOrder.maker).to.equal(0)
            expect(newOrder.long).to.equal(0)
            expect(newOrder.short).to.equal(30)
          })
        })

        context('short order (decrease)', () => {
          it('updates the position and returns the newOrder', async () => {
            await position.store({ ...VALID_LOCAL_POSITION, short: 50 })

            const newOrder = await position.callStatic['update(uint256,uint256,uint256,uint256)'](20, 0, 0, 30)
            await position['update(uint256,uint256,uint256,uint256)'](20, 0, 0, 30)

            const value = await position.read()

            expect(value.timestamp).to.equal(20)
            expect(value.maker).to.equal(0)
            expect(value.long).to.equal(0)
            expect(value.short).to.equal(30)
            expect(value.fee).to.equal(VALID_LOCAL_POSITION.fee)
            expect(value.keeper).to.equal(VALID_LOCAL_POSITION.keeper)
            expect(value.collateral).to.equal(VALID_LOCAL_POSITION.collateral)
            expect(value.delta).to.equal(VALID_LOCAL_POSITION.delta)

            expect(newOrder.maker).to.equal(0)
            expect(newOrder.long).to.equal(0)
            expect(newOrder.short).to.equal(-20)
          })
        })

        context('same ID', () => {
          it("doesn't clear fee, keeper, or collateral", async () => {
            await position.store({ ...VALID_LOCAL_POSITION, fee: 50, keeper: 60, collateral: 70 })

            await position['update(uint256,uint256,uint256,uint256)'](20, 30, 0, 0)

            const value = await position.read()
            expect(value.fee).to.equal(50)
            expect(value.keeper).to.equal(60)
            expect(value.collateral).to.equal(70)
          })
        })
      })

      describe('#update(collateralAmount)', () => {
        it('updates the delta (increase)', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, delta: 50 })

          await position['update(int256)'](10)

          const value = await position.read()
          expect(value.delta).to.equal(60)
        })

        it('updates the delta (decrease)', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, delta: 50 })

          await position['update(int256)'](-10)

          const value = await position.read()
          expect(value.delta).to.equal(40)
        })
      })

      describe('#invalidate', () => {
        it('sets the position to latestPosition and zeroes fee', async () => {
          const latestPosition = {
            ...VALID_LOCAL_POSITION,
            short: 70,
          }

          await position.store({ ...VALID_LOCAL_POSITION, fee: 100 })

          await position.invalidate(latestPosition)
          const value = await position.read()

          expect(value.maker).to.equal(0)
          expect(value.long).to.equal(0)
          expect(value.short).to.equal(70)
          expect(value.fee).to.equal(0)
        })
      })

      describe('#registerFee', () => {
        it('updates the fees', async () => {
          await position.store({ ...VALID_LOCAL_POSITION, fee: 50, keeper: 10 })

          await position.registerFee({ ...VALID_ORDER, fee: 10, keeper: 20 })

          const value = await position.read()
          expect(value.fee).to.equal(60)
          expect(value.keeper).to.equal(30)
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

  describe('#ready', () => {
    context('oracleVersion.timestamp > position.timestamp', () => {
      it('returns true', async () => {
        await position.store(validStoredPosition)
        expect(await position.ready(VALID_ORACLE_VERSION)).to.be.true
      })
    })

    context('position.timestamp = oracleVersion.timestamp', () => {
      it('returns true', async () => {
        await position.store({ ...validStoredPosition, timestamp: VALID_ORACLE_VERSION.timestamp })
        expect(await position.ready(VALID_ORACLE_VERSION)).to.be.true
      })
    })

    context('oracleVersion.timestamp < position.timestamp', () => {
      it('returns false', async () => {
        await position.store({
          ...validStoredPosition,
          timestamp: BigNumber.from(VALID_ORACLE_VERSION.timestamp).add(1),
        })
        expect(await position.ready(VALID_ORACLE_VERSION)).to.be.false
      })
    })
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
