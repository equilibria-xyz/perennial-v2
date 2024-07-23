// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/UFixed6.sol";

struct TriggerOrder {
    uint8 side;      // 0 = maker, 1 = long, 2 = short
    int8 comparison; // -2 = lt, -1 = lte, 0 = eq, 1 = gte, 2 = gt
    Fixed6 price;    // <= 9.22t
    Fixed6 delta;    // <= 9.22t
}
// TODO: create lib for processing trigger order logic
// using TriggerOrderLib for TriggerOrder global;

struct StoredTriggerOrder {
    /* slot 0 */
    uint8 side;         // 0 = maker, 1 = long, 2 = short
    int8 comparison;    // -2 = lt, -1 = lte, 0 = eq, 1 = gte, 2 = gt
    int64 price;        // <= 9.22t
    int64 delta;        // <= 9.22t
}
struct TriggerOrderStorage { StoredTriggerOrder value; /*uint256 slot0;*/ }
using TriggerOrderStorageLib for TriggerOrderStorage global;

// TODO: What makes this "external-safe"?
/// @dev Manually encodes and decodes the TriggerOrder struct to/from storage.
///
///     struct StoredTriggerOrder {
///         /* slot 0 */
///         uint8 side;
///         int8 comparison;
///         int64 price;
///         int64 delta;
///     }
library TriggerOrderStorageLib {
    // sig: 0xf3469aa7
    error TriggerOrderStorageInvalidError();

    /// @dev reads a trigger order struct from storage
    function read(TriggerOrderStorage storage self) internal view returns (TriggerOrder memory) {
        /*uint256 slot0 = self.slot0;
        return TriggerOrder(
            uint8(slot0 << (256 - 8))                 >> (256 - 8),
            int8(int256(slot0 << (256 - 8 - 8))       >> (256 - 8)),
            Fixed6.wrap(int256(256 - 8 - 8 - 64)      >> (256 - 64)),
            Fixed6.wrap(int256(256 - 8 - 8 - 64 - 64) >> (256 - 64))
        );*/

        StoredTriggerOrder memory storedValue = self.value;
        return TriggerOrder(
            uint8(storedValue.side),
            int8(storedValue.comparison),
            Fixed6.wrap(int256(storedValue.price)),
            Fixed6.wrap(int256(storedValue.delta))
        );
    }

    /// @dev writes a trigger order struct to storage
    function store(TriggerOrderStorage storage self, TriggerOrder memory newValue) internal {
        if (newValue.side > type(uint8).max) revert TriggerOrderStorageInvalidError();
        if (newValue.comparison > type(int8).max) revert TriggerOrderStorageInvalidError();
        if (newValue.comparison < type(int8).min) revert TriggerOrderStorageInvalidError();
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();

        // FIXME: couldn't get this to work
        /*uint256 encoded0 =
            uint256(newValue.side                 << (256 - 8))  >> (256 - 8); |
            uint256(int256(newValue.comparison    << (256 - 8))  >> (256 - 8 - 8)) |
            uint256(Fixed6.unwrap(newValue.price) << (256 - 64)) >> (256 - 8 - 8 - 64) |
            uint256(Fixed6.unwrap(newValue.delta) << (256 - 64)) >> (256 - 8 - 8 - 64 - 64) |
        assembly {
            sstore(self.slot, encoded0)
        }*/
        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta))
        );
    }
}
