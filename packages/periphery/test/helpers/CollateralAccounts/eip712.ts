import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ActionStruct, CommonStruct } from '../../../types/generated/contracts/CollateralAccounts/Controller'
import { IAccountVerifier } from '../../../types/generated'
import { FakeContract } from '@defi-wonderland/smock'
import {
  DeployAccountStruct,
  MarketTransferStruct,
  RebalanceConfigChangeStruct,
  WithdrawalStruct,
} from '../../../types/generated/contracts/CollateralAccounts/Controller'
import {
  RelayedAccessUpdateBatchStruct,
  RelayedNonceCancellationStruct,
  RelayedGroupCancellationStruct,
  RelayedOperatorUpdateStruct,
  RelayedSignerUpdateStruct,
  RelayedTakeStruct,
} from '../../../types/generated/contracts/CollateralAccounts/Controller_Incentivized'

function erc721Domain(verifier: IAccountVerifier | FakeContract<IAccountVerifier>): {
  name: string
  version: string
  chainId: number
  verifyingContract: string
} {
  return {
    name: 'Perennial V2 Collateral Accounts',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

const commonType = {
  Common: [
    { name: 'account', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'domain', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'group', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
}

const actionType = {
  Action: [
    { name: 'maxFee', type: 'uint256' },
    { name: 'common', type: 'Common' },
  ],
}

export async function signCommon(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  common: CommonStruct,
): Promise<string> {
  return await signer._signTypedData(erc721Domain(verifier), commonType, common)
}

export async function signAction(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  action: ActionStruct,
): Promise<string> {
  const types = {
    ...actionType,
    ...commonType,
  }
  return await signer._signTypedData(erc721Domain(verifier), types, action)
}

export async function signDeployAccount(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: DeployAccountStruct,
): Promise<string> {
  const types = {
    DeployAccount: [{ name: 'action', type: 'Action' }],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signMarketTransfer(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: MarketTransferStruct,
): Promise<string> {
  const types = {
    MarketTransfer: [
      { name: 'market', type: 'address' },
      { name: 'amount', type: 'int256' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRebalanceConfigChange(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RebalanceConfigChangeStruct,
): Promise<string> {
  const types = {
    RebalanceConfigChange: [
      { name: 'group', type: 'uint256' },
      { name: 'markets', type: 'address[]' },
      { name: 'configs', type: 'RebalanceConfig[]' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
    RebalanceConfig: [
      { name: 'target', type: 'uint256' },
      { name: 'threshold', type: 'uint256' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signWithdrawal(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: WithdrawalStruct,
): Promise<string> {
  const types = {
    Withdrawal: [
      { name: 'amount', type: 'uint256' },
      { name: 'unwrap', type: 'bool' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRelayedTake(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RelayedTakeStruct,
): Promise<string> {
  const types = {
    RelayedTake: [
      { name: 'take', type: 'Take' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
    Take: [
      { name: 'amount', type: 'int256' },
      { name: 'referrer', type: 'address' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRelayedNonceCancellation(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RelayedNonceCancellationStruct,
): Promise<string> {
  const types = {
    RelayedNonceCancellation: [
      { name: 'nonceCancellation', type: 'Common' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRelayedGroupCancellation(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RelayedGroupCancellationStruct,
): Promise<string> {
  const types = {
    RelayedGroupCancellation: [
      { name: 'groupCancellation', type: 'GroupCancellation' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
    GroupCancellation: [
      { name: 'group', type: 'uint256' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRelayedOperatorUpdate(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RelayedOperatorUpdateStruct,
): Promise<string> {
  const types = {
    RelayedOperatorUpdate: [
      { name: 'operatorUpdate', type: 'OperatorUpdate' },
      { name: 'action', type: 'Action' },
    ],
    AccessUpdate: [
      { name: 'accessor', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    ...actionType,
    ...commonType,
    OperatorUpdate: [
      { name: 'access', type: 'AccessUpdate' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRelayedSignerUpdate(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RelayedSignerUpdateStruct,
): Promise<string> {
  const types = {
    RelayedSignerUpdate: [
      { name: 'signerUpdate', type: 'SignerUpdate' },
      { name: 'action', type: 'Action' },
    ],
    AccessUpdate: [
      { name: 'accessor', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    ...actionType,
    ...commonType,
    SignerUpdate: [
      { name: 'access', type: 'AccessUpdate' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signRelayedAccessUpdateBatch(
  signer: SignerWithAddress,
  verifier: IAccountVerifier | FakeContract<IAccountVerifier>,
  message: RelayedAccessUpdateBatchStruct,
): Promise<string> {
  const types = {
    RelayedAccessUpdateBatch: [
      { name: 'accessUpdateBatch', type: 'AccessUpdateBatch' },
      { name: 'action', type: 'Action' },
    ],
    AccessUpdate: [
      { name: 'accessor', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    AccessUpdateBatch: [
      { name: 'operators', type: 'AccessUpdate[]' },
      { name: 'signers', type: 'AccessUpdate[]' },
      { name: 'common', type: 'Common' },
    ],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}
