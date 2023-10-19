// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

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
        UFixed18 keepMultiplierBase_,
        uint256 keepBufferBase_,
        UFixed18 keepMultiplierData_,
        uint256 keepBufferData_
    ) PythFactory(pyth_, implementation_, validFrom_, validTo_, keepMultiplierBase_, keepBufferBase_, keepMultiplierData_, keepBufferData_ ) { }

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calldataFee(
        bytes calldata applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view virtual override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Use the PythFactory implementation for raising the keeper fee
    function _raiseKeeperFee(UFixed18 amount, bytes memory data) internal override(KeeperFactory, Kept) {
        KeeperFactory._raiseKeeperFee(amount, data);
    }
}
