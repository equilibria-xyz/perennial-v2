// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

interface IAccount {
    // sig: 0x2fda6ab7
    /// @custom:error Token is not 6- or 18- decimals, or does not offer a .decimals() function
    error TokenNotSupportedError();

    // sig: 0x458a16af
    /// @custom:error Only the owner or the collateral account controller may withdraw
    error NotAuthorizedError(address);

    // TODO: consider adding withdrawalTarget parameter
    /// @notice Transfers funds from this contract to owner of this collateral account
    /// @param token identifies which collateral to withdraw
    /// @param amount amount to withdraw in 6-decimal precision; set to UFixed6.MAX for full withdrawal
    function withdraw(address token, UFixed6 amount) external;
}