// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";

import { IFeeSplitter } from "./IFeeSplitter.sol";

interface IFeeCoordinator is IFactory {
    function marketFactory() external view returns (IMarketFactory);
    function markets() external view returns (address[] memory);
    function create(address beneficiary) external returns (IFeeSplitter newSplitter);
    function register(IMarket market) external;
    function poke() external;
}
