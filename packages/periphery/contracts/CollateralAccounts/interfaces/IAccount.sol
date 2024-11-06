// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";

/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
interface IAccount {
    // sig: 0x9041f6c1
    /// @custom:error Only the owner or the collateral account controller may withdraw
    error AccountNotAuthorizedError();

    /// @notice Sets owner, contract, and token addresses, and runs approvals for a collateral account
    /// @param owner Address of the user for which the account was created
    function initialize(address owner) external;

    /// @notice Transfer USDC collateral from msg.sender to this account
    /// @param amount Quantity of USDC to transfer in 6-decimal precision
    function deposit(UFixed6 amount) external;

    /// @notice used for transferring and rebalancing collateral
    /// @param market Market to transfer funds to/from, which identifies the token
    /// @param amount Quantity to deposit (positive) or withdraw (negative)
    function marketTransfer(IMarket market, Fixed6 amount) external;

    /// @notice Transfer USDC collateral from this account to the owner
    /// @param amount Quantity of tokens to transfer in 6-decimal precision; set to UFixed6.MAX for full withdrawal
    /// @param shouldUnwrap If amount exceeds USDC balance and this is true, DSU will be unwrapped as necessary to facilitate withdrawal
    function withdraw(UFixed6 amount, bool shouldUnwrap) external;

    /// @notice Converts a specified amount of USDC to DSU
    /// @param amount Quantity of DSU to mint, in 18-decimal precision
    function wrap(UFixed18 amount) external;

    /// @notice Wraps if DSU balance is under a specified amount
    /// @param amount Desired quantity of DSU
    /// @param wrapAll True to wrap full USDC balance, false to wrap specified amount
    function wrapIfNecessary(UFixed18 amount, bool wrapAll) external;

    /// @notice Converts a specified amount of DSU to USDC
    /// @param amount Quantity of DSU to burn, in 18-decimal precision
    function unwrap(UFixed18 amount) external;
}
