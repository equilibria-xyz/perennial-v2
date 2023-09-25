// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import "./ChainlinkOracle.sol";

/// @title ChainlinkOracle_Arbitrum
/// @notice Arbitrum Kept Oracle implementation for Chainlink price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Arbitrum spec
contract ChainlinkOracle_Arbitrum is ChainlinkOracle, Kept_Arbitrum {
    constructor(IVerifierProxy _chainlink) ChainlinkOracle(_chainlink) { }

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calculateDynamicFee(bytes memory callData) internal view override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calculateDynamicFee(callData);
    }

    /// @dev Use the ChainlinkOracle.sol implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(ChainlinkOracle, Kept) {
        ChainlinkOracle._raiseKeeperFee(amount, data);
    }
}
