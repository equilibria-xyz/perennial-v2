/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Signer, utils, Contract, ContractFactory, Overrides } from "ethers";
import type { Provider, TransactionRequest } from "@ethersproject/providers";
import type { PromiseOrValue } from "../../../../../../common";
import type {
  PackedUFixed18Lib,
  PackedUFixed18LibInterface,
} from "../../../../../../@equilibria/root/number/types/PackedUFixed18.sol/PackedUFixed18Lib";

const _abi = [
  {
    inputs: [],
    name: "MAX",
    outputs: [
      {
        internalType: "PackedUFixed18",
        name: "",
        type: "uint128",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const _bytecode =
  "0x608080604052346100195760a2908161001f823930815050f35b600080fdfe6080806040526004361015601257600080fd5b60003560e01c63d49d518114602657600080fd5b60007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112606757806fffffffffffffffffffffffffffffffff60209252f35b600080fdfea26469706673582212205a1ef91622979c74b8d02ee3b81cc0a21f6bc1b5d05358b52937516e33ffe81364736f6c63430008130033";

type PackedUFixed18LibConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: PackedUFixed18LibConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class PackedUFixed18Lib__factory extends ContractFactory {
  constructor(...args: PackedUFixed18LibConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override deploy(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<PackedUFixed18Lib> {
    return super.deploy(overrides || {}) as Promise<PackedUFixed18Lib>;
  }
  override getDeployTransaction(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(overrides || {});
  }
  override attach(address: string): PackedUFixed18Lib {
    return super.attach(address) as PackedUFixed18Lib;
  }
  override connect(signer: Signer): PackedUFixed18Lib__factory {
    return super.connect(signer) as PackedUFixed18Lib__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): PackedUFixed18LibInterface {
    return new utils.Interface(_abi) as PackedUFixed18LibInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): PackedUFixed18Lib {
    return new Contract(address, _abi, signerOrProvider) as PackedUFixed18Lib;
  }
}
