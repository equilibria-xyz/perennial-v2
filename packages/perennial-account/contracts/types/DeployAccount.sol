// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

// import { Common, CommonLib } from "@equilibria/root/verifier/Common.sol";
import { Common, CommonLib } from "./Common.sol";

struct DeployAccount {
    /// @dev The EOA for which the collateral account should be deployed
    address user;

    /// @dev Common information for EIP712 actions
    Common common;
}
using DeployAccountLib for DeployAccount global;

/// @title DeployAccountLib
/// @notice Library used to hash and verify action to deploy a collateral account
library DeployAccountLib {
    /// @dev used to verify a signed message of this type
    bytes32 constant public STRUCT_HASH = keccak256("DeployAccount(address user,Common common)Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)");

    /// @dev used to create a signed message of this type
    function hash(DeployAccount memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.user, CommonLib.hash(self.common)));
    }
}