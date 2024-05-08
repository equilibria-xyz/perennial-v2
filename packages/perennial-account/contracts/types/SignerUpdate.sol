// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Action, ActionLib } from "./Action.sol";

struct SignerUpdate {
    /// @dev The signing delegate to assign/enable/disable
    address signer;
    /// @dev True to assign/enable, false to disable
    bool approved;
    /// @dev Common information for collateral account actions;
    /// set action.common.account to the owner whose delegated signer should be updated
    Action action;
}
using SignerUpdateLib for SignerUpdate global;

/// @title SignerUpdateLib
/// @notice Library used to hash and verify action to assign/enable/disable a delegate signer 
/// for a collateral account
library SignerUpdateLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "SignerUpdate(address signer,bool approved,Action action)"
        "Action(address account,uint256 maxFee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(SignerUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.signer, self.approved, ActionLib.hash(self.action)));
    }
}