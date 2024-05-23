// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
interface IAccount {
    // sig: 0x2e4e92db
    /// @custom:error Account owner cannot fully withdraw because they have no collateral balance
    /// @param market address of the market
    error NoCollateral(address market);

    // sig: 0xf36f319e
    /// @custom:error Only the owner or the collateral account controller may withdraw
    error NotAuthorizedError();

    /// @notice Transfer USDC collateral from msg.sender to this account
    /// @param amount Quantity of USDC to transfer in 6-decimal precision
    function deposit(UFixed6 amount) external;

    /// @notice used for transferring and rebalancing collateral
    /// @param market market to transfer funds to/from, which identifies the token
    /// @param amount amount to deposit (positive) or withdraw (negative)
    function marketTransfer(IMarket market, Fixed6 amount) external;

    /// @notice Transfer USDC collateral from this account to the owner
    /// @param amount Quantity of tokens to transfer in 6-decimal precision; set to UFixed6.MAX for full withdrawal
    /// @param unwrap If amount exceeds USDC balance and this is true, DSU will be unwrapped as necessary to facilitate withdrawal
    function withdraw(UFixed6 amount, bool unwrap) external;
}