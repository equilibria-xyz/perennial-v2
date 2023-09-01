// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import "./PythOracle.sol";

/// @title PythOracle_Arbitrum
/// @notice Arbitrum Kept Oracle implementation for Pyth price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Arbitrum spec
contract PythOracle_Arbitrum is PythOracle, Kept_Arbitrum {
    constructor(AbstractPyth _pyth) PythOracle(_pyth) { }

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calculateDynamicFee(bytes memory callData) internal view override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calculateDynamicFee(callData);
    }

    /// @dev Use the PythOracle implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(PythOracle, Kept) {
        PythOracle._raiseKeeperFee(amount, data);
    }
}
