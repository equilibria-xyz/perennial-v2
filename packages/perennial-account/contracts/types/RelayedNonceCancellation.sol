// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { Action, ActionLib } from "./Action.sol";

struct RelayedNonceCancellation {
    /// @dev Message to relay to verifier, identifying the nonce to cancel
    Common nonceCancellation;
    /// @dev Common information for relayed actions
    Action action;
}
using RelayedNonceCancellationLib for RelayedNonceCancellation global;

/// @title RelayedNonceCancellationLib
/// @notice Library used to hash and verify action to relay a message to cancel a nonce
library RelayedNonceCancellationLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedNonceCancellation(Common nonceCancellation,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedNonceCancellation memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, CommonLib.hash(self.nonceCancellation), ActionLib.hash(self.action)));
    }
}