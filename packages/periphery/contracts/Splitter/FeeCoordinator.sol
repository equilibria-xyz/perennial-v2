// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Factory } from "@equilibria/root/attribute/Factory.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { IFeeCoordinator } from "./interfaces/IFeeCoordinator.sol";
import { IFeeSplitter } from "./interfaces/IFeeSplitter.sol";

/// @dev Coordinates a set of fee splitters contracts.
contract FeeCoordinator is IFeeCoordinator, Factory {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev The market factory.
    IMarketFactory public immutable marketFactory;

    /// @dev The set of registered markets.
    EnumerableSet.AddressSet private _markets;

    /// @dev The set of created splitters.
    EnumerableSet.AddressSet private _splitters;

    /// @notice Constructs the contract.
    /// @param marketFactory_ The market factory.
    /// @param implementation_ The implementation contract for the fee splitter instances.
    constructor(IMarketFactory marketFactory_, address implementation_) Factory(implementation_) {
        marketFactory = marketFactory_;
    }

    /// @inheritdoc IFeeCoordinator
    function initialize() external initializer(1) {
        __Factory__initialize();
    }

    /// @inheritdoc IFeeCoordinator
    function create(address beneficiary) external onlyOwner returns (IFeeSplitter newSplitter) {
        newSplitter = IFeeSplitter(address(_create(abi.encodeCall(IFeeSplitter.initialize, (beneficiary)))));
        _splitters.add(address(newSplitter));
    }

    /// @inheritdoc IFeeCoordinator
    function markets() external view returns (address[] memory) {
        return _markets.values();
    }

    /// @inheritdoc IFeeCoordinator
    function splitters() external view returns (address[] memory) {
        return _splitters.values();
    }

    /// @inheritdoc IFeeCoordinator
    function register(IMarket market) external {
        if (!marketFactory.instances(market)) revert FeeCoordinatorInvalidMarketError();
        _markets.add(address(market));
    }

    /// @inheritdoc IFeeCoordinator
    function poke() external {
        for (uint256 i; i < _splitters.length(); i++) IFeeSplitter(payable(_splitters.at(i))).poke();
    }
}
