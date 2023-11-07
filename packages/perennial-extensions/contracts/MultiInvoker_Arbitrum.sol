// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import "./MultiInvoker.sol";

/// @title MultiInvoker_Arbitrum
/// @notice Arbitrum Kept MultiInvoker implementation.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Arbitrum spec
contract MultiInvoker_Arbitrum is MultiInvoker, Kept_Arbitrum {
    constructor(Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        UFixed6 keeperMultiplier_) MultiInvoker(usdc_, dsu_, marketFactory_, vaultFactory_, batcher_, reserve_, keeperMultiplier_) { }

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calculateDynamicFee(bytes memory callData) internal view override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calculateDynamicFee(callData);
    }

    /// @dev Use the PythOracle implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(MultiInvoker, Kept) {
        MultiInvoker._raiseKeeperFee(amount, data);
    }
}