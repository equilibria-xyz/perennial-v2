// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

import { IMarket } from "./IMarket.sol";

interface IMargin is IInstance {
    // sig: 0x901eb073
    /// custom:error Specified amount cannot be withdrawn; ensure funds are not isolated
    error InsufficientCrossMarginBalance();

    /// @notice Retrieves the cross-margin balance for a user
    function crossMarginBalances(address) external view returns (UFixed6);

    /// @notice Retrieves the isolated balance for a user and market
    function isolatedBalances(address, IMarket) external view returns (UFixed6);

    /// @notice Add DSU funds to the msg.sender's cross-margin account
    /// @param amount quantity of DSU to pull from sender
    function deposit(UFixed6 amount) external;

    /// @notice Remove DSU funds from the msg.sender's cross-margin account
    /// @param amount quantity of DSU to push to sender
    function withdraw(UFixed6 amount) external;

    /// @notice Disable cross-margin and designate specified portion of collateral to a specific market
    /// @param amount quantity of collateral to designate
    /// @param market identifies where cross-margin should be disabled and collateral deposited
    function isolate(UFixed6 amount, IMarket market) external;

    /// @notice Enable cross-margin and designate all collateral from that market as cross-margin
    /// @param market identifies where cross-margin should be enabled, and collateral withdrawn
    function cross(IMarket market) external;

    /// @notice Settles all registered markets for account and calculates whether margin requirements are met
    /// @param account user to settle and for whom margin requirement will be checked
    /// @return isMargined true if margin requirement met, otherwise false
    function margined(address account) external returns (bool isMargined);

    /// @notice Settles all registered markets for account and calculates whether maintenance requirements are met
    /// @param account user to settle and for whom maintenance requirement will be checked
    /// @return isMaintained true if maintenance requirement met, otherwise false
    function maintained(address account) external returns (bool isMaintained);

    /// @dev Called by market upon settlement, updates the account’s balance by a collateral delta,
    /// and credits claimable accounts for fees
    /// @param account user whose collateral balance will be updated
    /// @param amount quantity of collateral to add (positive) or remove (negative)
    function update(address account, Fixed6 amount) external;
}