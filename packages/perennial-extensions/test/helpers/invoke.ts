import { BigNumber, BigNumberish, utils } from 'ethers'
import { IMultiInvoker, MultiInvoker } from '../../types/generated'

export const MAX_INT = BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935')

export type OrderStruct = {
  isLong?: boolean
  priceBelow?: boolean
  maxFee: BigNumberish
  execPrice?: BigNumberish
  size?: BigNumberish
}

// export type RawAction =
//     | 'UPDATE_POSITION'
//     | 'PLACE_ORDER'
//     | 'UPDATE_ORDER'
//     | 'CANCEL_ORDER'
//     | 'CLOSE_ORDER';
// export type MultiAction =
//     | 'UPDATE_POSITION'
//     | 'PLACE_ORDER'
//     | 'UPDATE_ORDER'
//     | 'CANCEL_ORDER'
//     | 'CLOSE_ORDER';

enum RollupActions {
  UPDATE_POSITION = '01',
  UPDATE_VAULT = '02',
  PLACE_ORDER = '03',
  CANCEL_ORDER = '04',
  EXEC_ORDER = '05',
}

export type TriggerType = 'LM' | 'TP' | 'SL'

export type Actions = IMultiInvoker.InvocationStruct[]

export const buildUpdateMarket = ({
  market,
  long,
  short,
  collateral,
  handleWrap,
}: {
  market: string
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'int256', 'int256', 'int256', 'int256', 'bool'],
        [
          market,
          '0',
          long ? long : '0',
          short ? short : '0',
          collateral ? collateral : '0',
          handleWrap ? handleWrap : false,
        ],
      ),
    },
  ]
}

export const buildUpdateMarketRollup = ({
  marketIndex,
  market,
  long,
  short,
  collateral,
  handleWrap,
}: {
  marketIndex?: BigNumber
  market?: string
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
}): string => {
  return (
    RollupActions.UPDATE_POSITION +
    encodeAddressOrCacheIndex(marketIndex, market) +
    encodeUint() + // orders are never on maker side
    encodeInt(long) +
    encodeInt(short) +
    encodeInt(collateral) +
    encodeBool(handleWrap)
  )
}

// @todo check if setting position conflicts with isLimit
export const buildPlaceOrder = ({
  market,
  long,
  short,
  triggerType,
  collateral,
  handleWrap,
  order,
}: {
  market: string
  long?: BigNumberish
  short?: BigNumberish
  triggerType?: TriggerType
  collateral?: BigNumberish
  handleWrap?: boolean
  order: OrderStruct
}): Actions => {
  if (!triggerType) triggerType = 'LM'

  order = triggerDirection(order, triggerType)
  order.size = BigNumber.from(order.size)

  if (long && short) {
    if (BigNumber.from(long).gt(short)) {
      order.isLong = true
      order.size = BigNumber.from(long).sub(short)
    } else {
      order.isLong = false
      order.size = BigNumber.from(short).sub(long)
    }
  } else if (long) {
    order.isLong = true
    order.size = long
  } else if (short) {
    order.isLong = false
    order.size = short
  } else {
    long = order.isLong ? order.size.abs() : '0'
    short = order.isLong ? order.size.abs() : '0'
  }

  // dont open position if limit order
  if (triggerType === 'LM') {
    long = BigNumber.from(0)
    short = BigNumber.from(0)
  }

  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'int256', 'bool'],
        [
          market,
          '0',
          long ? long : '0',
          short ? short : '0',
          collateral ? collateral : '0',
          handleWrap ? handleWrap : false,
        ],
      ),
    },
    {
      action: 2,
      args: utils.defaultAbiCoder.encode(
        ['address', 'tuple(bool,bool,uint256,int256,int256)'],
        [
          market,
          [
            order.isLong ? order.isLong : false,
            order.priceBelow,
            order.maxFee ? order.maxFee : '0',
            order.execPrice ? order.execPrice : '0',
            order.size ? order.size : '0',
          ],
        ],
      ),
    },
  ]
}

function triggerDirection(order: OrderStruct, triggerType: TriggerType) {
  order.size = BigNumber.from(order.size)

  order.size = triggerType === 'LM' ? order.size.mul(-1) : order.size

  if ((order.isLong && (triggerType === 'LM' || triggerType === 'SL')) || (!order.isLong && triggerType === 'TP')) {
    order.priceBelow = true
  } else {
    order.priceBelow = false
  }

  return order
}

export type VaultUpdate = {
  vault: string
  depositAssets?: BigNumberish
  redeemShares?: BigNumberish
  claimAssets?: BigNumberish
  wrap?: boolean
}

export const buildUpdateVault = (vaultUpdate: VaultUpdate): Actions => {
  return [
    {
      action: 2,
      args: utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'bool'],
        [
          vaultUpdate.vault,
          vaultUpdate.depositAssets ? vaultUpdate.depositAssets : '0',
          vaultUpdate.redeemShares ? vaultUpdate.redeemShares : '0',
          vaultUpdate.claimAssets ? vaultUpdate.claimAssets : '0',
          vaultUpdate.wrap ? true : false,
        ],
      ),
    },
  ]
}

