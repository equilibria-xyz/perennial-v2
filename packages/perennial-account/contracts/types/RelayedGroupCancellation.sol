// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { GroupCancellation, GroupCancellationLib } from "@equilibria/root/verifier/types/GroupCancellation.sol";
import { Action, ActionLib } from "./Action.sol";

struct RelayedGroupCancellation {
    /// @dev Message to relay to verifier, identifying the group to cancel
    GroupCancellation groupCancellation;
    /// @dev Common information for relayed actions
    Action action;
}
using RelayedGroupCancellationLib for RelayedGroupCancellation global;

/// @title RelayedGroupCancellationLib
/// @notice Library used to hash and verify action to relay a message to cancel a group
library RelayedGroupCancellationLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedGroupCancellation(GroupCancellation groupCancellation,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "GroupCancellation(uint256 group,Common common)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedGroupCancellation memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, GroupCancellationLib.hash(self.groupCancellation), ActionLib.hash(self.action)));
    }
}