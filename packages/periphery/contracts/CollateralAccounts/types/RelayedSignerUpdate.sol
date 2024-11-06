// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { SignerUpdate, SignerUpdateLib } from "@perennial/v2-core/contracts/types/SignerUpdate.sol";
import { Action, ActionLib } from "./Action.sol";

struct RelayedSignerUpdate {
    /// @dev Message to relay to MarketFactory
    SignerUpdate signerUpdate;
    /// @dev Common information for relayed actions
    Action action;
}
using RelayedSignerUpdateLib for RelayedSignerUpdate global;

/// @title RelayedSignerUpdateLib
/// @notice Library used to hash and verify action to relay a message to update a signer
library RelayedSignerUpdateLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedSignerUpdate(SignerUpdate signerUpdate,Action action)"
        "AccessUpdate(address accessor,bool approved)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "SignerUpdate(AccessUpdate access,Common common)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedSignerUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, SignerUpdateLib.hash(self.signerUpdate), ActionLib.hash(self.action)));
    }
}
