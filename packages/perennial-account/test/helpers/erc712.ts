import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { CommonStruct } from '../../types/generated/contracts/Verifier'
import { IVerifier, Verifier } from '../../types/generated'
import { FakeContract } from '@defi-wonderland/smock'
import {
  ActionStruct,
  DeployAccountStruct,
  SignerUpdateStruct,
  WithdrawalStruct,
} from '../../types/generated/contracts/Controller'

export function erc721Domain(verifier: Verifier | FakeContract<IVerifier>) {
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
  verifier: Verifier | FakeContract<IVerifier>,
  common: CommonStruct,
): Promise<string> {
  return await signer._signTypedData(erc721Domain(verifier), commonType, common)
}

export async function signAction(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
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
  verifier: Verifier | FakeContract<IVerifier>,
  message: DeployAccountStruct,
): Promise<string> {
  const types = {
    DeployAccount: [{ name: 'action', type: 'Action' }],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signSignerUpdate(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  message: SignerUpdateStruct,
): Promise<string> {
  const types = {
    SignerUpdate: [
      { name: 'signer', type: 'address' },
      { name: 'approved', type: 'bool' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signWithdrawal(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
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
