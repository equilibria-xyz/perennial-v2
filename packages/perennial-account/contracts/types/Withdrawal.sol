// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Action, ActionLib } from "./Action.sol";

struct Withdrawal {
    /// @dev Amount to withdraw; set to UFixed6.MAX for full withdrawal
    UFixed6 amount;
    /// @dev True to withdraw as USDC, false to withdraw as DSU
    bool unwrap;
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
        "Withdrawal(uint256 amount,bool unwrap,Action action)"
        "Action(address account,uint256 maxFee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(Withdrawal memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.amount, self.unwrap, ActionLib.hash(self.action)));
    }
}