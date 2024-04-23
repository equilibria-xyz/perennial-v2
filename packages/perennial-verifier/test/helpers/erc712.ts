import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  CommonStruct,
  FillStruct,
  GroupCancellationStruct,
  IntentStruct,
} from '../../types/generated/contracts/Verifier'
import { Verifier } from '../../types/generated'

export function erc721Domain(verifier: Verifier) {
  return {
    name: 'Perennial',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

export async function signCommon(signer: SignerWithAddress, verifier: Verifier, common: CommonStruct): Promise<string> {
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

export async function signIntent(signer: SignerWithAddress, verifier: Verifier, intent: IntentStruct): Promise<string> {
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
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, intent)
}

export async function signFill(signer: SignerWithAddress, verifier: Verifier, fill: FillStruct): Promise<string> {
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
  verifier: Verifier,
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
