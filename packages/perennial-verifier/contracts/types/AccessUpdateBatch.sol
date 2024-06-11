// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { AccessUpdate, AccessUpdateLib } from "../types/AccessUpdate.sol";

struct AccessUpdateBatch {
    /// @dev The operator access update messages
    AccessUpdate[] operators;

    /// @dev The signer access update messages
    AccessUpdate[] signers;

    /// @dev The common information for the intent
    Common common;
}
using AccessUpdateBatchLib for AccessUpdateBatch global;

/// @title AccessUpdateBatchLib
/// @notice Library for AccessUpdateBatch logic and data.
library AccessUpdateBatchLib {
    bytes32 constant public STRUCT_HASH = keccak256(
        "AccessUpdateBatch(AccessUpdate[] operators,AccessUpdate[] signers,Common common)"
        "AccessUpdate(address accessor,bool approved)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    function hash(AccessUpdateBatch memory self) internal pure returns (bytes32) {
        bytes32[] memory operatorHashes = new bytes32[](self.operators.length);
        bytes32[] memory signerHashes = new bytes32[](self.signers.length);

        for (uint256 i = 0; i < self.operators.length; i++)
            operatorHashes[i] = AccessUpdateLib.hash(self.operators[i]);
        for (uint256 i = 0; i < self.signers.length; i++)
            signerHashes[i] = AccessUpdateLib.hash(self.signers[i]);

        return keccak256(
            abi.encode(
                STRUCT_HASH,
                keccak256(abi.encodePacked(operatorHashes)),
                keccak256(abi.encodePacked(signerHashes)),
                CommonLib.hash(self.common)
            )
        );
    }
}
