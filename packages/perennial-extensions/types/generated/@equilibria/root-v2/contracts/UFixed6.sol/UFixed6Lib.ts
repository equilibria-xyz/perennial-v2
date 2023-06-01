/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type {
  BaseContract,
  BigNumber,
  BytesLike,
  CallOverrides,
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
} from "../../../../common";

export interface UFixed6LibInterface extends utils.Interface {
  functions: {
    "MAX()": FunctionFragment;
    "MAX_128()": FunctionFragment;
    "MAX_16()": FunctionFragment;
    "MAX_24()": FunctionFragment;
    "MAX_32()": FunctionFragment;
    "MAX_40()": FunctionFragment;
    "MAX_48()": FunctionFragment;
    "MAX_56()": FunctionFragment;
    "MAX_64()": FunctionFragment;
    "MAX_72()": FunctionFragment;
    "MAX_8()": FunctionFragment;
    "MAX_80()": FunctionFragment;
    "MAX_88()": FunctionFragment;
    "MAX_96()": FunctionFragment;
    "ONE()": FunctionFragment;
    "ZERO()": FunctionFragment;
  };

  getFunction(
    nameOrSignatureOrTopic:
      | "MAX"
      | "MAX_128"
      | "MAX_16"
      | "MAX_24"
      | "MAX_32"
      | "MAX_40"
      | "MAX_48"
      | "MAX_56"
      | "MAX_64"
      | "MAX_72"
      | "MAX_8"
      | "MAX_80"
      | "MAX_88"
      | "MAX_96"
      | "ONE"
      | "ZERO"
  ): FunctionFragment;

  encodeFunctionData(functionFragment: "MAX", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_128", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_16", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_24", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_32", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_40", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_48", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_56", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_64", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_72", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_8", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_80", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_88", values?: undefined): string;
  encodeFunctionData(functionFragment: "MAX_96", values?: undefined): string;
  encodeFunctionData(functionFragment: "ONE", values?: undefined): string;
  encodeFunctionData(functionFragment: "ZERO", values?: undefined): string;

  decodeFunctionResult(functionFragment: "MAX", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_128", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_16", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_24", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_32", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_40", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_48", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_56", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_64", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_72", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_8", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_80", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_88", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "MAX_96", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "ONE", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "ZERO", data: BytesLike): Result;

  events: {};
}

export interface UFixed6Lib extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: UFixed6LibInterface;

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
    MAX(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_128(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_16(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_24(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_32(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_40(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_48(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_56(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_64(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_72(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_8(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_80(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_88(overrides?: CallOverrides): Promise<[BigNumber]>;

    MAX_96(overrides?: CallOverrides): Promise<[BigNumber]>;

    ONE(overrides?: CallOverrides): Promise<[BigNumber]>;

    ZERO(overrides?: CallOverrides): Promise<[BigNumber]>;
  };

  MAX(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_128(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_16(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_24(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_32(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_40(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_48(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_56(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_64(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_72(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_8(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_80(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_88(overrides?: CallOverrides): Promise<BigNumber>;

  MAX_96(overrides?: CallOverrides): Promise<BigNumber>;

  ONE(overrides?: CallOverrides): Promise<BigNumber>;

  ZERO(overrides?: CallOverrides): Promise<BigNumber>;

  callStatic: {
    MAX(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_128(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_16(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_24(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_32(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_40(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_48(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_56(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_64(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_72(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_8(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_80(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_88(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_96(overrides?: CallOverrides): Promise<BigNumber>;

    ONE(overrides?: CallOverrides): Promise<BigNumber>;

    ZERO(overrides?: CallOverrides): Promise<BigNumber>;
  };

  filters: {};

  estimateGas: {
    MAX(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_128(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_16(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_24(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_32(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_40(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_48(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_56(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_64(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_72(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_8(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_80(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_88(overrides?: CallOverrides): Promise<BigNumber>;

    MAX_96(overrides?: CallOverrides): Promise<BigNumber>;

    ONE(overrides?: CallOverrides): Promise<BigNumber>;

    ZERO(overrides?: CallOverrides): Promise<BigNumber>;
  };

  populateTransaction: {
    MAX(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_128(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_16(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_24(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_32(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_40(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_48(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_56(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_64(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_72(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_8(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_80(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_88(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    MAX_96(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    ONE(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    ZERO(overrides?: CallOverrides): Promise<PopulatedTransaction>;
  };
}
