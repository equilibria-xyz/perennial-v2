import { BigNumber, BigNumberish } from 'ethers'
import { IMarket, PositionStruct } from '../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { LocalStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'
import { TriggerOrderStruct } from '../../types/generated/contracts/MultiInvoker'

export function setMarketPosition(market: FakeContract<IMarket>, user: SignerWithAddress, position: PositionStruct) {
  market.positions.whenCalledWith(user.address).returns(position)
}

export function setMarketLocal(market: FakeContract<IMarket>, user: SignerWithAddress, local: LocalStruct) {
  market.locals.whenCalledWith(user.address).returns(local)
}

export function setGlobalPrice(market: FakeContract<IMarket>, price: BigNumberish) {
  market.global.returns(['0', '0', '0', '0', '0', '0', ['0', '0'], price])
}

export function setPendingPosition(
  market: FakeContract<IMarket>,
  user: SignerWithAddress,
  currentId: BigNumberish,
  position: PositionStruct,
) {
  market.locals.reset()
  market.pendingPosition.reset()
  market.locals.whenCalledWith(user).returns(currentId)
  market.pendingPositions.whenCalledWith(user.address, currentId).returns(position)
}

export type Dir = 'L' | 'S'
export type TriggerType = 'LM' | 'TP' | 'SL'
export type TriggerOrder = {
  side: number
  fee: BigNumberish
  price: BigNumberish
  delta: BigNumberish
}

export const openTriggerOrder = ({
  size,
  price,
  side,
  trigger,
  feePct,
}: {
  size: BigNumberish
  price: BigNumberish
  side?: Dir
  trigger?: TriggerType
  feePct?: BigNumberish
}): TriggerOrderStruct => {
  if (feePct === undefined) {
    feePct = BigNumber.from(size).div(20)
  } else {
    if (BigNumber.from(feePct).gt(100)) throw Error('Specified fee pct too large')
  }

  if (BigNumber.from(size).isNegative()) throw Error('size must be positive')

  return {
    side: side ? (side === 'L' ? 1 : 2) : 1,
    comparison: 0,
    fee: feePct,
    price: price,
    delta: !trigger || trigger == 'LM' ? size : BigNumber.from(size).mul(-1),
  }
}

export const openPosition = ({
  maker,
  long,
  short,
  collateral,
  timestamp,
}: {
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  timestamp?: BigNumberish
}): PositionStruct => {
  const position: PositionStruct = {
    timestamp: timestamp ? timestamp : '0',
    maker: maker ? maker : '0',
    long: long ? long : '0',
    short: short ? short : '0',
    fee: '0',
    collateral: collateral ? collateral : '0',
    delta: '0',
    keeper: '0',
  }

  return position
}

export const changePosition = ({
  position,
  makerDelta,
  longDelta,
  shortDelta,
  collateralDelta,
  timestampDelta,
}: {
  position: PositionStruct
  makerDelta?: BigNumberish
  longDelta?: BigNumberish
  shortDelta?: BigNumberish
  collateralDelta?: BigNumberish
  timestampDelta?: BigNumberish
}): PositionStruct => {
  position.maker = makerDelta ? BigNumber.from(position.maker).add(makerDelta) : position.maker
  position.long = longDelta ? BigNumber.from(position.long).add(longDelta) : position.long
  position.short = shortDelta ? BigNumber.from(position.short).add(shortDelta) : position.short
  position.collateral = collateralDelta ? BigNumber.from(position.collateral).add(collateralDelta) : position.collateral
  position.timestamp = timestampDelta ? BigNumber.from(position.timestamp).add(timestampDelta) : position.timestamp

  return position
}

module.exports = {
  setMarketPosition,
  setPendingPosition,
  setGlobalPrice,
  openTriggerOrder,
  openPosition,
  changePosition,
}
