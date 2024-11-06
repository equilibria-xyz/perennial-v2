import { BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../../types/generated'
import { InterfaceFeeStruct, TriggerOrderStruct } from '../../../types/generated/contracts/MultiInvoker/MultiInvoker'
import { ethers } from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { IntentStruct } from '../../../types/generated/@perennial/v2-core/contracts/Market'
import { signIntent } from '@perennial/v2-core/test/helpers/erc712'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IVerifier } from '@perennial/v2-core/types/generated'

export const MAX_INT = ethers.constants.MaxInt256
export const MIN_INT = ethers.constants.MinInt256
export const MAX_UINT = ethers.constants.MaxUint256
export const MAX_UINT48 = BigNumber.from('281474976710655')
export const MAX_UINT64 = BigNumber.from('18446744073709551615')
export const MAX_INT64 = BigNumber.from('9223372036854775807')
export const MIN_INT64 = BigNumber.from('-9223372036854775808')

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
  interfaceFee1,
  interfaceFee2,
}: {
  market: string
  maker?: BigNumberish
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
  interfaceFee1?: InterfaceFeeStruct
  interfaceFee2?: InterfaceFeeStruct
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        [
          'address',
          'uint256',
          'uint256',
          'uint256',
          'int256',
          'bool',
          'tuple(uint256,address)',
          'tuple(uint256,address)',
        ],
        [
          market,
          maker ?? MAX_UINT,
          long ?? MAX_UINT,
          short ?? MAX_UINT,
          collateral ?? MIN_INT,
          handleWrap ?? false,
          [interfaceFee1 ? interfaceFee1.amount : 0, interfaceFee1 ? interfaceFee1.receiver : constants.AddressZero],
          [interfaceFee2 ? interfaceFee2.amount : 0, interfaceFee2 ? interfaceFee2.receiver : constants.AddressZero],
        ],
      ),
    },
  ]
}

export const buildUpdateIntent = async ({
  signer,
  verifier,
  market,
  intent,
}: {
  signer: SignerWithAddress
  verifier: IVerifier
  market: string
  intent: IntentStruct
}): Promise<Actions> => {
  const signature = await signIntent(signer, verifier, intent)
  return [
    {
      action: 9,
      args: utils.defaultAbiCoder.encode(
        [
          'address',
          'tuple(int256,int256,uint256,address,address,uint256,tuple(address,address,address,uint256,uint256,uint256))',
          'bytes',
        ],
        [
          market,
          [
            intent.amount,
            intent.price,
            intent.fee,
            intent.originator,
            intent.solver,
            intent.collateralization,
            [
              intent.common.account,
              intent.common.signer,
              intent.common.domain,
              intent.common.nonce,
              intent.common.group,
              intent.common.expiry,
            ],
          ],
          signature,
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
        [
          'address',
          'uint256',
          'uint256',
          'uint256',
          'int256',
          'bool',
          'tuple(uint256,address)',
          'tuple(uint256,address)',
        ],
        [
          market,
          maker ?? MAX_UINT,
          long ?? MAX_UINT,
          short ?? MAX_UINT,
          collateral ?? MIN_INT,
          handleWrap ?? false,
          [0, constants.AddressZero],
          [0, constants.AddressZero],
        ],
      ),
    },
    {
      action: 3,
      args: utils.defaultAbiCoder.encode(
        ['address', 'tuple(uint8,int8,uint256,int256,int256,tuple(uint256,address),tuple(uint256,address))'],
        [
          market,
          [
            order.side, // default long side
            order.comparison,
            order.fee,
            order.price,
            order.delta,
            [order.interfaceFee1.amount, order.interfaceFee1.receiver],
            [order.interfaceFee2.amount, order.interfaceFee2.receiver],
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

export const buildClaimFee = ({ market, unwrap }: { market: string; unwrap: boolean }): Actions => {
  return [
    {
      action: 10,
      args: utils.defaultAbiCoder.encode(['address', 'bool'], [market, unwrap]),
    },
  ]
}

module.exports = {
  MAX_INT,
  MAX_UINT,
  MAX_UINT48,
  MAX_UINT64,
  MAX_INT64,
  MIN_INT64,
  buildCancelOrder,
  buildExecOrder,
  buildPlaceOrder,
  buildUpdateMarket,
  buildUpdateIntent,
  buildLiquidateUser,
  buildUpdateVault,
  buildApproveTarget,
  buildClaimFee,
}
