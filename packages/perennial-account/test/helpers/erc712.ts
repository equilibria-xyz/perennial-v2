import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { CommonStruct, GroupCancellationStruct } from '../../types/generated/contracts/Verifier'
import { IVerifier, Verifier } from '../../types/generated'
import { FakeContract } from '@defi-wonderland/smock'
import { ActionStruct, DeployAccountStruct } from '../../types/generated/contracts/Controller'

export function erc721Domain(verifier: Verifier | FakeContract<IVerifier>) {
  return {
    name: 'Perennial V2 Collateral Accounts',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

// TODO: rework this to share types constants

export async function signCommon(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  common: CommonStruct,
): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, common)
}

export async function signAction(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  action: ActionStruct,
): Promise<string> {
  const types = {
    Action: [
      { name: 'relayer', type: 'address' },
      { name: 'fee', type: 'uint256' },
      { name: 'common', type: 'Common' },
    ],
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, action)
}

export async function signDeployAccount(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  message: DeployAccountStruct,
): Promise<string> {
  const types = {
    DeployAccount: [
      { name: 'user', type: 'address' },
      { name: 'action', type: 'Action' },
    ],
    Action: [
      { name: 'relayer', type: 'address' },
      { name: 'fee', type: 'uint256' },
      { name: 'common', type: 'Common' },
    ],
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, message)
}

export async function signGroupCancellation(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  groupCancellation: GroupCancellationStruct,
): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    GroupCancellation: [
      { name: 'group', type: 'uint256' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, groupCancellation)
}
