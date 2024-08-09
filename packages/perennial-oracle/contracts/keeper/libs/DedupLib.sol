// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

/// @title DedupLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Encapsulates the logic for ID array computation
library DedupLib {
    /// @notice Deduplicates an array of bytes32 IDs
    /// @dev Runs in O(n^2)
    /// @param ids The array of IDs to deduplicate
    /// @return dedupedIds The deduplicated array of IDs
    /// @return indices The indices that each ID maps to in the deduplicated array
    function dedup(bytes32[] memory ids) internal pure returns (bytes32[] memory dedupedIds, uint256[] memory indices) {
        bytes32[] memory dedupedIdsUnpacked = new bytes32[](ids.length);
        indices = new uint256[](ids.length);
        uint256 duplicates;

        // dedup
        for (uint256 i; i < ids.length; i++) {
            uint256 index = _match(ids, i);
            if (index == i) {
                uint256 dedupedIndex = i - duplicates;
                indices[i] = dedupedIndex;
                dedupedIdsUnpacked[dedupedIndex] = ids[i];
            } else {
                indices[i] = indices[index];
                duplicates++;
            }
        }

        // pack
        dedupedIds = new bytes32[](ids.length - duplicates);
        for (uint256 i; i < dedupedIds.length; i++)
            dedupedIds[i] = dedupedIdsUnpacked[i];
    }

    /// @notice Finds the index of the first occurrence of an ID in an array
    /// @dev Runs in O(n)
    /// @param ids The array of IDs to search
    /// @param index The index of the ID to search for
    function _match(bytes32[] memory ids, uint256 index) private pure returns (uint256) {
        for (uint256 i; i < index; i++)
            if (ids[index] == ids[i])
                return i;
        return index;
    }
}
