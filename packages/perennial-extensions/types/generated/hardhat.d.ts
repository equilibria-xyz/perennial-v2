/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { ethers } from "ethers";
import {
  FactoryOptions,
  HardhatEthersHelpers as HardhatEthersHelpersBase,
} from "@nomiclabs/hardhat-ethers/types";

import * as Contracts from ".";

declare module "hardhat/types/runtime" {
  interface HardhatEthersHelpers extends HardhatEthersHelpersBase {
    getContractFactory(
      name: "IOracleProvider",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IOracleProvider__factory>;
    getContractFactory(
      name: "IPayoffProvider",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IPayoffProvider__factory>;
    getContractFactory(
      name: "IMarket",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IMarket__factory>;
    getContractFactory(
      name: "GlobalStorageLib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.GlobalStorageLib__factory>;
    getContractFactory(
      name: "LocalStorageLib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.LocalStorageLib__factory>;
    getContractFactory(
      name: "MarketParameterStorageLib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.MarketParameterStorageLib__factory>;
    getContractFactory(
      name: "PositionStorageLib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.PositionStorageLib__factory>;
    getContractFactory(
      name: "ProtocolParameterStorageLib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.ProtocolParameterStorageLib__factory>;
    getContractFactory(
      name: "VersionStorageLib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.VersionStorageLib__factory>;
    getContractFactory(
      name: "CurveMath6",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.CurveMath6__factory>;
    getContractFactory(
      name: "Fixed6Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.Fixed6Lib__factory>;
    getContractFactory(
      name: "IOwnable",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IOwnable__factory>;
    getContractFactory(
      name: "NumberMath",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.NumberMath__factory>;
    getContractFactory(
      name: "UFixed6Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.UFixed6Lib__factory>;
    getContractFactory(
      name: "Fixed18Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.Fixed18Lib__factory>;
    getContractFactory(
      name: "PackedFixed18Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.PackedFixed18Lib__factory>;
    getContractFactory(
      name: "PackedUFixed18Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.PackedUFixed18Lib__factory>;
    getContractFactory(
      name: "UFixed18Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.UFixed18Lib__factory>;
    getContractFactory(
      name: "Token18Lib",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.Token18Lib__factory>;
    getContractFactory(
      name: "IERC20Permit",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IERC20Permit__factory>;
    getContractFactory(
      name: "IERC20Metadata",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IERC20Metadata__factory>;
    getContractFactory(
      name: "IERC20",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IERC20__factory>;
    getContractFactory(
      name: "IKeeperManager",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IKeeperManager__factory>;
    getContractFactory(
      name: "IMultiInvoker",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IMultiInvoker__factory>;
    getContractFactory(
      name: "KeeperManager",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.KeeperManager__factory>;
    getContractFactory(
      name: "MultiInvoker",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.MultiInvoker__factory>;

    getContractAt(
      name: "IOracleProvider",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IOracleProvider>;
    getContractAt(
      name: "IPayoffProvider",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IPayoffProvider>;
    getContractAt(
      name: "IMarket",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IMarket>;
    getContractAt(
      name: "GlobalStorageLib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.GlobalStorageLib>;
    getContractAt(
      name: "LocalStorageLib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.LocalStorageLib>;
    getContractAt(
      name: "MarketParameterStorageLib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.MarketParameterStorageLib>;
    getContractAt(
      name: "PositionStorageLib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.PositionStorageLib>;
    getContractAt(
      name: "ProtocolParameterStorageLib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.ProtocolParameterStorageLib>;
    getContractAt(
      name: "VersionStorageLib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.VersionStorageLib>;
    getContractAt(
      name: "CurveMath6",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.CurveMath6>;
    getContractAt(
      name: "Fixed6Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.Fixed6Lib>;
    getContractAt(
      name: "IOwnable",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IOwnable>;
    getContractAt(
      name: "NumberMath",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.NumberMath>;
    getContractAt(
      name: "UFixed6Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.UFixed6Lib>;
    getContractAt(
      name: "Fixed18Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.Fixed18Lib>;
    getContractAt(
      name: "PackedFixed18Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.PackedFixed18Lib>;
    getContractAt(
      name: "PackedUFixed18Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.PackedUFixed18Lib>;
    getContractAt(
      name: "UFixed18Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.UFixed18Lib>;
    getContractAt(
      name: "Token18Lib",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.Token18Lib>;
    getContractAt(
      name: "IERC20Permit",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IERC20Permit>;
    getContractAt(
      name: "IERC20Metadata",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IERC20Metadata>;
    getContractAt(
      name: "IERC20",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IERC20>;
    getContractAt(
      name: "IKeeperManager",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IKeeperManager>;
    getContractAt(
      name: "IMultiInvoker",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IMultiInvoker>;
    getContractAt(
      name: "KeeperManager",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.KeeperManager>;
    getContractAt(
      name: "MultiInvoker",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.MultiInvoker>;

    // default types
    getContractFactory(
      name: string,
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<ethers.ContractFactory>;
    getContractFactory(
      abi: any[],
      bytecode: ethers.utils.BytesLike,
      signer?: ethers.Signer
    ): Promise<ethers.ContractFactory>;
    getContractAt(
      nameOrAbi: string | any[],
      address: string,
      signer?: ethers.Signer
    ): Promise<ethers.Contract>;
  }
}
