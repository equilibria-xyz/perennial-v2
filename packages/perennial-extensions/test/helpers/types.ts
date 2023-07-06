import { BigNumber, BigNumberish, utils, constants } from 'ethers'
import { expect } from 'chai'
import { expectPositionEq } from '../../../common/testutil/types'
import { IMarket, PositionStruct } from '../../types/generated/@equilibria/perennial-v2/contracts/interfaces/IMarket'
import { FakeContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export function setMarketPosition(market: FakeContract<IMarket>, user: SignerWithAddress, position: PositionStruct) {
  market.positions.whenCalledWith(user.address).returns(position)
}

export function setPendingPosition(
  market: FakeContract<IMarket>,
  user: SignerWithAddress,
  currentId: BigNumberish,
  position: PositionStruct,
) {
  market.pendingPositions.whenCalledWith(user.address, currentId).returns(position)
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
    id: '0',
    timestamp: timestamp ? timestamp : '0',
    maker: maker ? maker : '0',
    long: long ? long : '0',
    short: short ? short : '0',
    fee: '0',
    collateral: collateral ? collateral : '0',
    delta: '0',
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
  openPosition,
  changePosition,
}
