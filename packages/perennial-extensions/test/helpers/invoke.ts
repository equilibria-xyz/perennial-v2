import { BigNumber, BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../types/generated'
import { TriggerOrderStruct } from '../../types/generated/contracts/MultiInvoker'
import { ethers } from 'hardhat'

export const MAX_INT = ethers.constants.MaxInt256
export const MIN_INT = ethers.constants.MinInt256
export const MAX_UINT = ethers.constants.MaxUint256

export type OrderStruct = {
  side?: number
  comparisson?: number
  fee: BigNumberish
  price?: BigNumberish
  delta?: BigNumberish
}

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
  maker,
  long,
  short,
  collateral,
  handleWrap,
  order,
}: {
  market: string
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral: BigNumberish
  handleWrap?: boolean
  order: TriggerOrderStruct
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'int256', 'bool'],
        [market, maker ?? MAX_UINT, long ?? MAX_UINT, short ?? MAX_UINT, collateral ?? '0', handleWrap ?? false],
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
            order.fee,
            order.price,
            order.delta,
          ],
        ],
      ),
    },
  ]
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
