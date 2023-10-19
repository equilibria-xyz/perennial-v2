// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import "./PythFactory.sol";

/// @title PythFactory_Optimism
/// @notice Optimism Kept Oracle implementation for Pyth price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract PythFactory_Optimism is PythFactory, Kept_Optimism {
    constructor(AbstractPyth pyth_, address implementation_) PythFactory(pyth_, implementation_) { }

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calculateDynamicFee(bytes memory callData) internal view override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calculateDynamicFee(callData);
    }

    /// @dev Use the PythFactory implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(PythFactory, Kept) {
        PythFactory._raiseKeeperFee(amount, data);
    }
}
