// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev Mapping type
struct Mapping {
    /// @dev The underlying ids for the mapping
    uint256[] _ids;
}
using MappingLib for Mapping global;
struct StoredMappingEntry {
    uint32 _length;
    uint32[7] _ids;
}
struct StoredMapping {
    mapping(uint256 => StoredMappingEntry) entries;
}
struct MappingStorage { StoredMapping value; }
using MappingStorageLib for MappingStorage global;

/**
 * @title Mapping
 * @notice Holds a optimized list of ids for a mapping
 */
library MappingLib {
    /// @notice Initializes the mapping with a specified length
    /// @param self The mapping to initialize
    /// @param initialLength The initial length of the mapping
    function initialize(Mapping memory self, uint256 initialLength) internal pure {
        self._ids = new uint256[](initialLength);
    }

    /// @notice Updates the index of the mapping with a new id
    /// @param self The mapping to update
    /// @param index The index to update
    /// @param id The new id
    function update(Mapping memory self, uint256 index, uint256 id) internal pure {
        self._ids[index] = id;
    }

    /// @notice Returns the length of the mapping
    /// @param self The mapping to query
    /// @return The length of the mapping
    function length(Mapping memory self) internal pure returns (uint256) {
        return self._ids.length;
    }

    /// @notice Returns the id at the specified index
    /// @dev A market positionId of zero will return a zero state in the underlying
    /// @param self The mapping to query
    /// @param index The index to query
    /// @return id The id at the specified index
    function get(Mapping memory self, uint256 index) internal pure returns (uint256 id) {
        if (index < self._ids.length) id = self._ids[index];
    }

    /// @notice Returns whether the latest mapping is ready to be settled based on this mapping
    /// @dev The latest mapping is ready to be settled when all ids in this mapping are greater than the latest mapping
    /// @param self The mapping to query
    /// @param latestMapping The latest mapping
    /// @return Whether the mapping is ready to be settled
    function ready(Mapping memory self, Mapping memory latestMapping) internal pure returns (bool) {
        for (uint256 id; id < latestMapping._ids.length; id++)
            if (get(self, id) > get(latestMapping, id)) return false;
        return true;
    }

    /// @notice Returns whether the mapping is ready to be advanced based on the current mapping
    /// @dev The mapping is ready to be advanced when any ids in the current mapping are greater than this mapping
    /// @param self The mapping to query
    /// @param currentMapping The current mapping
    /// @return Whether the mapping is ready to be advanced
    function next(Mapping memory self, Mapping memory currentMapping) internal pure returns (bool) {
        for (uint256 id; id < currentMapping._ids.length; id++)
            if (get(currentMapping, id) > get(self, id)) return true;
        return false;
    }
}

library MappingStorageLib {
    error MappingStorageInvalidError();

    function read(MappingStorage storage self) internal view returns (Mapping memory) {
        uint256 length = uint256(self.value.entries[0]._length);
        uint256[] memory entries = new uint256[](length);

        for (uint256 i; i < length; i++)
            entries[i] = uint256(self.value.entries[i / 7]._ids[i % 7]);

        return Mapping(entries);
    }

    function store(MappingStorage storage self, Mapping memory newValue) internal {
        if (self.value.entries[0]._length > 0) revert MappingStorageInvalidError();

        StoredMappingEntry[] memory storedEntries = new StoredMappingEntry[](Math.ceilDiv(newValue._ids.length, 7));

        for (uint256 i; i < newValue._ids.length; i++) {
            if (newValue._ids[i] > uint256(type(uint32).max)) revert MappingStorageInvalidError();

            storedEntries[i / 7]._length = uint32(newValue._ids.length);
            storedEntries[i / 7]._ids[i % 7] = uint32(newValue._ids[i]);
        }

        for (uint256 i; i < storedEntries.length; i++) {
            self.value.entries[i] = storedEntries[i];
        }
    }
}
