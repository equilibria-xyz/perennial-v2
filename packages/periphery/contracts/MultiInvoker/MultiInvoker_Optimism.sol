// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IFactory } from "@equilibria/root/attribute/Factory.sol";
import { Kept, Kept_Optimism } from "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { MultiInvoker } from "./MultiInvoker.sol";

/// @title MultiInvoker_Optimism
/// @notice Optimism Kept MultiInvoker implementation.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract MultiInvoker_Optimism is MultiInvoker, Kept_Optimism {
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory makerVaultFactory_,
        IFactory solverVaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        uint256 keepBufferBase_,
        uint256 keepBufferCalldata_
    ) MultiInvoker(
        usdc_,
        dsu_,
        marketFactory_,
        makerVaultFactory_,
        solverVaultFactory_,
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
