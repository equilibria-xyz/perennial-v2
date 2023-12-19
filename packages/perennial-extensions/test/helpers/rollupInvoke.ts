import { BigNumber, BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../types/generated'
import { ethers } from 'hardhat'
import { MAX_INT, MAX_UINT } from './invoke'
import { InterfaceFeeStruct, TriggerOrderStruct } from './types'

export type Actions = IMultiInvoker.InvocationStruct[]

const MAGIC_BYTE = '0x49'
const MIN_INT = ethers.constants.MinInt256

export const buildUpdateMarket = ({
  market,
  marketIndex,
  maker,
  long,
  short,
  collateral,
  handleWrap,
  interfaceFee,
  interfaceFeeReceiverIndex,
}: {
  market: string
  marketIndex?: BigNumberish
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
  interfaceFee?: InterfaceFeeStruct
  interfaceFeeReceiverIndex?: BigNumberish
}): string => {
  if (!interfaceFee) interfaceFee = { amount: 0, receiver: '0x0000000000000000000000000000000000000000', unwrap: false }

  return (
    MAGIC_BYTE +
    '01' +
    encodeAddressOrCacheIndex(marketIndex ?? 0, market) +
    encodeUFixed(maker ?? MAX_UINT) +
    encodeUFixed(long ?? MAX_UINT) +
    encodeUFixed(short ?? MAX_UINT) +
    encodeFixed(collateral ?? MAX_INT) +
    encodeBool(handleWrap ?? false) +
    encodeUFixed(interfaceFee.amount ?? 0) + // TODO remove promise
    encodeAddressOrCacheIndex(interfaceFeeReceiverIndex ?? 0, interfaceFee.receiver) +
    encodeBool(interfaceFee.unwrap ?? false)
  )
}

export const buildPlaceOrder = ({
  market,
  marketIndex,
  maker,
  long,
  short,
  collateral,
  handleWrap,
  order,
  interfaceFeeReceiverIndex,
}: {
  market: string
  marketIndex?: BigNumberish
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral: BigNumberish
  handleWrap?: boolean
  order: TriggerOrderStruct
  interfaceFeeReceiverIndex?: BigNumberish
}): string => {
  return (
    MAGIC_BYTE +
    '01' +
    encodeAddressOrCacheIndex(marketIndex ?? 0, market) +
    encodeUFixed(maker ?? MAX_UINT) +
    encodeUFixed(long ?? MAX_UINT) +
    encodeUFixed(short ?? MAX_UINT) +
    encodeFixed(collateral ?? MAX_INT) +
    encodeBool(handleWrap ?? false) +
    encodeUFixed(0) + // rest of interface fee skipped when 0
    '03' +
    encodeAddressOrCacheIndex(marketIndex ?? 0, market) +
    encodeUint8(order.side) +
    encodeInt8(order.comparison) +
    encodeUint(order.fee) +
    encodeInt(order.price) +
    encodeFixed(order.delta) +
    encodeUint(order.interfaceFee.amount) +
    // skip encoding interface fee if amount == 0
    (BigNumber.from(order.interfaceFee.amount).isZero()
      ? ''
      : encodeAddressOrCacheIndex(interfaceFeeReceiverIndex ?? 0, order.interfaceFee.receiver) +
        encodeBool(order.interfaceFee.unwrap))
  )
}

export type VaultUpdate = {
  vault: string
  depositAssets?: BigNumberish
  redeemShares?: BigNumberish
  claimAssets?: BigNumberish
  wrap?: boolean
}

export const buildUpdateVault = (vaultUpdate: VaultUpdate, vaultIndex?: BigNumberish): string => {
  return (
    MAGIC_BYTE +
    '02' +
    encodeAddressOrCacheIndex(vaultIndex ?? 0, vaultUpdate.vault) +
    encodeUFixed(vaultUpdate.depositAssets ?? MAX_UINT) +
    encodeUFixed(vaultUpdate.redeemShares ?? MAX_UINT) +
    encodeUFixed(vaultUpdate.claimAssets ?? MAX_UINT) +
    encodeBool(vaultUpdate.wrap ?? false)
  )
}

export const buildLiquidateUser = ({
  market,
  marketIndex,
  user,
  userIndex,
  revertOnFailure,
}: {
  market?: string
  marketIndex?: BigNumberish
  user?: string
  userIndex?: BigNumberish
  revertOnFailure?: boolean
}): string => {
  return (
    MAGIC_BYTE +
    '07' +
    encodeAddressOrCacheIndex(marketIndex ?? 0, market) +
    encodeAddressOrCacheIndex(userIndex ?? 0, user) +
    encodeBool(revertOnFailure ?? false)
  )
}

export const buildApproveTarget = ({
  target,
  targetIndex,
}: {
  target?: string
  targetIndex?: BigNumberish
}): string => {
  return MAGIC_BYTE + '08' + encodeAddressOrCacheIndex(targetIndex ?? 0, target)
}

export const buildCancelOrder = ({
  market,
  marketIndex,
  orderId,
}: {
  market: string
  marketIndex?: BigNumberish
  orderId: BigNumberish
}): string => {
  return MAGIC_BYTE + '04' + encodeAddressOrCacheIndex(marketIndex ?? 0, market) + encodeUint(orderId)
}

export const buildExecOrder = ({
  user,
  userIndex,
  market,
  marketIndex,
  orderId,
  revertOnFailure,
}: {
  user: string
  userIndex?: BigNumberish
  market: string
  marketIndex?: BigNumberish
  orderId: BigNumberish
  revertOnFailure?: boolean
}): string => {
  return (
    MAGIC_BYTE +
    '05' +
    encodeAddressOrCacheIndex(userIndex ?? 0, user) +
    encodeAddressOrCacheIndex(marketIndex ?? 0, market) +
    encodeUint(orderId) +
    encodeBool(revertOnFailure ?? false)
  )
}

// magic value support for ufixed numbers
export const encodeUFixed = (ufixed: BigNumberish): string => {
  const _ufixed = BigNumber.from(ufixed)
  if (_ufixed.eq(MAX_UINT)) return '2100'
  return encodeUint(_ufixed)
}

// magic value support for Fixed numbers
export const encodeFixed = (fixed: BigNumberish): string => {
  const _fixed = BigNumber.from(fixed)
  if (_fixed.eq(MIN_INT)) return '200100'
  if (_fixed.eq(MAX_INT)) return '200000'
  return encodeInt(fixed)
}
export const encodeUint = (uint: BigNumberish): string => {
  const _uint = BigNumber.from(uint)
  if (_uint.eq(0)) return '0100'
  return toHex((_uint._hex.length - 2) / 2) + toHex(_uint._hex)
}

export const encodeInt = (int: BigNumberish): string => {
  const _int = BigNumber.from(int)

  if (_int.eq(0)) return '00'
  if (_int.lt(0)) return '01' + toHex((_int.mul(-1)._hex.length - 2) / 2) + toHex(_int.mul(-1)._hex)
  return '00' + toHex((_int._hex.length - 2) / 2) + toHex(_int._hex)
}

export const encodeBool = (bool: boolean): string => {
  if (bool) return '01'
  return '00'
}

export const encodeUint8 = (uint8: BigNumberish): string => {
  const _uint8 = BigNumber.from(uint8)
  if (_uint8.eq(0)) return '00'
  return toHex(_uint8._hex)
}

export const encodeInt8 = (int8: BigNumberish): string => {
  const _int8 = BigNumber.from(int8)
  if (_int8.eq(0)) return '00'
  if (_int8.lt(0)) return '01' + toHex(_int8.abs()._hex)
  return '00' + toHex(_int8.abs()._hex)
}
export const encodeAddressOrCacheIndex = (
  cacheIndex: BigNumberish, // must not be null, default to BN(0) and pass address if user's first interaction with protocol
  address?: string,
): string => {
  // include address if first interaction with the protocol,
  // contract reads the next 20 bytes into an address when given an address length of 0
  if (address) return '00' + address.slice(2)

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
