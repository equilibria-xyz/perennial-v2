import { BigNumber, BigNumberish, constants } from 'ethers'
import { IMarket, PositionStruct } from '../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { LocalStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'
import { parse6decimal } from '../../../common/testutil/types'

export function setMarketPosition(
  market: FakeContract<IMarket>,
  user: SignerWithAddress,
  position: PositionStruct,
): void {
  market.positions.whenCalledWith(user.address).returns(position)
}

export function setMarketLocal(market: FakeContract<IMarket>, user: SignerWithAddress, local: LocalStruct): void {
  market.locals.whenCalledWith(user.address).returns(local)
}

export function setGlobalPrice(market: FakeContract<IMarket>, price: BigNumberish): void {
  market.global.returns(['0', '0', '0', '0', '0', '0', ['0', '0'], price])
}

export function setPendingPosition(
  market: FakeContract<IMarket>,
  user: SignerWithAddress,
  currentId: BigNumberish,
  position: PositionStruct,
): void {
  market.locals.reset()
  market.pendingPosition.reset()
  market.locals.whenCalledWith(user).returns(currentId)
  market.pendingPositions.whenCalledWith(user.address, currentId).returns(position)
}

export enum Dir {
  M = 0,
  L = 1,
  S = 2,
  C = 3,
}

export enum Compare {
  ABOVE_MARKET = -1,
  BELOW_MARKET = 1,
}

export type InterfaceFeeStruct = {
  amount: BigNumberish
  receiver: string | undefined
  unwrap: boolean
}

export type TriggerOrder = {
  side: number
  fee: BigNumberish
  price: BigNumberish
  delta: BigNumberish
}

export type TriggerOrderStruct = {
  side: BigNumberish
  comparison: BigNumberish
  fee: BigNumberish
  price: BigNumberish
  delta: BigNumberish
  interfaceFee: InterfaceFeeStruct
}

export const openTriggerOrder = ({
  delta,
  price,
  side,
  comparison,
  fee,
  interfaceFee,
}: {
  delta: BigNumberish
  price: BigNumberish
  side: Dir | number
  comparison: Compare | number
  fee?: BigNumberish
  interfaceFee?: InterfaceFeeStruct
}): TriggerOrderStruct => {
  return {
    side: side,
    comparison: comparison,
    fee: fee ?? parse6decimal('10'),
    price: price,
    delta: delta,
    interfaceFee: interfaceFee ?? {
      amount: 0,
      receiver: constants.AddressZero,
      unwrap: false,
    },
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
    invalidation: {
      maker: 0,
      long: 0,
      short: 0,
    },
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
  Compare,
  Dir,
}
