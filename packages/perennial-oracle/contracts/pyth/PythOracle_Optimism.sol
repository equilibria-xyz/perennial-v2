// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import "./PythOracle.sol";

/// @title PythOracle_Optimism
/// @notice Optimism Kept Oracle implementation for Pyth price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract PythOracle_Optimism is PythOracle, Kept_Optimism {
    constructor(AbstractPyth _pyth) PythOracle(_pyth) { }

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calculateDynamicFee(bytes memory callData) internal view override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calculateDynamicFee(callData);
    }

    /// @dev Use the PythOracle implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(PythOracle, Kept) {
        PythOracle._raiseKeeperFee(amount, data);
    }
}
