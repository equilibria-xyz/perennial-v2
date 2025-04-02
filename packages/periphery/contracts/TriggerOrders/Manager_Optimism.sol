// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Kept, Kept_Optimism, Token18, UFixed18 } from "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IMargin } from "@perennial/v2-core/contracts/interfaces/IMargin.sol";

import { IOrderVerifier, Manager } from "./Manager.sol";

contract Manager_Optimism is Manager, Kept_Optimism {
    /// @dev passthrough constructor
    constructor(
        Token18 dsu,
        IMarketFactory marketFactory,
        IOrderVerifier verifier,
        IMargin margin
    ) Manager(dsu, marketFactory, verifier, margin) {}

    /// @dev Use the Kept_Optimism implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view override(Kept_Optimism, Kept) returns (UFixed18) {
        return Kept_Optimism._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Use the base implementation for raising the keeper fee
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(Manager, Kept) returns (UFixed18) {
        return Manager._raiseKeeperFee(amount, data);
    }
}
