// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Kept, Kept_Arbitrum, Token18, UFixed18 } from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";

import { IController } from "../CollateralAccounts/interfaces/IController.sol";
import { IOrderVerifier, Manager } from "./Manager.sol";

contract Manager_Arbitrum is Manager, Kept_Arbitrum {
    /// @dev passthrough constructor
    constructor(
        Token6 usdc,
        Token18 dsu,
        IEmptySetReserve reserve,
        IMarketFactory marketFactory,
        IOrderVerifier verifier,
        IController controller
    ) Manager(usdc, dsu, reserve, marketFactory, verifier, controller) {}

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Use the base implementation for raising the keeper fee
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(Manager, Kept) returns (UFixed18) {
        return Manager._raiseKeeperFee(amount, data);
    }
}
