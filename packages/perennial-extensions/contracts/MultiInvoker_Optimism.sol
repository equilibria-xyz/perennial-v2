// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import "./MultiInvoker.sol";

/// @title MultiInvoker_Optimism
/// @notice Optimism Kept MultiInvoker implementation.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract MultiInvoker_Optimism is MultiInvoker, Kept_Optimism {
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        uint256 keepBufferBase_,
        uint256 keepBufferCalldata_
    ) MultiInvoker(
        usdc_,
        dsu_,
        marketFactory_,
        vaultFactory_,
        batcher_,
        reserve_,
        keepBufferBase_,
        keepBufferCalldata_
    ) { }

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Use the PythOracle implementation for raising the keeper fee
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(MultiInvoker, Kept) returns (UFixed18) {
        return MultiInvoker._raiseKeeperFee(amount, data);
    }
}
