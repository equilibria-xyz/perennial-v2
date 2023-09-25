// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import "./ChainlinkOracle.sol";

/// @title ChainlinkOracle_Optimism
/// @notice Optimism Kept Oracle implementation for Chainlink price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract ChainlinkOracle_Optimism is ChainlinkOracle, Kept_Optimism {
    constructor(IVerifierProxy _chainlink) ChainlinkOracle(_chainlink) { }

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calculateDynamicFee(bytes memory callData) internal view override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calculateDynamicFee(callData);
    }

    /// @dev Use the ChainlinkOracle.sol implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(ChainlinkOracle, Kept) {
        ChainlinkOracle._raiseKeeperFee(amount, data);
    }
}
