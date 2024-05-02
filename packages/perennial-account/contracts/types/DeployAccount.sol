// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Action, ActionLib } from "./Action.sol";

struct DeployAccount {
    /// @dev The EOA for which the collateral account should be deployed
    address user;
    /// @dev Common information for collateral account actions
    Action action;
}
using DeployAccountLib for DeployAccount global;

/// @title DeployAccountLib
/// @notice Library used to hash and verify action to deploy a collateral account
library DeployAccountLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "DeployAccount(address user,Action action)"
        "Action(address relayer,uint256 fee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(DeployAccount memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.user, ActionLib.hash(self.action)/*, CommonLib.hash(self.common)*/));
    }
}