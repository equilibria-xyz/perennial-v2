import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  CommonStruct,
  FillStruct,
  GroupCancellationStruct,
  IntentStruct,
  OperatorUpdateStruct,
  SignerUpdateStruct,
} from '../../types/generated/contracts/Verifier'
import { IVerifier, Verifier } from '../../types/generated'
import { FakeContract } from '@defi-wonderland/smock'

export function erc721Domain(verifier: Verifier | FakeContract<IVerifier>) {
  return {
    name: 'Perennial',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

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

export async function signIntent(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  intent: IntentStruct,
): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    Intent: [
      { name: 'amount', type: 'int256' },
      { name: 'price', type: 'int256' },
      { name: 'fee', type: 'uint256' },
      { name: 'originator', type: 'address' },
      { name: 'solver', type: 'address' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, intent)
}

export async function signFill(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  fill: FillStruct,
): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    Intent: [
      { name: 'amount', type: 'int256' },
      { name: 'price', type: 'int256' },
      { name: 'fee', type: 'uint256' },
      { name: 'originator', type: 'address' },
      { name: 'solver', type: 'address' },
      { name: 'common', type: 'Common' },
    ],
    Fill: [
      { name: 'intent', type: 'Intent' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, fill)
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

export async function signOperatorUpdate(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  operatorUpdate: OperatorUpdateStruct,
): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    OperatorUpdate: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, operatorUpdate)
}

export async function signSignerUpdate(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  signerUpdate: SignerUpdateStruct,
): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    SignerUpdate: [
      { name: 'signer', type: 'address' },
      { name: 'approved', type: 'bool' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, signerUpdate)
}