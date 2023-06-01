/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Signer, utils, Contract, ContractFactory, Overrides } from "ethers";
import type { Provider, TransactionRequest } from "@ethersproject/providers";
import type { PromiseOrValue } from "../../../../../../common";
import type {
  Token18Lib,
  Token18LibInterface,
} from "../../../../../../@equilibria/root/token/types/Token18.sol/Token18Lib";

const _abi = [
  {
    inputs: [],
    name: "ZERO",
    outputs: [
      {
        internalType: "Token18",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const _bytecode =
  "0x608080604052346018576093908161001e823930815050f35b600080fdfe6080806040526004361015601257600080fd5b60003560e01c6358fa63ca14602657600080fd5b60007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011260585780600060209252f35b600080fdfea26469706673582212209612dbea2670cfcac675ef990e9016302d53bdd8acf910ab8959587d77149d9564736f6c63430008130033";

type Token18LibConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: Token18LibConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class Token18Lib__factory extends ContractFactory {
  constructor(...args: Token18LibConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override deploy(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<Token18Lib> {
    return super.deploy(overrides || {}) as Promise<Token18Lib>;
  }
  override getDeployTransaction(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(overrides || {});
  }
  override attach(address: string): Token18Lib {
    return super.attach(address) as Token18Lib;
  }
  override connect(signer: Signer): Token18Lib__factory {
    return super.connect(signer) as Token18Lib__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): Token18LibInterface {
    return new utils.Interface(_abi) as Token18LibInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): Token18Lib {
    return new Contract(address, _abi, signerOrProvider) as Token18Lib;
  }
}
