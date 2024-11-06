// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AccessUpdateBatch, AccessUpdateBatchLib } from "@perennial/v2-core/contracts/types/AccessUpdateBatch.sol";
import { Action, ActionLib } from "./Action.sol";

struct RelayedAccessUpdateBatch {
    /// @dev Message to relay to MarketFactory
    AccessUpdateBatch accessUpdateBatch;
    /// @dev Common information for relayed actions
    Action action;
}
using RelayedAccessUpdateBatchLib for RelayedAccessUpdateBatch global;

/// @title RelayedAccessUpdateBatchLib
/// @notice Library used to hash and verify action to relay a message to change status of operators and signers
library RelayedAccessUpdateBatchLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedAccessUpdateBatch(AccessUpdateBatch accessUpdateBatch,Action action)"
        "AccessUpdate(address accessor,bool approved)"
        "AccessUpdateBatch(AccessUpdate[] operators,AccessUpdate[] signers,Common common)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedAccessUpdateBatch memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, AccessUpdateBatchLib.hash(self.accessUpdateBatch), ActionLib.hash(self.action)));
    }
}
