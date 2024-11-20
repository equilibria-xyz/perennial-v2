// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { IOwnable } from "@equilibria/root/attribute/interfaces/IOwnable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";

import { IMarketFactory } from "./IMarketFactory.sol";

/// @notice This contract manages the protocol fee and shortfalls for markets.
interface IInsuranceFund is IOwnable {
     
    /// @custom:error Thrown when an invalid address is provided.
    error InsuranceFundInvalidAddress();

    /// @custom:error Thrown when an invalid amount is provided.
    error InsuranceFundInvalidAmount();

    /// @notice Initializes the InsuranceFund contract.
    /// @param _marketFactory The address of the market factory.
    /// @param _token The address of the DSU token.
    function initialize(IMarketFactory _marketFactory, Token18 _token) external;

    /// @notice Claims fees from a market.
    /// @param market The address of the market from which to claim protocol fees.
    function claimFees(address market) external;

    /// @notice Resolves any shortfall in a market.
    /// @param market The address of the market for which to resolve the shortfall.
    function resolveShortfall(address market) external;

    /// @notice Sends DSU tokens to a market contract.
    /// @param market The address of the market contract to send DSU tokens to.
    /// @param amount The amount of DSU tokens to send.
    function sendDSUToMarket(address market, UFixed18 amount) external;

    /// @notice Withdraws DSU tokens from the contract.
    /// @param amount The amount of DSU tokens to withdraw.
    function withdrawDSU(UFixed18 amount) external;
}