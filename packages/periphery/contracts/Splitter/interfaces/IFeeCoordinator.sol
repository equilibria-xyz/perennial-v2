// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";

import { IFeeSplitter } from "./IFeeSplitter.sol";

/// @dev Coordinates a set of fee splitters contracts.
interface IFeeCoordinator is IFactory {
    // sig: 0x24bb1db5
    error FeeCoordinatorInvalidMarketError();

    /// @notice Returns the market factory.
    function marketFactory() external view returns (IMarketFactory);

    /// @notice Returns the set of registered markets.
    function markets() external view returns (address[] memory);

    /// @notice Returns the set of created splitters.
    function splitters() external view returns (address[] memory);

    /// @notice Initializes the contract.
    function initialize() external;

    /// @notice Creates a new fee splitter.
    /// @param beneficiary The initial parent beneficiary of the fee splitter.
    /// @return newSplitter The new fee splitter contract address.
    function create(address beneficiary) external returns (IFeeSplitter newSplitter);

    /// @notice Registers `market` as a registered market if it is valid.
    /// @param market The market to register.
    function register(IMarket market) external;

    /// @notice Pokes all created fee splitters.
    function poke() external;
}
