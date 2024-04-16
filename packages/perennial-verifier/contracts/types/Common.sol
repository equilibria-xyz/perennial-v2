// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

// TODO: calldata packing

struct Common {
    address account;
    UFixed6 maxFee;
    bytes32 nonce;
    bytes32 group;
    uint256 expiry;
}
using CommonLib for Common global;

/// @title CommonLib
/// @notice Library for Common logic and data.
library CommonLib {
    bytes32 constant public STRUCT_HASH =
        keccak256("Common(address account,uint256 maxFee,bytes32 nonce,bytes32 group,uint256 expiry)");

    function hash(Common memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.maxFee, self.nonce, self.group, self.expiry));
    }
}
