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
import type {
  FunctionFragment,
  Result,
  EventFragment,
} from "@ethersproject/abi";
import type { Listener, Provider } from "@ethersproject/providers";
import type {
  TypedEventFilter,
  TypedEvent,
  TypedListener,
  OnEvent,
  PromiseOrValue,
} from "../../common";

export declare namespace IKeeperManager {
  export type OrderStruct = {
    isLong: PromiseOrValue<boolean>;
    isFilled: PromiseOrValue<boolean>;
    maxFee: PromiseOrValue<BigNumberish>;
    nonce: PromiseOrValue<BigNumberish>;
    limitPrice: PromiseOrValue<BigNumberish>;
    size: PromiseOrValue<BigNumberish>;
    takeProfit: PromiseOrValue<BigNumberish>;
    stopLoss: PromiseOrValue<BigNumberish>;
  };

  export type OrderStructOutput = [
    boolean,
    boolean,
    number,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber
  ] & {
    isLong: boolean;
    isFilled: boolean;
    maxFee: number;
    nonce: BigNumber;
    limitPrice: BigNumber;
    size: BigNumber;
    takeProfit: BigNumber;
    stopLoss: BigNumber;
  };
}

export interface IKeeperManagerInterface extends utils.Interface {
  functions: {
    "closeOrderInvoker(address,address,uint256)": FunctionFragment;
    "closeOrderKeeper(address,address,uint256)": FunctionFragment;
    "placeOrder(address,address,(bool,bool,uint8,uint128,uint256,uint256,uint256,uint256))": FunctionFragment;
    "readOrderAtIndex(address,address,uint256)": FunctionFragment;
    "updateOrder(address,address,uint256,(bool,bool,uint8,uint128,uint256,uint256,uint256,uint256))": FunctionFragment;
  };

  getFunction(
    nameOrSignatureOrTopic:
      | "closeOrderInvoker"
      | "closeOrderKeeper"
      | "placeOrder"
      | "readOrderAtIndex"
      | "updateOrder"
  ): FunctionFragment;

  encodeFunctionData(
    functionFragment: "closeOrderInvoker",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BigNumberish>
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "closeOrderKeeper",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BigNumberish>
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "placeOrder",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      IKeeperManager.OrderStruct
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "readOrderAtIndex",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BigNumberish>
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "updateOrder",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BigNumberish>,
      IKeeperManager.OrderStruct
    ]
  ): string;

  decodeFunctionResult(
    functionFragment: "closeOrderInvoker",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "closeOrderKeeper",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "placeOrder", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "readOrderAtIndex",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "updateOrder",
    data: BytesLike
  ): Result;

  events: {
    "OrderCancelled(address,address,uint256,uint128)": EventFragment;
    "OrderClosed(address,address,uint256,uint128)": EventFragment;
    "OrderFilled(address,address,uint256,uint128,uint256,uint256)": EventFragment;
    "OrderOpened(address,address,uint256,uint256,bool,uint256,uint256,uint8)": EventFragment;
    "OrderUpdated(address,address,uint256,uint256,uint256,uint256,uint256,uint8)": EventFragment;
  };

  getEvent(nameOrSignatureOrTopic: "OrderCancelled"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderClosed"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderFilled"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderOpened"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderUpdated"): EventFragment;
}

export interface OrderCancelledEventObject {
  account: string;
  market: string;
  orderIndex: BigNumber;
  orderNonce: BigNumber;
}
export type OrderCancelledEvent = TypedEvent<
  [string, string, BigNumber, BigNumber],
  OrderCancelledEventObject
>;

export type OrderCancelledEventFilter = TypedEventFilter<OrderCancelledEvent>;

export interface OrderClosedEventObject {
  account: string;
  market: string;
  orderIndex: BigNumber;
  orderNonce: BigNumber;
}
export type OrderClosedEvent = TypedEvent<
  [string, string, BigNumber, BigNumber],
  OrderClosedEventObject
>;

export type OrderClosedEventFilter = TypedEventFilter<OrderClosedEvent>;

export interface OrderFilledEventObject {
  account: string;
  market: string;
  orderIndex: BigNumber;
  orderNonce: BigNumber;
  limitPrice: BigNumber;
  fillPrice: BigNumber;
}
export type OrderFilledEvent = TypedEvent<
  [string, string, BigNumber, BigNumber, BigNumber, BigNumber],
  OrderFilledEventObject
>;

export type OrderFilledEventFilter = TypedEventFilter<OrderFilledEvent>;

export interface OrderOpenedEventObject {
  account: string;
  market: string;
  index: BigNumber;
  orderNonce: BigNumber;
  isLimit: boolean;
  takeProfit: BigNumber;
  stopLoss: BigNumber;
  fee: number;
}
export type OrderOpenedEvent = TypedEvent<
  [string, string, BigNumber, BigNumber, boolean, BigNumber, BigNumber, number],
  OrderOpenedEventObject
>;

export type OrderOpenedEventFilter = TypedEventFilter<OrderOpenedEvent>;

