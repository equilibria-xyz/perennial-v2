import { BigNumber, BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../types/generated'
import { TriggerOrderStruct } from '../../types/generated/contracts/MultiInvoker'

export const MAX_INT = BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935')

export type OrderStruct = {
  side?: number
  comparisson?: number
  fee: BigNumberish
  price?: BigNumberish
  delta?: BigNumberish
}

export type TriggerType = 'LM' | 'TP' | 'SL'

export type Actions = IMultiInvoker.InvocationStruct[]

export const buildUpdateMarket = ({
  market,
  maker,
  long,
  short,
  collateral,
  handleWrap,
}: {
  market: string
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'int256', 'bool'],
        [
          market,
          maker ? maker : '0',
          long ? long : '0',
          short ? short : '0',
          collateral ? collateral : '0',
          handleWrap ? handleWrap : false,
        ],
      ),
    },
  ]
}

export const buildPlaceOrder = ({
  market,
  long,
  short,
  triggerType,
  collateral,
  handleWrap,
  order,
  comparisonOverride,
  sideOverride,
}: {
  market: string
  long?: BigNumberish
  short?: BigNumberish
  triggerType?: TriggerType
  collateral: BigNumberish
  handleWrap?: boolean
  order: TriggerOrderStruct
  comparisonOverride?: number
  sideOverride?: number
}): Actions => {
  if (!triggerType) triggerType = 'LM'

  order.delta = BigNumber.from(order.delta)
  order.fee = BigNumber.from(order.fee)

  if (long && short) {
    if (BigNumber.from(long).gt(short)) {
      order.side = 1
      order.delta = BigNumber.from(long).sub(short)
    } else {
      order.side = 2
      order.delta = BigNumber.from(short).sub(long)
    }
  } else if (long) {
    order.side = 1
    order.delta = long
  } else if (short) {
    order.side = 2
    order.delta = short
  } else {
    long = order.side === 1 ? order.delta.abs() : '0'
    short = order.side === 2 ? order.delta.abs() : '0'
  }

  order.fee = BigNumber.from(collateral).div(BigNumber.from(order.delta).abs()).mul(order.fee)
  order = triggerDirection(order, triggerType, comparisonOverride)
  order.side = sideOverride || sideOverride === 0 ? sideOverride : order.side

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
      action: 3,
      args: utils.defaultAbiCoder.encode(
        ['address', 'tuple(uint8,int8,uint256,int256,int256)'],
        [
          market,
          [
            order.side, // default long side
            order.comparison,
            order.fee ? order.fee : '0',
            order.price ? order.price : '0',
            order.delta ? order.delta : '0',
          ],
        ],
      ),
    },
  ]
}

function triggerDirection(order: TriggerOrderStruct, triggerType: TriggerType, comparisonOverride?: number) {
  order.delta = BigNumber.from(order.delta)

  order.delta = delta(order.delta, triggerType)

  if (comparisonOverride && comparisonOverride !== 0) {
    order.comparison = comparisonOverride
  } else if (
    (order.side === 1 && (triggerType === 'LM' || triggerType === 'SL')) ||
    (order.side === 2 && triggerType === 'TP')
  ) {
    order.comparison = -1
  } else {
    order.comparison = 1
  }

  return order
}

function delta(num: BigNumber, trigger: TriggerType) {
  if (trigger === 'LM') {
    if (num.isNegative()) return num.mul(-1)
    return num
  }
  if (num.isNegative()) return num
  return num.mul(-1)
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

export const buildLiquidateUser = ({ user, market }: { market: string; user: string }): Actions => {
  return [
    {
      action: 7,
      args: utils.defaultAbiCoder.encode(['address', 'address'], [market, user]),
    },
  ]
}

export const buildApproveTarget = (target: string): Actions => {
  return [
    {
      action: 8,
      args: utils.defaultAbiCoder.encode(['address'], [target]),
    },
  ]
}

export const buildCancelOrder = ({ market, orderId }: { market: string; orderId: BigNumberish }): Actions => {
  return [
    {
      action: 4,
      args: utils.defaultAbiCoder.encode(['address', 'uint256'], [market, orderId]),
    },
  ]
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
      action: 5,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [user, market, orderId]),
    },
  ]
}

module.exports = {
  MAX_INT,
  buildCancelOrder,
  buildExecOrder,
  buildPlaceOrder,
  buildUpdateMarket,
  buildLiquidateUser,
  buildUpdateVault,
  buildApproveTarget,
}
