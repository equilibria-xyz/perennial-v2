// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev Mapping type
struct Mapping {
    uint256[] ids;
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
    function initialize(Mapping memory self, uint256 totalMarkets) internal pure {
        self.ids = new uint256[](totalMarkets);
    }

    function update(Mapping memory self, uint256 marketId, uint256 id) internal pure {
        self.ids[marketId] = id;
    }
}

library MappingStorageLib {
    error MappingStorageInvalidError();

    function read(MappingStorage storage self) internal view returns (Mapping memory) {
        StoredMapping memory storedValue = self.value;

        uint256[] memory entries = new uint256[](storedValue.entries[0]._length);

        for (uint256 i; i < uint256(storedValue.entries[0]._length); i++)
            entries[i] = uint256(storedValue.entries[i / 7]._ids[i % 7]);

        return Mapping(entries);
    }

    function store(MappingStorage storage self, Mapping memory newValue) internal {
        StoredMappingEntry[] memory storedEntries = new StoredMappingEntry[](Math.ceilDiv(newValue.ids.length, 7));

        for (uint256 i; i < newValue.ids.length; i++) {
            if (newValue.ids[i] > uint256(type(uint32).max)) revert MappingStorageInvalidError();
            if (newValue.ids.length > uint256(type(uint32).max)) revert MappingStorageInvalidError();

            storedEntries[i / 7]._length = uint32(newValue.ids.length);
            storedEntries[i / 7]._ids[i % 7] = uint32(newValue.ids[i]);
        }

        self.value = StoredMapping(storedEntries);
    }
}
