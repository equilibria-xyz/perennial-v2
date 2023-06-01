/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer, utils } from "ethers";
import type { Provider } from "@ethersproject/providers";
import type {
  IKeeperManager,
  IKeeperManagerInterface,
} from "../../../contracts/interfaces/IKeeperManager";

const _abi = [
  {
    inputs: [],
    name: "KeeeperManager_NotOnlyInvoker",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_BadOrderParams",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_CancelOrder_OrderAlreadyCancelled",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_CloseOrderKeeper_BadClose",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_CloseOrderKeeper_CannotCancelUnfilledOrder",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_FillOrder_CannotFill",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_MaxFeeGt100",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_NotOnlyKeeper",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_PlaceOrder_MaxOpenOrders",
    type: "error",
  },
  {
    inputs: [],
    name: "KeeperManager_UpdateOrder_OrderDoesNotExist",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "orderIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "orderNonce",
        type: "uint128",
      },
    ],
    name: "OrderCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "orderIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "orderNonce",
        type: "uint128",
      },
    ],
    name: "OrderClosed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "orderIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "orderNonce",
        type: "uint128",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "limitPrice",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "fillPrice",
        type: "uint256",
      },
    ],
    name: "OrderFilled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "orderNonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "isLimit",
        type: "bool",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "takeProfit",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "stopLoss",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "fee",
        type: "uint8",
      },
    ],
    name: "OrderOpened",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "nonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "newTakeProfit",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "newStopLoss",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "UFixed6",
        name: "limitPrice",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "newFee",
        type: "uint8",
      },
    ],
    name: "OrderUpdated",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "closeOrderInvoker",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "closeOrderKeeper",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        components: [
          {
            internalType: "bool",
            name: "isLong",
            type: "bool",
          },
          {
            internalType: "bool",
            name: "isFilled",
            type: "bool",
          },
          {
            internalType: "uint8",
            name: "maxFee",
            type: "uint8",
          },
          {
            internalType: "uint128",
            name: "nonce",
            type: "uint128",
          },
          {
            internalType: "UFixed6",
            name: "limitPrice",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "size",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "takeProfit",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "stopLoss",
            type: "uint256",
          },
        ],
        internalType: "struct IKeeperManager.Order",
        name: "order",
        type: "tuple",
      },
    ],
    name: "placeOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "readOrderAtIndex",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "isLong",
            type: "bool",
          },
          {
            internalType: "bool",
            name: "isFilled",
            type: "bool",
          },
          {
            internalType: "uint8",
            name: "maxFee",
            type: "uint8",
          },
          {
            internalType: "uint128",
            name: "nonce",
            type: "uint128",
          },
          {
            internalType: "UFixed6",
            name: "limitPrice",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "size",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "takeProfit",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "stopLoss",
            type: "uint256",
          },
        ],
        internalType: "struct IKeeperManager.Order",
        name: "order",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "address",
        name: "market",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "orderIndex",
        type: "uint256",
      },
      {
        components: [
          {
            internalType: "bool",
            name: "isLong",
            type: "bool",
          },
          {
            internalType: "bool",
            name: "isFilled",
            type: "bool",
          },
          {
            internalType: "uint8",
            name: "maxFee",
            type: "uint8",
          },
          {
            internalType: "uint128",
            name: "nonce",
            type: "uint128",
          },
          {
            internalType: "UFixed6",
            name: "limitPrice",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "size",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "takeProfit",
            type: "uint256",
          },
          {
            internalType: "UFixed6",
            name: "stopLoss",
            type: "uint256",
          },
        ],
        internalType: "struct IKeeperManager.Order",
        name: "order",
        type: "tuple",
      },
    ],
    name: "updateOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export class IKeeperManager__factory {
  static readonly abi = _abi;
  static createInterface(): IKeeperManagerInterface {
    return new utils.Interface(_abi) as IKeeperManagerInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): IKeeperManager {
    return new Contract(address, _abi, signerOrProvider) as IKeeperManager;
  }
}