export interface OrderUpdatedEventObject {
  account: string;
  market: string;
  index: BigNumber;
  nonce: BigNumber;
  newTakeProfit: BigNumber;
  newStopLoss: BigNumber;
  limitPrice: BigNumber;
  newFee: number;
}
export type OrderUpdatedEvent = TypedEvent<
  [
    string,
    string,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
    number
  ],
  OrderUpdatedEventObject
>;

export type OrderUpdatedEventFilter = TypedEventFilter<OrderUpdatedEvent>;

export interface IKeeperManager extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: IKeeperManagerInterface;

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
    closeOrderInvoker(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;

    closeOrderKeeper(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;

    placeOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      order: IKeeperManager.OrderStruct,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;

    readOrderAtIndex(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<
      [IKeeperManager.OrderStructOutput] & {
        order: IKeeperManager.OrderStructOutput;
      }
    >;

    updateOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      orderIndex: PromiseOrValue<BigNumberish>,
      order: IKeeperManager.OrderStruct,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;
  };

  closeOrderInvoker(
    account: PromiseOrValue<string>,
    market: PromiseOrValue<string>,
    index: PromiseOrValue<BigNumberish>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  closeOrderKeeper(
    account: PromiseOrValue<string>,
    market: PromiseOrValue<string>,
    index: PromiseOrValue<BigNumberish>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  placeOrder(
    account: PromiseOrValue<string>,
    market: PromiseOrValue<string>,
    order: IKeeperManager.OrderStruct,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  readOrderAtIndex(
    account: PromiseOrValue<string>,
    market: PromiseOrValue<string>,
    index: PromiseOrValue<BigNumberish>,
    overrides?: CallOverrides
  ): Promise<IKeeperManager.OrderStructOutput>;

  updateOrder(
    account: PromiseOrValue<string>,
    market: PromiseOrValue<string>,
    orderIndex: PromiseOrValue<BigNumberish>,
    order: IKeeperManager.OrderStruct,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  callStatic: {
    closeOrderInvoker(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<void>;

    closeOrderKeeper(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<void>;

    placeOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      order: IKeeperManager.OrderStruct,
      overrides?: CallOverrides
    ): Promise<void>;

    readOrderAtIndex(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<IKeeperManager.OrderStructOutput>;

    updateOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      orderIndex: PromiseOrValue<BigNumberish>,
      order: IKeeperManager.OrderStruct,
      overrides?: CallOverrides
    ): Promise<void>;
  };

  filters: {
    "OrderCancelled(address,address,uint256,uint128)"(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      orderIndex?: null,
      orderNonce?: null
    ): OrderCancelledEventFilter;
    OrderCancelled(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      orderIndex?: null,
      orderNonce?: null
    ): OrderCancelledEventFilter;

    "OrderClosed(address,address,uint256,uint128)"(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      orderIndex?: null,
      orderNonce?: null
    ): OrderClosedEventFilter;
    OrderClosed(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      orderIndex?: null,
      orderNonce?: null
    ): OrderClosedEventFilter;

    "OrderFilled(address,address,uint256,uint128,uint256,uint256)"(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      orderIndex?: null,
      orderNonce?: null,
      limitPrice?: null,
      fillPrice?: null
    ): OrderFilledEventFilter;
    OrderFilled(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      orderIndex?: null,
      orderNonce?: null,
      limitPrice?: null,
      fillPrice?: null
    ): OrderFilledEventFilter;

    "OrderOpened(address,address,uint256,uint256,bool,uint256,uint256,uint8)"(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      index?: null,
      orderNonce?: null,
      isLimit?: null,
      takeProfit?: null,
      stopLoss?: null,
      fee?: null
    ): OrderOpenedEventFilter;
    OrderOpened(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      index?: null,
      orderNonce?: null,
      isLimit?: null,
      takeProfit?: null,
      stopLoss?: null,
      fee?: null
    ): OrderOpenedEventFilter;

    "OrderUpdated(address,address,uint256,uint256,uint256,uint256,uint256,uint8)"(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      index?: null,
      nonce?: null,
      newTakeProfit?: null,
      newStopLoss?: null,
      limitPrice?: null,
      newFee?: null
    ): OrderUpdatedEventFilter;
    OrderUpdated(
      account?: PromiseOrValue<string> | null,
      market?: PromiseOrValue<string> | null,
      index?: null,
      nonce?: null,
      newTakeProfit?: null,
      newStopLoss?: null,
      limitPrice?: null,
      newFee?: null
    ): OrderUpdatedEventFilter;
  };

  estimateGas: {
    closeOrderInvoker(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;

    closeOrderKeeper(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;

    placeOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      order: IKeeperManager.OrderStruct,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;

    readOrderAtIndex(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    updateOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      orderIndex: PromiseOrValue<BigNumberish>,
      order: IKeeperManager.OrderStruct,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;
  };

  populateTransaction: {
    closeOrderInvoker(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;

    closeOrderKeeper(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;

    placeOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      order: IKeeperManager.OrderStruct,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;

    readOrderAtIndex(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      index: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    updateOrder(
      account: PromiseOrValue<string>,
      market: PromiseOrValue<string>,
      orderIndex: PromiseOrValue<BigNumberish>,
      order: IKeeperManager.OrderStruct,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;
  };
}
