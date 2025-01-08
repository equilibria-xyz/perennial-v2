// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { OperatorUpdate, OperatorUpdateLib } from "@perennial/v2-core/contracts/types/OperatorUpdate.sol";
import { Action, ActionLib } from "./Action.sol";

struct RelayedOperatorUpdate {
    /// @dev Message to relay to MarketFactory
    OperatorUpdate operatorUpdate;
    /// @dev Common information for relayed actions
    Action action;
}
using RelayedOperatorUpdateLib for RelayedOperatorUpdate global;

/// @title RelayedOperatorUpdateLib
/// @notice Library used to hash and verify action to relay a message to update an operator
library RelayedOperatorUpdateLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedOperatorUpdate(OperatorUpdate operatorUpdate,Action action)"
        "AccessUpdate(address accessor,bool approved)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "OperatorUpdate(AccessUpdate access,Common common)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedOperatorUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, OperatorUpdateLib.hash(self.operatorUpdate), ActionLib.hash(self.action)));
    }
}
