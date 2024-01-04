// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "@equilibria/perennial-v2/contracts/types/Position.sol";
import "./InterfaceFee.sol";

struct TriggerOrder {
    uint8 side;
    int8 comparison;
    UFixed6 fee;
    Fixed6 price;
    Fixed6 delta;
    InterfaceFee interfaceFee1;
    InterfaceFee interfaceFee2;
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

    /* slot 1 */
    address interfaceFeeReceiver1;
    uint48 interfaceFeeAmount1;      // <= 281m
    bool interfaceFeeUnwrap1;
    bytes5 __unallocated1__;

    /* slot 2 */
    address interfaceFeeReceiver2;
    uint48 interfaceFeeAmount2;      // <= 281m
    bool interfaceFeeUnwrap2;
    bytes5 __unallocated2__;
}
struct TriggerOrderStorage { StoredTriggerOrder value; }
using TriggerOrderStorageLib for TriggerOrderStorage global;

/**
 * @title TriggerOrderLib
 * @notice
 */
library TriggerOrderLib {
    function fillable(TriggerOrder memory self, OracleVersion memory latestVersion) internal pure returns (bool) {
        if (!latestVersion.valid) return false;
        if (self.comparison == 1) return latestVersion.price.gte(self.price);
        if (self.comparison == -1) return latestVersion.price.lte(self.price);
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
        // Handles collateral withdrawal magic value
        currentPosition.collateral = (self.side == 3) ?
            (self.delta.eq(Fixed6.wrap(type(int64).min)) ? Fixed6Lib.MIN : self.delta) :
            Fixed6Lib.ZERO;
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
                UFixed6.wrap(uint256(storedValue.interfaceFeeAmount1)),
                storedValue.interfaceFeeReceiver1,
                storedValue.interfaceFeeUnwrap1
            ),
            InterfaceFee(
                UFixed6.wrap(uint256(storedValue.interfaceFeeAmount2)),
                storedValue.interfaceFeeReceiver2,
                storedValue.interfaceFeeUnwrap2
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
        if (newValue.interfaceFee1.amount.gt(UFixed6.wrap(type(uint48).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.interfaceFee2.amount.gt(UFixed6.wrap(type(uint48).max))) revert TriggerOrderStorageInvalidError();

        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            uint64(UFixed6.unwrap(newValue.fee)),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta)),
            bytes6(0),
            newValue.interfaceFee1.receiver,
            uint48(UFixed6.unwrap(newValue.interfaceFee1.amount)),
            newValue.interfaceFee1.unwrap,
            bytes5(0),
            newValue.interfaceFee2.receiver,
            uint48(UFixed6.unwrap(newValue.interfaceFee2.amount)),
            newValue.interfaceFee2.unwrap,
            bytes5(0)
        );
    }
}
