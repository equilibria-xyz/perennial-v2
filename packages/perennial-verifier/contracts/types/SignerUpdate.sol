// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { AccessUpdate, AccessUpdateLib } from "./AccessUpdate.sol";

struct SignerUpdate {
    /// @dev The signer access to update
    AccessUpdate access;

    /// @dev The common information for the intent
    Common common;
}
using SignerUpdateLib for SignerUpdate global;

/// @title SignerUpdateLib
/// @notice Library for SignerUpdate logic and data.
library SignerUpdateLib {
    bytes32 constant public STRUCT_HASH = keccak256(
        "SignerUpdate(AccessUpdate access,Common common)"
        "AccessUpdate(address accessor,bool approved)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    function hash(SignerUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, AccessUpdateLib.hash(self.access), CommonLib.hash(self.common)));
    }
}
