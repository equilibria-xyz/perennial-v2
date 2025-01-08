// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev Mark type
struct Mark {
    /// @dev The high-water mark for the vault
    UFixed18 mark;

    /// @dev The claimable profit balance for the coordinator
    UFixed6 claimable;
}
struct StoredMark {
    /* slot 0 */
    uint128 mark;
    uint64 claimable;
    bytes8 __unallocated0__;
}
struct MarkStorage { StoredMark value; } // SECURITY: must remain at (1) slots
using MarkStorageLib for MarkStorage global;

/// @dev (external-safe): this library is safe to externalize
library MarkStorageLib {
    // sig: 0x463b8906
    error MarkStorageInvalidError();

    function read(MarkStorage storage self) internal view returns (Mark memory) {
        StoredMark memory storedValue = self.value;

        return Mark(
            UFixed18.wrap(uint256(storedValue.mark)),
            UFixed6.wrap(uint256(storedValue.claimable))
        );
    }

    function store(MarkStorage storage self, Mark memory newValue) internal {
        if (newValue.mark.gt(UFixed18.wrap(type(uint128).max))) revert MarkStorageInvalidError();
        if (newValue.claimable.gt(UFixed6.wrap(type(uint64).max))) revert MarkStorageInvalidError();

        self.value = StoredMark(
            uint128(UFixed18.unwrap(newValue.mark)),
            uint64(UFixed6.unwrap(newValue.claimable)),
            bytes8(0)
        );
    }
}
