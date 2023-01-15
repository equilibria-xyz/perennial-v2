import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'

export interface Position {
  maker: BigNumberish
  long: BigNumberish
  short: BigNumberish
  makerNext: BigNumberish
  longNext: BigNumberish
  shortNext: BigNumberish
}

export interface ProgramInfo {
  coordinatorId: BigNumberish
  token: string
  amount: {
    maker: BigNumberish
    taker: BigNumberish
  }
  start: BigNumberish
  duration: BigNumberish
}

export function expectPositionEq(a: Position, b: Position): void {
  expect(a.maker).to.equal(b.maker)
  expect(a.long).to.equal(b.long)
  expect(a.short).to.equal(b.short)
  expect(a.makerNext).to.equal(b.makerNext)
  expect(a.longNext).to.equal(b.longNext)
  expect(a.shortNext).to.equal(b.shortNext)
}

export function expectProgramInfoEq(a: ProgramInfo, b: ProgramInfo): void {
  expect(a.coordinatorId).to.equal(b.coordinatorId)
  expect(a.token).to.equal(b.token)
  expect(a.amount.maker).to.equal(b.amount.maker)
  expect(a.amount.taker).to.equal(b.amount.taker)
  expect(a.start).to.equal(b.start)
  expect(a.duration).to.equal(b.duration)
}

export function parse6decimal(amount: string): BigNumber {
  return utils.parseEther(amount).div(1e12)
}

export class Big18Math {
  public static BASE = constants.WeiPerEther

  public static mul(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(b).div(this.BASE)
  }

  public static div(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(this.BASE).div(b)
  }
}

export class Big6Math {
  public static BASE = BigNumber.from(1_000_000)

  public static mul(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(b).div(this.BASE)
  }

  public static div(a: BigNumber, b: BigNumber): BigNumber {
    return a.mul(this.BASE).div(b)
  }
}
