// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Action, ActionLib } from "./Action.sol";

struct UpdateSigner {
    /// @dev The collateral account to update
    address account;
    /// @dev The signing delegate to assign/enable/disable
    address delegate;
    /// @dev True to assign/enable, false to disable
    bool newEnabled;
    /// @dev Common information for collateral account actions
    Action action;
}
using UpdateSignerLib for UpdateSigner global;

/// @title UpdateSignerLib
/// @notice Library used to hash and verify action to assign/enable/disable a delegate signer 
/// for a collateral account
library UpdateSignerLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "UpdateSigner(address account,address delegate,bool newEnabled,Action action)"
        "Action(uint256 fee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(UpdateSigner memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.account, self.delegate, self.newEnabled, ActionLib.hash(self.action)));
    }
}