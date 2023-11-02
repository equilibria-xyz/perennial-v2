import { BigNumber, BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../types/generated'
import { InterfaceFeeStruct, TriggerOrderStruct } from '../../types/generated/contracts/MultiInvoker'
import { ethers } from 'hardhat'
import { MAX_INT, MAX_UINT, MIN_INT } from './invoke'

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

export const encodeUint = (uint: BigNumber): string => {
  if (uint.eq(0)) return '0100'
  return toHex((uint._hex.length - 2) / 2) + toHex(uint._hex)
}

export const encodeInt = (int: BigNumberish): string => {
  const _int = BigNumber.from(int)
  if (_int.eq(0)) return '00'
  if (_int.lt(0)) return '01' + toHex((_int._hex.length - 2) / 2) + toHex(_int._hex)
  return '00' + toHex((_int._hex.length - 2) / 2) + toHex(_int._hex)
}

export const encodeAddressOrCacheIndex = (
  cacheIndex: BigNumber, // must not be null, default to BN(0) and pass address if user's first interaction with protocol
  address?: string,
): string => {
  // include address if first interaction with the protocol,
  // contract reads the next 20 bytes into an address when given an address length of 0
  if (address) return '00' + address.slice(2)

  //
  return encodeUint(cacheIndex)
}

function toHex(input: BigNumberish): string {
  return BigNumber.from(input)._hex.slice(2)
}

module.exports = {
  buildCancelOrder,
  buildExecOrder,
  buildPlaceOrder,
  buildUpdateMarket,
  buildLiquidateUser,
  buildUpdateVault,
  buildApproveTarget,
}
