// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { IOwnable } from "@equilibria/root/attribute/interfaces/IOwnable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";

import { IMarket } from "./IMarket.sol";

/// @notice This contract manages the protocol fee and shortfalls for markets.
interface IInsuranceFund is IOwnable {

    /// @custom:error Thrown when an invalid address is provided.
    error InsuranceFundInvalidInstanceError();

    /// @notice Initializes the InsuranceFund contract.
    function initialize() external;

    /// @notice Claims fees from a market, updating Margin contract's claimable balance.
    /// @param market Market from which to claim protocol fees.
    /// @dev This contract must be approved as an operator of the market factory owner to claim protocol fees.
    function claim(IMarket market) external;

    /// @notice Resolves any shortfall in an isolated market or the user's cross-margin balance.
    /// @param market Market to settle and identify the shortfall.
    /// @param account User for which to resolve the shortfall.
    /// @dev This contract must be approved as an extension on the market factory to resolve market shortfall.
    function resolve(IMarket market, address account) external;
}
