// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";

import { IFeeSplitter } from "./IFeeSplitter.sol";

interface IFeeCoordinator is IFactory {
    // sig: 0x24bb1db5
    error FeeCoordinatorInvalidMarketError();

    function marketFactory() external view returns (IMarketFactory);
    function markets() external view returns (address[] memory);
    function initialize() external;
    function create(address beneficiary) external returns (IFeeSplitter newSplitter);
    function register(IMarket market) external;
    function poke() external;
}
