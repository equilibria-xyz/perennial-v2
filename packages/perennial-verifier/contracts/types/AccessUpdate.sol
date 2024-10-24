// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";

struct AccessUpdate {
    /// @dev The generic signer or operator to approve for the signing account
    address accessor;

    /// @dev The new status of the signer or operator
    bool approved;
}
using AccessUpdateLib for AccessUpdate global;

/// @title AccessUpdateLib
/// @notice Library for AccessUpdate logic and data.
library AccessUpdateLib {
    bytes32 constant public STRUCT_HASH = keccak256("AccessUpdate(address accessor,bool approved)");

    function hash(AccessUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.accessor, self.approved));
    }
}
