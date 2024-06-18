// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Action, ActionLib } from "./Action.sol";

struct DeployAccount {
    /// @dev Common information for collateral account actions
    Action action;
}
using DeployAccountLib for DeployAccount global;

/// @title DeployAccountLib
/// @notice Library used to hash and verify action to deploy a collateral account
library DeployAccountLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "DeployAccount(Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev Used to create a signed message
    function hash(DeployAccount memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, ActionLib.hash(self.action)));
    }
}
