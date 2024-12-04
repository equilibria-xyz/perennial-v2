import { BigNumber, BigNumberish, constants } from 'ethers'
import { IMarket, PositionStruct } from '../../../types/generated/@perennial/v2-core/contracts/interfaces/IMarket'
import { FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { LocalStruct } from '@perennial/v2-core/types/generated/contracts/Market'

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
  ABOVE_MARKET = -1, // order is executable when the oracle price is >= order price
  BELOW_MARKET = 1, // order is executable when the oracle price is <= order price
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
  changePosition,
  Compare,
  Dir,
}
