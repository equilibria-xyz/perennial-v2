// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Action, ActionLib } from "./Action.sol";

struct Withdrawal {
    /// @dev Address of the collateral token to transfer
    address token;
    /// @dev Amount to withdraw; set to UFixed6.MAX for full withdrawal
    UFixed6 amount;
    /// @dev Common information for collateral account actions;
    /// set action.common.account to the owner of the collateral account
    Action action;
}
using WithdrawalLib for Withdrawal global;

/// @title WithdrawalLib
/// @notice Library used to hash and verify action to withdraw from a collateral account
library WithdrawalLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "Withdrawal(address token,uint256 amount,Action action)"
        "Action(uint256 fee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(Withdrawal memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.token, self.amount, ActionLib.hash(self.action)));
    }
}