// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { Intent, IntentLib } from "./Intent.sol";

struct Fill {
    /// @dev The intent order that is being filled
    Intent intent;

    /// @dev The common information for the intent
    Common common;
}
using FillLib for Fill global;

/// @title FillLib
/// @notice Library for Fill logic and data.
library FillLib {
    bytes32 constant public STRUCT_HASH = keccak256(
        "Fill(Intent intent,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "Intent(int256 amount,int256 price,uint256 fee,address originator,address solver,Common common)"
    );

    function hash(Fill memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, IntentLib.hash(self.intent), CommonLib.hash(self.common)));
    }
}
