// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

struct Common {
    address account;
    address domain;
    uint256 nonce;
    uint256 group;
    uint256 expiry;
}
using CommonLib for Common global;

/// @title CommonLib
/// @notice Library for Common logic and data.
library CommonLib {
    bytes32 constant public STRUCT_HASH =
        keccak256("Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)");

    function hash(Common memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.account, self.domain, self.nonce, self.group, self.expiry));
    }
}
