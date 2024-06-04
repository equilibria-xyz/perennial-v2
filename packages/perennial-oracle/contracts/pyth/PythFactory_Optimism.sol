// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import "./PythFactory.sol";
import "../keeper/KeeperFactory.sol";

/// @title PythFactory_Optimism
/// @notice Optimism Kept Oracle implementation for Pyth price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract PythFactory_Optimism is PythFactory, Kept_Optimism {
    constructor(
        AbstractPyth pyth_,
        address implementation_,
        uint256 validFrom_,
        uint256 validTo_,
        KeepConfig memory commitKeepConfig_,
        KeepConfig memory settleKeepConfig_,
        uint256 keepCommitIncrementalBufferData_
    ) PythFactory(pyth_, implementation_, validFrom_, validTo_, commitKeepConfig_, settleKeepConfig_, keepCommitIncrementalBufferData_) { }

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view virtual override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Use the PythFactory implementation for raising the keeper fee
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(KeeperFactory, Kept) returns (UFixed18) {
        return KeeperFactory._raiseKeeperFee(amount, data);
    }
}
