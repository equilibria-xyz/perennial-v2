import { BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../types/generated'
import { InterfaceFeeStruct, TriggerOrderStruct } from '../../types/generated/contracts/MultiInvoker'
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
  interfaceFee,
}: {
  market: string
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
  interfaceFee?: InterfaceFeeStruct
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'int256', 'bool', 'tuple(uint256,address,bool)'],
        [
          market,
          maker ?? MAX_UINT,
          long ?? MAX_UINT,
          short ?? MAX_UINT,
          collateral ?? MIN_INT,
          handleWrap ?? false,
          [
            interfaceFee ? interfaceFee.amount : 0,
            interfaceFee ? interfaceFee.receiver : '0x0000000000000000000000000000000000000000',
            interfaceFee ? interfaceFee.unwrap : false,
          ],
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
        ['address', 'uint256', 'uint256', 'uint256', 'int256', 'bool', 'tuple(uint256,address,bool)'],
        [
          market,
          maker ?? MAX_UINT,
          long ?? MAX_UINT,
          short ?? MAX_UINT,
          collateral ?? MIN_INT,
          handleWrap ?? false,
          [0, '0x0000000000000000000000000000000000000000', false],
        ],
      ),
    },
    {
      action: 3,
      args: utils.defaultAbiCoder.encode(
        ['address', 'tuple(uint8,int8,uint256,int256,int256,tuple(uint256,address,bool))'],
        [
          market,
          [
            order.side, // default long side
            order.comparison,
            order.fee,
            order.price,
            order.delta,
            [order.interfaceFee.amount, order.interfaceFee.receiver, order.interfaceFee.unwrap],
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
          vaultUpdate.depositAssets ?? '0',
          vaultUpdate.redeemShares ?? '0',
          vaultUpdate.claimAssets ?? '0',
          vaultUpdate.wrap ?? false,
        ],
      ),
    },
  ]
}

export const buildLiquidateUser = ({
  user,
  market,
  revertOnFailure,
}: {
  market: string
  user: string
  revertOnFailure?: boolean
}): Actions => {
  return [
    {
      action: 7,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'bool'], [market, user, revertOnFailure ?? true]),
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
  revertOnFailure,
}: {
  user: string
  market: string
  orderId: BigNumberish
  revertOnFailure?: boolean
}): Actions => {
  return [
    {
      action: 5,
      args: utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'bool'],
        [user, market, orderId, revertOnFailure ?? true],
      ),
    },
  ]
}

module.exports = {
  MAX_INT,
  MAX_UINT,
  buildCancelOrder,
  buildExecOrder,
  buildPlaceOrder,
  buildUpdateMarket,
  buildLiquidateUser,
  buildUpdateVault,
  buildApproveTarget,
}
