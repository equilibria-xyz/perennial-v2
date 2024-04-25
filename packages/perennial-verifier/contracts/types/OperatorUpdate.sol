// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "./Common.sol";

struct OperatorUpdate {
    /// @dev The operator to approve for the signing account
    address operator;

    /// @dev The new status of the operator
    bool approved;

    /// @dev The common information for the intent
    Common common;
}
using OperatorUpdateLib for OperatorUpdate global;

/// @title OperatorUpdateLib
/// @notice Library for OperatorUpdate logic and data.
library OperatorUpdateLib {
    bytes32 constant public STRUCT_HASH = keccak256("OperatorUpdate(address operator,bool approved,Common common)Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)");

    function hash(OperatorUpdate memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.operator, self.approved,CommonLib.hash(self.common)));
    }
}
