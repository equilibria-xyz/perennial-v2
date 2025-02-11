import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  AccessUpdateBatchStruct,
  CommonStruct,
  FillStruct,
  GroupCancellationStruct,
  IntentStruct,
  TakeStruct,
  OperatorUpdateStruct,
  SignerUpdateStruct,
} from '../../types/generated/contracts/Verifier'
import { IVerifier, Verifier } from '../../types/generated'
import { FakeContract } from '@defi-wonderland/smock'

export function erc721Domain(verifier: IVerifier | Verifier | FakeContract<IVerifier>) {
  return {
    name: 'Perennial',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

const COMMON_TYPE = {
  Common: [
    { name: 'account', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'domain', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'group', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
}

const INTENT_TYPE = {
  Intent: [
    { name: 'amount', type: 'int256' },
    { name: 'price', type: 'int256' },
    { name: 'fee', type: 'uint256' },
    { name: 'originator', type: 'address' },
    { name: 'solver', type: 'address' },
    { name: 'collateralization', type: 'uint256' },
    { name: 'common', type: 'Common' },
  ],
}

export async function signCommon(
  signer: SignerWithAddress,
  verifier: IVerifier | Verifier | FakeContract<IVerifier>,
  common: CommonStruct,
): Promise<string> {
  const types = {
    ...COMMON_TYPE,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, common)
}

export async function signFill(
  signer: SignerWithAddress,
  verifier: IVerifier | Verifier | FakeContract<IVerifier>,
  fill: FillStruct,
): Promise<string> {
  const types = {
    ...COMMON_TYPE,
    Fill: [
      { name: 'intent', type: 'Intent' },
      { name: 'common', type: 'Common' },
    ],
    ...INTENT_TYPE,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, fill)
}

export async function signIntent(
  signer: SignerWithAddress,
  verifier: IVerifier | Verifier | FakeContract<IVerifier>,
  intent: IntentStruct,
): Promise<string> {
  const types = {
    ...COMMON_TYPE,
    ...INTENT_TYPE,
  }

  return await signer._signTypedData(erc721Domain(verifier), types, intent)
}

export async function signTake(
  signer: SignerWithAddress,
  verifier: IVerifier | Verifier | FakeContract<IVerifier>,
  marketUpdate: TakeStruct,
): Promise<string> {
  const types = {
    ...COMMON_TYPE,
    Take: [
      { name: 'amount', type: 'int256' },
      { name: 'referrer', type: 'address' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, marketUpdate)
}

export async function signGroupCancellation(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  groupCancellation: GroupCancellationStruct,
): Promise<string> {
  const types = {
    ...COMMON_TYPE,
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
    ...COMMON_TYPE,
    AccessUpdate: [
      { name: 'accessor', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    OperatorUpdate: [
      { name: 'access', type: 'AccessUpdate' },
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
    ...COMMON_TYPE,
    AccessUpdate: [
      { name: 'accessor', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    SignerUpdate: [
      { name: 'access', type: 'AccessUpdate' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, signerUpdate)
}

export async function signAccessUpdateBatch(
  signer: SignerWithAddress,
  verifier: Verifier | FakeContract<IVerifier>,
  accessUpdateBatch: AccessUpdateBatchStruct,
): Promise<string> {
  const types = {
    ...COMMON_TYPE,
    AccessUpdate: [
      { name: 'accessor', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    AccessUpdateBatch: [
      { name: 'operators', type: 'AccessUpdate[]' },
      { name: 'signers', type: 'AccessUpdate[]' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, accessUpdateBatch)
}
