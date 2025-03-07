import { BigNumberish, utils } from 'ethers'
import { IMultiInvoker } from '../../../types/generated'
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

export type Actions = IMultiInvoker.InvocationStruct[]

export const buildUpdateMarket = ({
  market,
  makerDelta = BigNumber.from(0),
  longDelta = BigNumber.from(0),
  shortDelta = BigNumber.from(0),
  collateral = BigNumber.from(0),
  handleWrap = false,
  referrer = constants.AddressZero,
  additiveFee = BigNumber.from(0),
}: {
  market: string
  longDelta?: BigNumber
  makerDelta?: BigNumber
  shortDelta?: BigNumber
  collateral?: BigNumber
  handleWrap?: boolean
  referrer?: string
  additiveFee?: BigNumber
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'int256', 'int256', 'int256', 'address', 'uint256', 'bool'],
        [market, makerDelta, longDelta.sub(shortDelta), collateral, referrer, additiveFee, handleWrap],
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
          'tuple(int256,int256,uint256,uint256,address,address,uint256,tuple(address,address,address,uint256,uint256,uint256))',
          'bytes',
        ],
        [
          market,
          [
            intent.amount,
            intent.price,
            intent.fee,
            intent.additiveFee,
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

export const buildClaimFee = ({ market, unwrap }: { market: string; unwrap: boolean }): Actions => {
  return [
    {
      action: 10,
      args: utils.defaultAbiCoder.encode(['address', 'bool'], [market, unwrap]),
    },
  ]
}

module.exports = {
  MAX_UINT,
  buildUpdateMarket,
  buildUpdateIntent,
  buildLiquidateUser,
  buildUpdateVault,
  buildApproveTarget,
  buildClaimFee,
}
