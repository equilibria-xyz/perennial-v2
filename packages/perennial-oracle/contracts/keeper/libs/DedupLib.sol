// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

/// @title DedupLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Encapsulates the logic for ID array computation
library DedupLib {
    /// @dev O(n^2)
    function unique(bytes32[] memory ids) internal pure returns (uint256 uniqueCount) {
        for (uint256 i = 0; i < ids.length; i++)
            if (_match(ids, i) == i)
                uniqueCount++;
    }

    /// @dev O(n^2)
    function dedup(bytes32[] memory ids) internal pure returns (bytes32[] memory dedupedIds, uint256[] memory indices) {
        dedupedIds = new bytes32[](unique(ids));
        indices = new uint256[](ids.length);
        uint256 duplicates;

        for (uint256 i; i < ids.length; i++) {
            uint256 index = _match(ids, i);
            if (index == i) {
                uint256 dedupedIndex = i - duplicates;
                indices[i] = dedupedIndex;
                dedupedIds[dedupedIndex] = ids[i];
            } else {
                indices[i] = indices[index];
                duplicates++;
            }
        }
    }

    function _match(bytes32[] memory ids, uint256 index) private pure returns (uint256) {
        for (uint256 i; i < index; i++)
            if (ids[index] == ids[i])
                return i;
        return index;
    }
}
