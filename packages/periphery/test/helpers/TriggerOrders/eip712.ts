import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ActionStruct,
  CommonStruct,
  //CancelOrderActionStruct,
  //PlaceOrderActionStruct,
} from '../../../types/generated/contracts/CollateralAccounts/AccountVerifier'
import { FakeContract } from '@defi-wonderland/smock'
import { IOrderVerifier } from '../../../types/generated'
import { CancelOrderActionStruct } from '../../../types/generated/contracts/TriggerOrders/Manager'

function eip712Domain(verifier: IOrderVerifier | FakeContract<IOrderVerifier>): {
  name: string
  version: string
  chainId: number
  verifyingContract: string
} {
  return {
    name: 'Perennial V2 Trigger Orders',
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
    { name: 'market', type: 'address' },
    { name: 'orderId', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'common', type: 'Common' },
  ],
}

const interfaceFeeType = {
  InterfaceFee: [
    { name: 'amount', type: 'uint64' },
    { name: 'receiver', type: 'address' },
    { name: 'fixedFee', type: 'bool' },
    { name: 'unwrap', type: 'bool' },
  ],
}

const triggerOrderType = {
  TriggerOrder: [
    { name: 'side', type: 'uint8' },
    { name: 'comparison', type: 'int8' },
    { name: 'price', type: 'int64' },
    { name: 'delta', type: 'int64' },
    { name: 'maxFee', type: 'uint64' },
    { name: 'isSpent', type: 'bool' },
    { name: 'referrer', type: 'address' },
    { name: 'interfaceFee', type: 'InterfaceFee' },
  ],
}

export async function signCommon(
  signer: SignerWithAddress,
  verifier: IOrderVerifier | FakeContract<IOrderVerifier>,
  common: CommonStruct,
): Promise<string> {
  return await signer._signTypedData(eip712Domain(verifier), commonType, common)
}

export async function signAction(
  signer: SignerWithAddress,
  verifier: IOrderVerifier | FakeContract<IOrderVerifier>,
  action: ActionStruct,
): Promise<string> {
  const types = {
    ...actionType,
    ...commonType,
  }
  return await signer._signTypedData(eip712Domain(verifier), types, action)
}

export async function signPlaceOrderAction(
  signer: SignerWithAddress,
  verifier: IOrderVerifier | FakeContract<IOrderVerifier>,
  action: PlaceOrderActionStruct,
): Promise<string> {
  const types = {
    PlaceOrderAction: [
      { name: 'order', type: 'TriggerOrder' },
      { name: 'action', type: 'Action' },
    ],
    ...actionType,
    ...commonType,
    ...interfaceFeeType,
    ...triggerOrderType,
  }
  return await signer._signTypedData(eip712Domain(verifier), types, action)
}

export async function signCancelOrderAction(
  signer: SignerWithAddress,
  verifier: IOrderVerifier | FakeContract<IOrderVerifier>,
  action: CancelOrderActionStruct,
): Promise<string> {
  const types = {
    CancelOrderAction: [{ name: 'action', type: 'Action' }],
    ...actionType,
    ...commonType,
  }
  return await signer._signTypedData(eip712Domain(verifier), types, action)
}
