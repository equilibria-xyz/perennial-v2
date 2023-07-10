// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev Mapping type
struct Mapping {
    uint256[] _ids;
}
using MappingLib for Mapping global;
struct StoredMappingEntry {
    uint32 _length;
    uint32[7] _ids;
}
struct StoredMapping {
    StoredMappingEntry[] entries;
}
struct MappingStorage { StoredMapping value; }
using MappingStorageLib for MappingStorage global;

/**
 * @title MappingLib
 * @notice
 */
library MappingLib {
    function initialize(Mapping memory self, uint256 length) internal pure {
        self._ids = new uint256[](length);
    }

    function update(Mapping memory self, uint256 index, uint256 id) internal pure {
        self._ids[index] = id;
    }

    function length(Mapping memory self) internal pure returns (uint256) {
        return self._ids.length;
    }

    /// @dev positionId of zero will return a zero state in the underlying
    function get(Mapping memory self, uint256 index) internal pure returns (uint256 id) {
        if (index < self._ids.length) id = self._ids[index];
    }

    function ready(Mapping memory self, Mapping memory latestMapping) internal pure returns (bool) {
        for (uint256 id; id < latestMapping._ids.length; id++)
            if (get(self, id) > get(latestMapping, id)) return false;
        return true;
    }

    function next(Mapping memory self, Mapping memory currentMapping) internal pure returns (bool) {
        for (uint256 id; id < currentMapping._ids.length; id++)
            if (get(currentMapping, id) > get(self, id)) return true;
        return false;
    }
}

library MappingStorageLib {
    error MappingStorageInvalidError();

    function read(MappingStorage storage self) internal view returns (Mapping memory) {
        StoredMapping memory storedValue = self.value;

        uint256 length = storedValue.entries.length == 0 ? 0 : uint256(storedValue.entries[0]._length);
        uint256[] memory entries = new uint256[](length);

        for (uint256 i; i < length; i++)
            entries[i] = uint256(storedValue.entries[i / 7]._ids[i % 7]);

        return Mapping(entries);
    }

    function store(MappingStorage storage self, Mapping memory newValue) internal {
        StoredMappingEntry[] memory storedEntries = new StoredMappingEntry[](Math.ceilDiv(newValue._ids.length, 7));

        for (uint256 i; i < newValue._ids.length; i++) {
            if (newValue._ids[i] > uint256(type(uint32).max)) revert MappingStorageInvalidError();
            if (newValue._ids.length > uint256(type(uint32).max)) revert MappingStorageInvalidError();

            storedEntries[i / 7]._length = uint32(newValue._ids.length);
            storedEntries[i / 7]._ids[i % 7] = uint32(newValue._ids[i]);
        }

        self.value = StoredMapping(storedEntries);
    }
}