export const buildPlaceOrderRollup = ({
  marketIndex,
  market,
  long,
  short,
  collateral,
  handleWrap,
  order,
}: {
  marketIndex?: BigNumber
  market?: string
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
  order: OrderStruct
}): string => {
  if (long && short) {
    if (BigNumber.from(long).gt(short)) {
      order.isLong = true
      order.size = BigNumber.from(long).sub(short)
    } else {
      order.isLong = false
      order.size = BigNumber.from(short).sub(long)
    }
  } else if (long) {
    order.isLong = true
    order.size = long
  } else if (short) {
    order.isLong = false
    order.size = short
  } else {
    long = order.isLong ? order.size : '0'
    short = !order.isLong ? order.size : '0'
  }

  // limit
  // if () {
  //   long = '0'
  //   short = '0'
  // }

  return (
    RollupActions.UPDATE_POSITION +
    encodeAddressOrCacheIndex(marketIndex, market) +
    encodeUint('0') + // orders are never on maker side
    encodeInt(long) +
    encodeInt(short) +
    encodeInt(collateral) +
    encodeBool(handleWrap) +
    RollupActions.PLACE_ORDER +
    encodeAddressOrCacheIndex(marketIndex, market) +
    encodeLongLimit(order.isLong, order.isLimit) +
    encodeInt(order.maxFee) +
    encodeInt(order.execPrice) +
    encodeUint(order.size)
  )
}

export const buildCancelOrder = ({ market, orderId }: { market: string; orderId: BigNumberish }): Actions => {
  return [
    {
      action: 3,
      args: utils.defaultAbiCoder.encode(['address', 'uint256'], [market, orderId]),
    },
  ]
}

export const buildCancelOrderRollup = ({
  marketIndex,
  market,
  orderId,
}: {
  marketIndex?: BigNumber
  market?: string
  orderId: BigNumberish
}): string => {
  return RollupActions.CANCEL_ORDER + encodeAddressOrCacheIndex(marketIndex, market) + encodeUint(orderId)
}

export const buildExecOrder = ({
  user,
  market,
  orderId,
}: {
  user: string
  market: string
  orderId: BigNumberish
}): Actions => {
  return [
    {
      action: 4,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [user, market, orderId]),
    },
  ]
}

export const buildExecOrderRollup = ({
  userIndex,
  user,
  marketIndex,
  market,
  orderId,
}: {
  userIndex?: BigNumber
  user?: string
  marketIndex?: BigNumber
  market?: string
  orderId: BigNumberish
}): string => {
  return (
    RollupActions.EXEC_ORDER +
    encodeAddressOrCacheIndex(userIndex, user) +
    encodeAddressOrCacheIndex(marketIndex, market) +
    encodeUint(orderId)
  )
}

export const encodeAddressOrCacheIndex = (
  cacheIndex?: BigNumber, // must not be null, default to BN(0) and pass address if user's first interaction with protocol
  address?: string,
) => {
  if (!cacheIndex && !address) throw Error('cache index or address needed')

  // include address if first interaction with the protocol,
  // contract reads the next 20 bytes into an address when given an address length of 0
  if (address) return '00' + address.slice(2)

  if (cacheIndex) return encodeUint(cacheIndex)
}

export const encodeUint = (uint?: BigNumberish) => {
  if (!uint) return '00'
  uint = BigNumber.from(uint)
  if (uint.eq(0)) return '00'

  if (uint.isNegative()) {
    throw Error('use encodeInt for signed encoding')
  }

  return toHex((uint._hex.length - 2) / 2) + toHex(uint._hex)
}

// The evm is two's-compliment, but we're really passing a uint + a flag if its negative
// to take less calldata space, and casting it to an int, * sign on chain
export const encodeInt = (int?: BigNumberish) => {
  if (!int) return '00'
  int = BigNumber.from(int)
  if (int.eq(0)) return '00'

  let length = 0
  // convert to uint and pack sign as 0010 0000 in length byte
  if (int.isNegative()) {
    length += 32
    int = int.mul('-0x1')
  }
  length += (int._hex.length - 2) / 2

  return toHex(length) + toHex(int._hex)
}

export const encodeBool = (bool: boolean | undefined) => {
  if (!bool) return '00'
  return '01'
}

export const encodeLongLimit = (isLong: boolean | undefined, isLimit: boolean | undefined) => {
  if (isLimit && isLong) {
    return '11'
  } else if (!isLimit && !isLong) {
    return '00'
  } else if (isLong) {
    return '10'
  }
  return '01'
}

function toHex(input: BigNumberish): string {
  return BigNumber.from(input)._hex.slice(2)
}

module.exports = {
  MAX_INT,
  buildCancelOrder,
  buildExecOrder,
  buildPlaceOrder,
  buildUpdateMarket,
  buildUpdateVault,
  buildCancelOrderRollup,
  buildExecOrderRollup,
  buildPlaceOrderRollup,
  buildUpdateMarketRollup,
}
