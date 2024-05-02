// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

/// @notice Fields which need to be hashed for each collateral account action
struct Action {
    /// @dev centralized cacher of pending actions to which a fee will be paid
    address relayer;
    /// @dev fee paid to the relayer
    UFixed6 fee;
    /// @dev Common information for all EIP712 actions
    Common common;
}
using ActionLib for Action global;

/// @title ActionLib
/// @notice Library used to hash and verifiy fields common to all collateral-account-related messages
library ActionLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "Action(address relayer,uint256 fee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev used to create a signed message
    function hash(Action memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.relayer, self.fee, CommonLib.hash(self.common)));
    }
}