// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { AccessUpdate, AccessUpdateLib } from "./AccessUpdate.sol";

struct OperatorUpdate {
    /// @dev The operator access to update
    AccessUpdate access;

    /// @dev The common information for the intent
    Common common;
}
using OperatorUpdateLib for OperatorUpdate global;

/// @title OperatorUpdateLib
/// @notice Library for OperatorUpdate logic and data.
library OperatorUpdateLib {
    bytes32 constant public STRUCT_HASH = keccak256(
        "OperatorUpdate(AccessUpdate access,Common common)"
        "AccessUpdate(address accessor,bool approved)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    function hash(OperatorUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, AccessUpdateLib.hash(self.access), CommonLib.hash(self.common)));
    }
}
