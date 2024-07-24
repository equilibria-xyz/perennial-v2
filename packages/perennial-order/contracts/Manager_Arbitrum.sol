// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Kept, Kept_Arbitrum, Token18, UFixed18 } from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { IMarketFactory } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";
import { IOrderVerifier, Manager } from "./Manager.sol";

contract Manager_Arbitrum is Manager, Kept_Arbitrum {
    /// @dev passthrough constructor
    constructor(Token18 dsu, IMarketFactory marketFactory, IOrderVerifier verifier)
        Manager(dsu, marketFactory, verifier) {}

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /*/// @dev Use the base implementation for raising the keeper fee
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(Manager, Kept) returns (UFixed18) {
        return Manager._raiseKeeperFee(amount, data);
    }*/
}
