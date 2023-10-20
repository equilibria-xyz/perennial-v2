// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/Position.sol";
import "./InterfaceFee.sol";

struct TriggerOrder {
    uint8 side;
    int8 comparison;
    UFixed6 fee;
    Fixed6 price;
    Fixed6 delta;
    InterfaceFee interfaceFee;
}
using TriggerOrderLib for TriggerOrder global;
struct StoredTriggerOrder {
    /* slot 0 */
    uint8 side;                // 0 = maker, 1 = long, 2 = short, 4 = collateral
    int8 comparison;           // -2 = lt, -1 = lte, 0 = eq, 1 = gte, 2 = gt
    uint64 fee;                // <= 18.44tb
    int64 price;               // <= 9.22t
    int64 delta;               // <= 9.22t
    uint48 interfaceFeeAmount; // <= 281m

    /* slot 1 */
    address interfaceFeeReceiver;
    bool interfaceFeeUnwrap;
    bytes11 __unallocated0__;
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
        // update position
        if (self.side == 0)
            currentPosition.maker = self.delta.isZero() ?
                UFixed6Lib.ZERO :
                UFixed6Lib.from(Fixed6Lib.from(currentPosition.maker).add(self.delta));
        if (self.side == 1)
            currentPosition.long = self.delta.isZero() ?
                UFixed6Lib.ZERO :
                UFixed6Lib.from(Fixed6Lib.from(currentPosition.long).add(self.delta));
        if (self.side == 2)
            currentPosition.short = self.delta.isZero() ?
                UFixed6Lib.ZERO :
                UFixed6Lib.from(Fixed6Lib.from(currentPosition.short).add(self.delta));

        // update collateral (override collateral field in position since it is not used in this context)
        currentPosition.collateral = (self.side == 3) ? self.delta : Fixed6Lib.ZERO;
    }
}

library TriggerOrderStorageLib {
    // sig: 0xf3469aa7
    error TriggerOrderStorageInvalidError();

    function read(TriggerOrderStorage storage self) internal view returns (TriggerOrder memory) {
        StoredTriggerOrder memory storedValue = self.value;
        return TriggerOrder(
            uint8(storedValue.side),
            int8(storedValue.comparison),
            UFixed6.wrap(uint256(storedValue.fee)),
            Fixed6.wrap(int256(storedValue.price)),
            Fixed6.wrap(int256(storedValue.delta)),
            InterfaceFee(
                UFixed6.wrap(uint256(storedValue.interfaceFeeAmount)),
                storedValue.interfaceFeeReceiver,
                storedValue.interfaceFeeUnwrap
            )
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
        if (newValue.interfaceFee.amount.gt(UFixed6.wrap(type(uint48).max))) revert TriggerOrderStorageInvalidError();

        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            uint64(UFixed6.unwrap(newValue.fee)),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta)),
            uint40(UFixed6.unwrap(newValue.interfaceFee.amount)),
            newValue.interfaceFee.receiver,
            newValue.interfaceFee.unwrap,
            bytes11(0)
        );
    }
}
