/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Signer, utils, Contract, ContractFactory, Overrides } from "ethers";
import type { Provider, TransactionRequest } from "@ethersproject/providers";
import type { PromiseOrValue } from "../../../../../../common";
import type {
  VersionStorageLib,
  VersionStorageLibInterface,
} from "../../../../../../@equilibria/perennial-v2/contracts/types/Version.sol/VersionStorageLib";

const _abi = [
  {
    inputs: [],
    name: "VersionStorageInvalidError",
    type: "error",
  },
];

const _bytecode =
  "0x60808060405234601757603a9081601d823930815050f35b600080fdfe600080fdfea26469706673582212204963a411ff2fc335a2b48e8e492586923b1261195143ce7ad7f1c7c248d81bfd64736f6c63430008130033";

type VersionStorageLibConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: VersionStorageLibConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class VersionStorageLib__factory extends ContractFactory {
  constructor(...args: VersionStorageLibConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override deploy(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<VersionStorageLib> {
    return super.deploy(overrides || {}) as Promise<VersionStorageLib>;
  }
  override getDeployTransaction(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(overrides || {});
  }
  override attach(address: string): VersionStorageLib {
    return super.attach(address) as VersionStorageLib;
  }
  override connect(signer: Signer): VersionStorageLib__factory {
    return super.connect(signer) as VersionStorageLib__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): VersionStorageLibInterface {
    return new utils.Interface(_abi) as VersionStorageLibInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): VersionStorageLib {
    return new Contract(address, _abi, signerOrProvider) as VersionStorageLib;
  }
}
