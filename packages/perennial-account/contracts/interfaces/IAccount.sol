// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

interface IAccount {
    // TODO: consider adding withdrawalTarget parameter
    /// @notice Transfers funds from this contract to owner of this collateral account
    /// @param token identifies which collateral to withdraw
    /// @param amount identifies how much to withdraw; set to type(uint256).max for full withdrawal
    function withdraw(Token18 token, UFixed6 amount) external;
}