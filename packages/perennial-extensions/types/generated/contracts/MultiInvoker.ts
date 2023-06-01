/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type {
  BaseContract,
  BigNumber,
  BigNumberish,
  BytesLike,
  CallOverrides,
  ContractTransaction,
  Overrides,
  PopulatedTransaction,
  Signer,
  utils,
} from "ethers";
import type { FunctionFragment, Result } from "@ethersproject/abi";
import type { Listener, Provider } from "@ethersproject/providers";
import type {
  TypedEventFilter,
  TypedEvent,
  TypedListener,
  OnEvent,
  PromiseOrValue,
} from "../common";

export declare namespace IMultiInvoker {
  export type InvocationStruct = {
    action: PromiseOrValue<BigNumberish>;
    args: PromiseOrValue<BytesLike>;
  };

  export type InvocationStructOutput = [number, string] & {
    action: number;
    args: string;
  };
}

export interface MultiInvokerInterface extends utils.Interface {
  functions: {
    "invoke((uint8,bytes)[])": FunctionFragment;
  };

  getFunction(nameOrSignatureOrTopic: "invoke"): FunctionFragment;

  encodeFunctionData(
    functionFragment: "invoke",
    values: [IMultiInvoker.InvocationStruct[]]
  ): string;

  decodeFunctionResult(functionFragment: "invoke", data: BytesLike): Result;

  events: {};
}

export interface MultiInvoker extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: MultiInvokerInterface;

  queryFilter<TEvent extends TypedEvent>(
    event: TypedEventFilter<TEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TEvent>>;

  listeners<TEvent extends TypedEvent>(
    eventFilter?: TypedEventFilter<TEvent>
  ): Array<TypedListener<TEvent>>;
  listeners(eventName?: string): Array<Listener>;
  removeAllListeners<TEvent extends TypedEvent>(
    eventFilter: TypedEventFilter<TEvent>
  ): this;
  removeAllListeners(eventName?: string): this;
  off: OnEvent<this>;
  on: OnEvent<this>;
  once: OnEvent<this>;
  removeListener: OnEvent<this>;

  functions: {
    invoke(
      invocations: IMultiInvoker.InvocationStruct[],
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;
  };

  invoke(
    invocations: IMultiInvoker.InvocationStruct[],
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  callStatic: {
    invoke(
      invocations: IMultiInvoker.InvocationStruct[],
      overrides?: CallOverrides
    ): Promise<void>;
  };

  filters: {};

  estimateGas: {
    invoke(
      invocations: IMultiInvoker.InvocationStruct[],
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;
  };

  populateTransaction: {
    invoke(
      invocations: IMultiInvoker.InvocationStruct[],
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;
  };
}
