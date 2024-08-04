// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

/// @title IdLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Encapsulates the logic for ID array computation
library IdLib {
    /// @dev O(n^2)
    function unique(bytes32[] memory ids) internal pure returns (uint256 uniqueCount) {
        for (uint256 i = 0; i < ids.length; i++) {
            for (uint256 j; j < i; j++)
                if (ids[i] == ids[j]) break;
            uniqueCount++;
        }
    }

    /// @dev O(n^2)
    function dedup(bytes32[] memory ids) internal pure returns (bytes32[] memory dedupedIds, uint256[] memory indices) {
        dedupedIds = new bytes32[](unique(ids));
        indices = new uint256[](ids.length);

        uint256 duplicates;
        for (uint256 i; i < ids.length; i++) {
            indices[i] = i - duplicates;
            dedupedIds[i - duplicates] = ids[i];
            for (uint256 j; j < i; j++)
                if (ids[i] == ids[j]) {
                    indices[i] = indices[j];
                    duplicates++;
                    break;
                }
        }
    }
}
