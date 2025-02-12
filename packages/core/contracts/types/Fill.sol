// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { Intent, IntentLib } from "./Intent.sol";

/// @notice Market update which fills an intent using a signed message
struct Fill {
    /// @dev Message signed by the trader
    Intent intent;

    /// @dev Identifies the solver of the intent
    Common common;
}
using FillLib for Fill global;

/// @notice Library used to hash requests and verify message signatures
library FillLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "Fill(Intent intent,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "Intent(int256 amount,int256 price,uint256 fee,address originator,address solver,uint256 collateralization,Common common)"
    );

    /// @dev Used to create a signed message
    function hash(Fill memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, IntentLib.hash(self.intent), CommonLib.hash(self.common)));
    }
}