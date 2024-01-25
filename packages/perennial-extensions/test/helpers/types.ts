import { BigNumber, BigNumberish, constants } from 'ethers'
import { IMarket, PositionStruct } from '../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { LocalStruct } from '@equilibria/perennial-v2/types/generated/contracts/Market'
import { InterfaceFeeStruct, TriggerOrderStruct } from '../../types/generated/contracts/MultiInvoker'
import { parse6decimal } from '../../../common/testutil/types'
import { OrderStruct } from './invoke'

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

export type TriggerOrder = {
  side: number
  fee: BigNumberish
  price: BigNumberish
  delta: BigNumberish
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

export const changePosition = ({
  position,
  makerDelta,
  longDelta,
  shortDelta,
  timestampDelta,
}: {
  position: PositionStruct
  makerDelta?: BigNumberish
  longDelta?: BigNumberish
  shortDelta?: BigNumberish
  timestampDelta?: BigNumberish
}): PositionStruct => {
  position.maker = makerDelta ? BigNumber.from(position.maker).add(makerDelta) : position.maker
  position.long = longDelta ? BigNumber.from(position.long).add(longDelta) : position.long
  position.short = shortDelta ? BigNumber.from(position.short).add(shortDelta) : position.short
  position.timestamp = timestampDelta ? BigNumber.from(position.timestamp).add(timestampDelta) : position.timestamp

  return position
}

module.exports = {
  setMarketPosition,
  setGlobalPrice,
  openTriggerOrder,
  changePosition,
  Compare,
  Dir,
}
