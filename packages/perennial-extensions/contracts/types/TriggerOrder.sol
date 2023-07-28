// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/Position.sol";

struct TriggerOrder {
    uint8 side;
    int8 comparison;
    UFixed6 fee;
    Fixed6 price;
    Fixed6 delta;
}
using TriggerOrderLib for TriggerOrder global;
struct StoredTriggerOrder {
    /* slot 0 */
    uint8 side;         // 0 = maker, 1 = long, 2 = short
    int8 comparison;    // -2 = lt, -1 = lte, 0 = eq, 1 = gte, 2 = gt
    uint64 fee;         // <= 18.44tb
    int64 price;        // <= 9.22t
    int64 delta;        // <= 9.22t
    bytes6 __unallocated0__;
}
struct TriggerOrderStorage { StoredTriggerOrder value; }
using TriggerOrderStorageLib for TriggerOrderStorage global;

/**
 * @title TriggerOrderLib
 * @notice
 */
library TriggerOrderLib {
    function fillable(TriggerOrder memory self, Fixed6 latestPrice) internal pure returns (bool) {
        if (self.comparison == 1) return latestPrice.gte(self.price);
        if (self.comparison == -1) return latestPrice.lte(self.price);
        return false;
    }

    function execute(TriggerOrder memory self, Position memory currentPosition) internal pure {
        if (self.side == 1)
            currentPosition.long = UFixed6Lib.from(Fixed6Lib.from(currentPosition.long).add(self.delta));
        if (self.side == 2)
            currentPosition.short = UFixed6Lib.from(Fixed6Lib.from(currentPosition.short).add(self.delta));
    }
}

library TriggerOrderStorageLib {
    error TriggerOrderStorageInvalidError();

    function read(TriggerOrderStorage storage self) internal view returns (TriggerOrder memory) {
        StoredTriggerOrder memory storedValue = self.value;
        return TriggerOrder(
            uint8(storedValue.side),
            int8(storedValue.comparison),
            UFixed6.wrap(uint256(storedValue.fee)),
            Fixed6.wrap(int256(storedValue.price)),
            Fixed6.wrap(int256(storedValue.delta))
        );
    }

    function store(TriggerOrderStorage storage self, TriggerOrder memory newValue) internal {
        if (newValue.side > type(uint8).max) revert TriggerOrderStorageInvalidError();
        if (newValue.comparison > type(int8).max) revert TriggerOrderStorageInvalidError();
        if (newValue.comparison < type(int8).min) revert TriggerOrderStorageInvalidError();
        if (newValue.fee.gt(UFixed6.wrap(type(uint64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();

        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            uint64(UFixed6.unwrap(newValue.fee)),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta)),
            bytes6(0)
        );
    }
}
