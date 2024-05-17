// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
interface IAccount {
    // sig: 0x458a16af
    /// @custom:error Only the owner or the collateral account controller may withdraw
    error NotAuthorizedError(address);

    /// @notice Transfer DSU or USDC collateral from msg.sender to this account
    /// @param amount Quantity of tokens to transfer in 6-decimal precision
    /// @param wrap Determines whether to pull USDC (true) or DSU (false)
    function deposit(UFixed6 amount, bool wrap) external;

    /// @notice Transfer USDC collateral from this account to the owner
    /// @param amount Quantity of tokens to transfer in 6-decimal precision; set to UFixed6.MAX for full withdrawal
    /// @param unwrap If amount exceeds USDC balance and this is true, DSU will be unwrapped as necessary to facilitate withdrawal
    function withdraw(UFixed6 amount, bool unwrap) external;
}