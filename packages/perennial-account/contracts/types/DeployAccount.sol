// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Action, ActionLib } from "./Action.sol";

// TODO: rename to be a noun rather than a verb
struct DeployAccount {
    /// @dev Common information for collateral account actions;
    /// set action.common.account to the user address for which the collateral account should be deployed
    Action action;
}
using DeployAccountLib for DeployAccount global;

/// @title DeployAccountLib
/// @notice Library used to hash and verify action to deploy a collateral account
library DeployAccountLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "DeployAccount(Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(DeployAccount memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, ActionLib.hash(self.action)));
    }
}
